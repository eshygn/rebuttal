/** JSON shapes the UI reads. Built server-side from SQLite. */
import { getAnalysis } from "./ai/agent";
import { formatAddress, loadCase, trackerOf, type DisputeRow, type EvidenceRow } from "./casefile";
import { listCalls } from "./calls";
import { now } from "./clock";
import { db } from "./db";
import { aiModelChain, hasAIKey } from "./env";
import { listEvents } from "./events";
import { fromPayPal, parseMinor } from "./money";
import { paypalStatus } from "./paypal/gateway";
import type { PPDispute } from "./paypal/types";
import { REASON_LABEL } from "./rules";
import { DISPUTES } from "./scenario";
import { allowedActions, STAGE_LABEL, TERMINAL, type Stage } from "./workflow";

export type DisputeSummary = {
  id: string;
  scenario: string | null;
  source: "sandbox" | "simulated";
  buyer: string;
  item: string;
  reason: string;
  reasonLabel: string;
  amountMinor: number;
  currency: string;
  stage: Stage;
  stageLabel: string;
  paypalStatus: string;
  openedAt: string;
  dueAt: string | null;
  recommendation: { action: string; confidence: number; offerMinor: number | null } | null;
  outcome: string | null;
  recoveredMinor: number;
};

function summarise(r: DisputeRow): DisputeSummary {
  const d: PPDispute = JSON.parse(r.raw);
  const order = db().prepare("SELECT buyer_name, raw FROM orders WHERE id = ?").get(r.order_id) as { buyer_name: string; raw: string };
  const items = (JSON.parse(order.raw).purchase_units?.[0]?.items ?? []) as { name: string }[];
  const a = r.scenario === "history" ? null : getAnalysis(r.id);
  const amt = fromPayPal(d.dispute_amount);
  const refunded = d.dispute_outcome?.amount_refunded ? parseMinor(d.dispute_outcome.amount_refunded.value, amt.currency) : 0;
  const resolved = d.status === "RESOLVED";
  return {
    id: r.id,
    scenario: r.scenario,
    source: r.source,
    buyer: order.buyer_name,
    item: items.map((i) => i.name).join(", ") || "Order",
    reason: d.reason,
    reasonLabel: REASON_LABEL[d.reason] ?? d.reason,
    amountMinor: amt.minor,
    currency: amt.currency,
    stage: r.stage,
    stageLabel: STAGE_LABEL[r.stage],
    paypalStatus: d.status,
    openedAt: d.create_time,
    dueAt: resolved ? null : (d.status === "WAITING_FOR_BUYER_RESPONSE" ? d.buyer_response_due_date : d.seller_response_due_date) ?? null,
    recommendation: a?.result
      ? { action: a.result.recommendation.action, confidence: a.result.recommendation.confidence, offerMinor: a.result.offerMinor }
      : null,
    outcome: d.dispute_outcome?.outcome_code ?? null,
    recoveredMinor: resolved ? amt.minor - refunded : 0,
  };
}

export async function stateView() {
  const rows = db().prepare("SELECT * FROM disputes ORDER BY created_at DESC").all() as DisputeRow[];
  const all = rows.map(summarise);
  const active = all.filter((d) => d.scenario !== "history");
  const history = all.filter((d) => d.scenario === "history");
  const pp = await paypalStatus();
  const resolvedNow = active.filter((d) => TERMINAL.includes(d.stage));
  return {
    clock: now(),
    status: {
      paypal: pp,
      ai: hasAIKey()
        ? { mode: "live" as const, detail: `Gemini free tier · tries ${aiModelChain().join(" → ")}` }
        : { mode: "recorded" as const, detail: "No Gemini key: recorded analyses" },
    },
    disputes: active,
    history,
    stats: {
      open: active.filter((d) => !TERMINAL.includes(d.stage)).length,
      atStakeMinor: active.filter((d) => !TERMINAL.includes(d.stage)).reduce((s, d) => s + d.amountMinor, 0),
      keptMinor: resolvedNow.reduce((s, d) => s + d.recoveredMinor, 0),
      lostBeforeMinor: history.reduce((s, d) => s + d.amountMinor - d.recoveredMinor, 0),
      currency: "USD",
    },
    director: director(active),
  };
}

// ---- The demo director: what the next story beat is ---------------------------------------------

export type Beat = {
  step: string;
  title: string;
  hint: string;
  disputeId?: string;
  index: number;
  total: number;
};

const BEATS = [
  "open-inr",
  "analyse-inr",
  "approve-inr",
  "decide-inr",
  "open-snad",
  "analyse-snad",
  "approve-snad",
  "buyer-accepts",
  "done",
] as const;

function director(ds: DisputeSummary[]): Beat {
  const inr = ds.find((d) => d.scenario === "inr-mugs");
  const snad = ds.find((d) => d.scenario === "snad-bowl");
  const beat = (step: (typeof BEATS)[number], title: string, hint: string, disputeId?: string): Beat => ({
    step,
    title,
    hint,
    disputeId,
    index: BEATS.indexOf(step) + 1,
    total: BEATS.length,
  });
  if (!inr) return beat("open-inr", "A buyer opens a dispute", "Jordan Reyes says the $84 mug order never arrived. PayPal freezes the money.");
  if (inr.stage === "new" || inr.stage === "analyzing")
    return beat("analyse-inr", "Let Rebuttal build the case", "It pulls the dispute, the payment and the tracking record, then reads the carrier screenshot.", inr.id);
  if (inr.stage === "ready") return beat("approve-inr", "Approve and submit", "Review the draft response and evidence pack, then submit through the Disputes API.", inr.id);
  if (inr.stage === "submitted") return beat("decide-inr", "Jump 3 days: PayPal reviews", "The sandbox plays PayPal and adjudicates the case.", inr.id);
  if (!snad) return beat("open-snad", "A second dispute arrives", "Priya Natarajan says the cobalt bowl is the wrong colour.");
  if (snad.stage === "new" || snad.stage === "analyzing")
    return beat("analyse-snad", "Analyse the second dispute", "This time the evidence is weaker. Watch what the agent recommends.", snad.id);
  if (snad.stage === "ready") return beat("approve-snad", "Send the partial-refund offer", "Fighting would likely lose. A partial refund keeps most of the sale.", snad.id);
  if (snad.stage === "offered") return beat("buyer-accepts", "Jump 1 day: the buyer responds", "The sandbox plays the buyer and accepts the offer.", snad.id);
  return beat("done", "That’s the story", "Two disputes handled in minutes. Reset to run it again.");
}

// ---- Dispute detail ---------------------------------------------------------------------------

export async function disputeView(id: string) {
  const c = loadCase(id);
  if (!c) return null;
  const analysis = getAnalysis(id);
  const scenario = DISPUTES.find((d) => d.key === c.row.scenario);
  return {
    summary: summarise(c.row),
    claim: c.row.buyer_claim,
    paypal: c.dispute,
    actions: allowedActions(c.row.stage, c.dispute),
    order: {
      id: c.order.id,
      paypalOrderId: c.order.paypal_order_id,
      captureId: c.order.capture_id,
      buyerTransactionId: c.order.buyer_transaction_id,
      buyerEmail: c.order.buyer_email,
      paidAt: c.order.paid_at,
      amountMinor: c.order.amount_minor,
      currency: c.order.currency,
      shipTo: formatAddress(c.orderJson),
      items: c.orderJson.purchase_units?.[0]?.items ?? [],
      source: c.order.source,
      tracker: trackerOf(c),
      trackerAddedAt: c.tracking?.addedAt ?? null,
    },
    evidence: c.evidence.map((e: EvidenceRow) => ({ id: e.id, kind: e.kind, title: e.title, file: e.file, mime: e.mime, text: e.text })),
    analysis,
    events: listEvents(id),
    calls: listCalls(id),
    dueDays: scenario?.dueDays ?? 10,
  };
}
