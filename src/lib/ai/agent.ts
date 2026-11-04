/**
 * The Rebuttal analyst: a Gemini tool-calling agent that pulls the dispute, the payment,
 * the PayPal tracking record and the seller's evidence, reads documents with vision,
 * checks the fixed rules table and submits one recommendation.
 *
 * Modes, in order of preference:
 *   live      Gemini via the AI SDK, rate-limited and cached
 *   recorded  a real Gemini run recorded earlier, replayed step by step (no key / rate-limited)
 *   rules     no model at all: the deterministic rules table decides (last resort)
 */
import { generateText, hasToolCall, stepCountIs, tool } from "ai";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { baseFacts, formatAddress, loadCase, type CaseFile } from "../casefile";
import { recordCall, withDispute } from "../calls";
import { now } from "../clock";
import { db } from "../db";
import { logEvent } from "../events";
import { clampMinor, formatMoney, percentOf } from "../money";
import { getOrder } from "../paypal/orders";
import { paypalLive, readDispute } from "../paypal/gateway";
import { addressMatches, baselineAction, coverage, daysBetween, REASON_LABEL, type Action, type Coverage, type Facts } from "../rules";
import { DEMO_TZ } from "../scenario";
import { transition } from "../workflow";
import { aiLive, chainModel, RateLimitedError, type ModelHandle } from "./model";
import { RecommendationSchema, tidyRecommendation, type CarrierScan, type PhotoComparison, type Recommendation } from "./schemas";
import { comparePhotos, readCarrierDocument } from "./vision";

export type TraceStep = {
  id: number;
  tool: string;
  label: string;
  input?: unknown;
  output?: unknown;
  status: "running" | "done" | "error";
  ms?: number;
};

export type AnalysisResult = {
  recommendation: Recommendation;
  offerMinor: number | null;
  coverage: Coverage;
  baseline: Action;
  agrees: boolean;
  facts: Facts;
};

export type AIMode = "live" | "recorded" | "rules";

export type Recording = {
  scenario: string;
  model: string;
  recorded_at: string;
  trace: TraceStep[];
  ai_facts: { carrierScan: Facts["carrierScan"]; photoComparison: Facts["photoComparison"] };
  recommendation: Recommendation;
};

const RECORDED_DIR = path.join(process.cwd(), "src/lib/ai/recorded");
const running = new Set<string>();

export const TOOL_LABELS: Record<string, string> = {
  get_dispute: "Pulled the dispute from PayPal",
  get_transaction: "Pulled the original payment",
  get_tracking_record: "Read the PayPal tracking record",
  list_seller_evidence: "Gathered the seller’s evidence",
  read_carrier_document: "Read the carrier document",
  compare_photos: "Compared the buyer’s photo with the listing",
  check_evidence_coverage: "Checked the rules table",
  submit_recommendation: "Recommended an action",
};

// ---- Persistence ------------------------------------------------------------------------

function saveAnalysis(id: string, patch: Record<string, unknown>) {
  const cols = Object.keys(patch);
  db()
    .prepare(`UPDATE analyses SET ${cols.map((c) => `${c} = @${c}`).join(", ")} WHERE dispute_id = @id`)
    .run({ id, ...Object.fromEntries(cols.map((c) => [c, typeof patch[c] === "object" && patch[c] !== null ? JSON.stringify(patch[c]) : patch[c]])) });
}

function setStage(id: string, ev: Parameters<typeof transition>[1]) {
  const row = db().prepare("SELECT stage FROM disputes WHERE id = ?").get(id) as { stage: Parameters<typeof transition>[0] };
  db().prepare("UPDATE disputes SET stage = ? WHERE id = ?").run(transition(row.stage, ev), id);
}

class Tracer {
  steps: TraceStep[] = [];
  constructor(private disputeId: string) {}
  start(toolName: string, input?: unknown): TraceStep {
    const s: TraceStep = { id: this.steps.length + 1, tool: toolName, label: TOOL_LABELS[toolName] ?? toolName, input, status: "running" };
    this.steps.push(s);
    this.flush();
    return s;
  }
  end(s: TraceStep, output: unknown, startedAt: number, status: TraceStep["status"] = "done") {
    s.output = output;
    s.status = status;
    s.ms = Date.now() - startedAt;
    this.flush();
  }
  flush() {
    saveAnalysis(this.disputeId, { trace: this.steps });
  }
}

// ---- Tool bodies (shared by live and recorded runs) -----------------------------------

async function toolGetDispute(c: CaseFile) {
  const { dispute: d } = await readDispute(c.dispute, c.row.source);
  return {
    dispute_id: d.dispute_id,
    reason: d.reason,
    reason_label: REASON_LABEL[d.reason],
    status: d.status,
    stage: d.dispute_life_cycle_stage,
    amount: formatMoney({ minor: baseFacts(c).amountMinor, currency: d.dispute_amount.currency_code }),
    opened_at: d.create_time,
    seller_response_due: d.seller_response_due_date,
    buyer_claim: c.row.buyer_claim,
    evidence_requested: (d.evidences ?? []).filter((e) => e.source === "REQUESTED_FROM_SELLER").map((e) => e.evidence_type),
    available_actions: d.links.map((l) => l.rel).filter((r) => r !== "self"),
  };
}

async function toolGetTransaction(c: CaseFile) {
  let o = c.orderJson;
  if (c.order.source === "sandbox" && c.order.paypal_order_id && (await paypalLive())) {
    try {
      o = (await getOrder(c.order.paypal_order_id)) as typeof o;
    } catch {
      /* use stored copy */
    }
  } else {
    recordCall({
      at: now(),
      method: "GET",
      path: `/v2/checkout/orders/${c.order.paypal_order_id ?? c.order.id}`,
      status: 200,
      mode: "simulated",
      actor: "seller",
      label: "Show order details",
      response: c.orderJson,
    });
  }
  const pu = o.purchase_units?.[0];
  return {
    order: c.order.id,
    paid_at: c.order.paid_at,
    amount: formatMoney({ minor: c.order.amount_minor, currency: c.order.currency }),
    buyer: c.order.buyer_name,
    items: pu?.items?.map((i) => `${i.quantity ?? 1} × ${i.name}`) ?? [],
    ship_to: formatAddress(o),
    seller_protection: pu?.payments?.captures?.[0]?.seller_protection?.status ?? "UNKNOWN",
  };
}

function toolGetTracking(c: CaseFile) {
  const t = baseFacts(c).tracker;
  if (!t) return { tracker: null, note: "No tracking was added to this PayPal transaction." };
  return {
    tracker: t,
    added_at: c.tracking?.addedAt,
    note: "PayPal's tracker only holds the carrier and number the seller entered and the status the seller set. It has no carrier scans or delivery confirmation.",
  };
}

function toolListEvidence(c: CaseFile) {
  return c.evidence.map((e) => ({ id: e.id, kind: e.kind, title: e.title, has_file: !!e.file, text: e.text ?? undefined }));
}

function carrierFacts(c: CaseFile, scan: CarrierScan): NonNullable<Facts["carrierScan"]> & Record<string, unknown> {
  const f = baseFacts(c);
  return {
    status: scan.status,
    deliveredAt: scan.delivered_at,
    trackingNumber: scan.tracking_number,
    address: scan.delivery_address,
    deliveryNote: scan.delivery_note,
    // Deterministic cross-checks the model gets back (it does not compute these itself).
    address_matches_paypal_ship_to: scan.delivery_address && f.shipTo ? addressMatches(scan.delivery_address, f.shipTo) : null,
    tracking_matches_paypal: scan.tracking_number && f.tracker ? scan.tracking_number.toUpperCase() === f.tracker.number.toUpperCase() : null,
    days_delivered_before_claim: scan.delivered_at ? daysBetween(scan.delivered_at, f.disputeOpenedAt) : null,
  };
}

function coverageView(cov: Coverage) {
  return {
    strength: cov.strength,
    score: cov.score,
    baseline_action: baselineAction(cov),
    items: cov.items.map((i) => ({ id: i.id, label: i.label, weight: i.weight, state: i.state, detail: i.detail })),
  };
}

// ---- Live run ---------------------------------------------------------------------------

const SYSTEM = `You are Rebuttal, a dispute analyst working for a small online seller who takes PayPal.
A buyer has opened a PayPal dispute. Your job is to recommend exactly one action that leaves the seller with the most money and the least risk:
- fight: submit evidence and argue the case (only when the evidence answers the dispute reason)
- offer: propose a partial refund (when the evidence is mixed and fighting would probably lose, but the buyer has something to gain from settling)
- accept: refund in full (when there is nothing that answers the claim)

Method:
1. Call get_dispute, get_transaction, get_tracking_record and list_seller_evidence.
2. Read every carrier_document with read_carrier_document. If there is a listing_photo and a buyer_photo, call compare_photos.
3. Call check_evidence_coverage. It applies PayPal's evidence requirements for this reason and tells you what is present, missing or against the seller.
4. Call submit_recommendation once.

What PayPal does (use this when weighing options):
- Item not received: Seller Protection needs online tracking on the transaction showing delivery to the address on the transaction. With that, the seller usually wins.
- Not as described: if PayPal sides with the buyer it normally asks the buyer to ship the item back, at the buyer's own cost, before a full refund. A partial refund lets the buyer keep the item with no return trip, so buyers often take one. When the listing disclosed variation but the buyer's photo shows a visible difference and the seller has no photo of the actual unit, a partial refund is usually the best outcome: the seller keeps most of the sale and the item never comes back.
- When nothing on file answers the claim, fighting only delays the same refund by weeks and adds a lost case to the account. Accept.
check_evidence_coverage returns a baseline_action from the rules table. Treat it as a cross-check; you may disagree if the facts justify it, and say why.

Rules: never invent facts; cite dates, addresses and amounts from tool results. Write dates like "5 Nov 2026" and times like "2:12 pm".
Use the deterministic cross-checks (address_matches_paypal_ship_to, tracking_matches_paypal, days_delivered_before_claim) rather than recomputing them.
Confidence is your honest estimate; nothing in a dispute is certain, so stay at or below 95. The server computes money from offer_percent; never write a refund amount yourself.
Write response_to_paypal in the seller's voice, factual and calm, under 1,500 characters. Write for a PayPal reviewer (fight) or for the buyer (offer).`;

async function runLive(c: CaseFile, h: ModelHandle, tr: Tracer, facts: Facts): Promise<Recommendation> {
  const wrap = <I, O>(name: string, fn: (input: I) => Promise<O> | O) => async (input: I) => {
    const t0 = Date.now();
    const s = tr.start(name, input);
    try {
      const out = await fn(input);
      tr.end(s, out, t0);
      return out;
    } catch (e) {
      tr.end(s, { error: (e as Error).message }, t0, "error");
      if (e instanceof RateLimitedError) throw e;
      return { error: (e as Error).message } as O;
    }
  };

  const tools = {
    get_dispute: tool({ description: "Get the PayPal dispute details", inputSchema: z.object({}), execute: wrap("get_dispute", () => toolGetDispute(c)) }),
    get_transaction: tool({ description: "Get the original PayPal payment (order) for this dispute", inputSchema: z.object({}), execute: wrap("get_transaction", () => toolGetTransaction(c)) }),
    get_tracking_record: tool({ description: "Get the tracking record attached to the PayPal transaction", inputSchema: z.object({}), execute: wrap("get_tracking_record", () => toolGetTracking(c)) }),
    list_seller_evidence: tool({ description: "List the seller's evidence documents, with text content where available", inputSchema: z.object({}), execute: wrap("list_seller_evidence", () => toolListEvidence(c)) }),
    read_carrier_document: tool({
      description: "Read a carrier screenshot or PDF and extract status, delivery date and address",
      inputSchema: z.object({ document_id: z.string() }),
      execute: wrap("read_carrier_document", async ({ document_id }: { document_id: string }) => {
        const e = c.evidence.find((x) => x.id === document_id && x.file);
        if (!e) return { error: `No document file with id ${document_id}` };
        const { scan } = await readCarrierDocument(h, e, DEMO_TZ);
        const cf = carrierFacts(c, scan);
        facts.carrierScan = cf;
        return { ...scan, ...cf };
      }),
    }),
    compare_photos: tool({
      description: "Compare the seller's listing photo with the buyer's photo of the item received",
      inputSchema: z.object({ listing_photo_id: z.string(), buyer_photo_id: z.string() }),
      execute: wrap("compare_photos", async ({ listing_photo_id, buyer_photo_id }: { listing_photo_id: string; buyer_photo_id: string }) => {
        const a = c.evidence.find((x) => x.id === listing_photo_id && x.file);
        const b = c.evidence.find((x) => x.id === buyer_photo_id && x.file);
        if (!a || !b) return { error: "Photo not found" };
        const listing = c.evidence.find((x) => x.kind === "listing")?.text ?? "";
        const { comparison } = await comparePhotos(h, a, b, listing);
        facts.photoComparison = photoFacts(comparison);
        return comparison;
      }),
    }),
    check_evidence_coverage: tool({
      description: "Apply the fixed rules table for this dispute reason to everything gathered so far",
      inputSchema: z.object({}),
      execute: wrap("check_evidence_coverage", () => coverageView(coverage(facts))),
    }),
    submit_recommendation: tool({ description: "Submit the final recommendation. Call exactly once, last.", inputSchema: RecommendationSchema }),
  };

  const res = await generateText({
    model: h.model,
    system: SYSTEM,
    prompt: `Analyse dispute ${c.dispute.dispute_id} for ${"Fernhill Ceramics"}. Today is ${now()}.`,
    tools,
    stopWhen: [hasToolCall("submit_recommendation"), stepCountIs(12)],
    maxRetries: 1,
  });

  const final = res.steps.flatMap((s) => s.toolCalls).find((tc) => tc.toolName === "submit_recommendation");
  if (!final) throw new Error("The model finished without submitting a recommendation");
  const rec = RecommendationSchema.parse(final.input);
  const s = tr.start("submit_recommendation", rec);
  tr.end(s, { accepted: true }, Date.now());
  return rec;
}

function photoFacts(p: PhotoComparison): NonNullable<Facts["photoComparison"]> {
  return { comparable: p.comparable, materiallyDifferent: p.materially_different && !p.lighting_could_explain, summary: p.summary };
}

// ---- Recorded replay --------------------------------------------------------------------

export function loadRecording(scenario: string | null): Recording | null {
  if (!scenario) return null;
  const f = path.join(RECORDED_DIR, `${scenario}.json`);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as Recording) : null;
}

async function runRecorded(c: CaseFile, rec: Recording, tr: Tracer, facts: Facts, pace: number): Promise<Recommendation> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms * pace));
  for (const step of rec.trace) {
    const t0 = Date.now();
    const s = tr.start(step.tool, step.input);
    // Re-run the PayPal reads so the call log shows them; the model's outputs come from the recording.
    if (step.tool === "get_dispute") await toolGetDispute(c);
    if (step.tool === "get_transaction") await toolGetTransaction(c);
    if (step.tool === "read_carrier_document") facts.carrierScan = rec.ai_facts.carrierScan;
    if (step.tool === "compare_photos") facts.photoComparison = rec.ai_facts.photoComparison;
    await sleep(Math.min(1400, Math.max(350, (step.ms ?? 600) / 3)));
    tr.end(s, step.tool === "check_evidence_coverage" ? coverageView(coverage(facts)) : step.output, t0, step.status);
  }
  facts.carrierScan ??= rec.ai_facts.carrierScan;
  facts.photoComparison ??= rec.ai_facts.photoComparison;
  return rec.recommendation;
}

// ---- Rules-only fallback ---------------------------------------------------------------

export function rulesOnly(c: CaseFile, facts: Facts): Recommendation {
  const cov = coverage(facts);
  const action = baselineAction(cov);
  const present = cov.items.filter((i) => i.state === "present").map((i) => i.label.toLowerCase());
  const missing = cov.items.filter((i) => i.state !== "present").map((i) => i.label.toLowerCase());
  return {
    action,
    confidence: action === "fight" ? 70 : 55,
    headline:
      action === "fight" ? "Evidence covers the claim: submit it" : action === "offer" ? "Mixed evidence: offer a partial refund" : "Nothing answers this claim: refund it",
    reasoning: [
      present.length ? `On file: ${present.join(", ")}.` : "Nothing on file answers this dispute reason.",
      missing.length ? `Missing or against you: ${missing.join(", ")}.` : "Every rule for this reason is covered.",
    ],
    offer_percent: action === "offer" ? 30 : null,
    response_to_paypal:
      action === "fight"
        ? `The order was shipped with tracking and delivered to the address on the PayPal transaction. Evidence attached.`
        : action === "offer"
          ? `We're sorry the item wasn't what you expected. We'd like to offer a partial refund so you can keep it.`
          : `Refunding in full. Sorry this didn't work out.`,
    evidence_to_attach: c.evidence.filter((e) => e.file).map((e) => e.id),
    risks: ["Generated by the rules table without the AI model."],
  };
}

// ---- Entry point -----------------------------------------------------------------------

export function finalise(c: CaseFile, rec: Recommendation, facts: Facts): AnalysisResult {
  const cov = coverage(facts);
  const amount = facts.amountMinor;
  // Money is decided here, in integer minor units, never by the model.
  const offerMinor =
    rec.action === "offer" ? clampMinor(percentOf(amount, (rec.offer_percent ?? 30) * 100), 1, amount - 1) : null;
  const baseline = baselineAction(cov);
  // A dispute is never a sure thing: confidence is capped at 95 and text trimmed to PayPal's limits.
  const recommendation = tidyRecommendation(rec);
  return { recommendation, offerMinor, coverage: cov, baseline, agrees: baseline === rec.action, facts };
}

export type RunOptions = { pace?: number; forceMode?: AIMode };

export async function analyse(disputeId: string, opts: RunOptions = {}): Promise<void> {
  if (running.has(disputeId)) return;
  const c = loadCase(disputeId);
  if (!c) throw new Error(`No dispute ${disputeId}`);
  running.add(disputeId);
  setStage(disputeId, { type: "ANALYZE" });
  db()
    .prepare(
      `INSERT INTO analyses (dispute_id, status, ai_mode, trace, started_at) VALUES (?, 'running', ?, '[]', ?)
       ON CONFLICT(dispute_id) DO UPDATE SET status='running', ai_mode=excluded.ai_mode, trace='[]', note=NULL, facts=NULL, result=NULL, model=NULL, started_at=excluded.started_at, finished_at=NULL`,
    )
    .run(disputeId, aiLive() ? "live" : "recorded", new Date().toISOString());

  const facts = baseFacts(c);
  const recording = loadRecording(c.row.scenario);
  let mode: AIMode = opts.forceMode ?? (aiLive() ? "live" : recording ? "recorded" : "rules");
  let note: string | null = null;
  let model: string | null = null;
  let tr = new Tracer(disputeId);

  await withDispute(disputeId, async () => {
    let rec: Recommendation | null = null;
    if (mode === "live") {
      const h = chainModel();
      try {
        rec = await runLive(c, h, tr, facts);
        model = h.served();
      } catch (e) {
        note =
          e instanceof RateLimitedError
            ? "Gemini free-tier rate limit hit"
            : `Gemini unavailable (${(e as Error).message.slice(0, 120)})`;
        mode = recording ? "recorded" : "rules";
        note += mode === "recorded" ? ": replaying a recorded Gemini analysis" : ": rules-only recommendation";
        Object.assign(facts, baseFacts(c));
        tr = new Tracer(disputeId);
      }
    }
    if (!rec && mode === "recorded" && recording) {
      rec = await runRecorded(c, recording, tr, facts, opts.pace ?? 1);
      model = recording.model;
      note ??= aiLive() ? null : "No Gemini key: replaying a recorded Gemini analysis";
    }
    if (!rec) {
      mode = "rules";
      rec = rulesOnly(c, facts);
      note ??= "No AI available for this dispute: rules-only recommendation";
    }
    const result = finalise(c, rec, facts);
    saveAnalysis(disputeId, {
      status: "done",
      ai_mode: mode,
      model,
      note,
      facts,
      result,
      finished_at: new Date().toISOString(),
    });
    setStage(disputeId, { type: "ANALYSIS_DONE" });
    const what = rec.action === "offer" ? `offer ${formatMoney({ minor: result.offerMinor!, currency: facts.currency })}` : rec.action;
    logEvent(disputeId, "analysis", `Rebuttal recommends: ${what} (${rec.confidence}% confident)`);
  }).catch((e) => {
    saveAnalysis(disputeId, { status: "failed", note: (e as Error).message, finished_at: new Date().toISOString() });
    setStage(disputeId, { type: "ANALYSIS_FAILED" });
  }).finally(() => running.delete(disputeId));
}

export function getAnalysis(disputeId: string) {
  const row = db().prepare("SELECT * FROM analyses WHERE dispute_id = ?").get(disputeId) as
    | { status: string; ai_mode: AIMode; model: string | null; note: string | null; trace: string; facts: string | null; result: string | null; started_at: string; finished_at: string | null }
    | undefined;
  if (!row) return null;
  return {
    status: row.status as "running" | "done" | "failed",
    aiMode: row.ai_mode,
    model: row.model,
    note: row.note,
    trace: JSON.parse(row.trace) as TraceStep[],
    result: row.result ? (JSON.parse(row.result) as AnalysisResult) : null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export const _test = { carrierFacts, photoFacts };
