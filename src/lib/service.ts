/** Orchestration: every user-visible action goes through here. */
import { analyse, getAnalysis } from "./ai/agent";
import { evidenceBytes, loadCase, type CaseFile } from "./casefile";
import { recordCall, withDispute } from "./calls";
import { advance, now } from "./clock";
import { db, resetDemo } from "./db";
import { env } from "./env";
import { logEvent } from "./events";
import { formatMoney, fromPayPal as moneyFrom, toPayPal } from "./money";
import * as live from "./paypal/disputes";
import { paypalLive, readDispute, runAction } from "./paypal/gateway";
import { PayPalApiError } from "./paypal/http";
import { preflight } from "./paypal/preflight";
import {
  simAcceptClaim,
  simAcceptOffer,
  simAdjudicate,
  simCreate,
  simMakeOffer,
  simProvideEvidence,
  subsequentAction,
} from "./paypal/sim";
import { disputeIdFromLinks, type PPDispute, type PPEvidence } from "./paypal/types";
import type { Action } from "./rules";
import { DISPUTES, ORDERS, SELLER } from "./scenario";
import { fromPayPal, transition, type Stage } from "./workflow";

function save(id: string, d: PPDispute, stage?: Stage) {
  const cur = db().prepare("SELECT stage FROM disputes WHERE id = ?").get(id) as { stage: Stage };
  const next = fromPayPal(stage ?? cur.stage, d);
  db().prepare("UPDATE disputes SET raw = ?, stage = ? WHERE id = ?").run(JSON.stringify(d), next, id);
  return next;
}

function mustLoad(id: string): CaseFile {
  const c = loadCase(id);
  if (!c) throw new Error(`No dispute ${id}`);
  return c;
}

// ---- Buyer opens a dispute (sandbox create-dispute, or simulated) ---------------------------

export async function openScenarioDispute(key: string): Promise<{ id: string; mode: "live" | "simulated"; note?: string }> {
  const s = DISPUTES.find((d) => d.key === key);
  if (!s) throw new Error(`Unknown scenario ${key}`);
  const existing = db().prepare("SELECT id FROM disputes WHERE scenario = ?").get(key) as { id: string } | undefined;
  if (existing) return { id: existing.id, mode: "simulated" };
  const o = ORDERS.find((x) => x.id === s.orderId)!;
  const at = now();
  const txn = key === "inr-mugs" ? env.inrTransactionId : key === "snad-bowl" ? env.snadTransactionId : "";
  const amount = toPayPal({ minor: s.amountMinor, currency: o.currency });

  let raw: PPDispute | null = null;
  let note: string | undefined;
  if (txn && (await paypalLive())) {
    let diagnosis: string[] = [];
    try {
      // Look the payment up first: PayPal's refusal alone ("TRANSACTION_NOT_ELIGIBLE") doesn't say why.
      const check = await withDispute(undefined, () => preflight(txn));
      diagnosis = check.problems;
      const created = await withDispute(undefined, () =>
        live.createDisputeAsBuyer({ buyer_transaction_id: txn, reason: s.reason, amount: check.amount ?? amount }),
      );
      const id = disputeIdFromLinks(created.body);
      if (!id) throw new Error("create-dispute returned no dispute id");
      raw = await withDispute(id, async () => {
        for (let i = 0; i < 8; i++) {
          try {
            return (await live.showDispute(id)).body;
          } catch (e) {
            if (!(e instanceof PayPalApiError && e.status === 404)) throw e;
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
        throw new Error("Sandbox dispute not visible yet");
      });
      db().prepare("UPDATE orders SET buyer_transaction_id = ? WHERE id = ?").run(txn, o.id);
    } catch (e) {
      note = `Sandbox create-dispute refused (${e instanceof PayPalApiError ? (e.issue ?? e.status) : (e as Error).message})${diagnosis.length ? `: ${diagnosis.join(" ")}` : ""} Simulated instead.`;
    }
  } else {
    note = txn ? "PayPal not reachable; simulated" : "No sandbox transaction configured for this dispute; simulated";
  }

  const source = raw ? "sandbox" : "simulated";
  if (!raw) {
    raw = simCreate({
      id: s.id,
      buyerTransactionId: o.buyerTxnId,
      sellerTransactionId: o.captureId,
      transactionTime: o.paidAt,
      buyerName: `${o.buyer.given} ${o.buyer.surname}`,
      seller: { email: SELLER.email, merchantId: SELLER.merchantId, name: SELLER.name },
      reason: s.reason,
      amountMinor: s.amountMinor,
      currency: o.currency,
      now: at,
      dueDays: s.dueDays,
    });
    await withDispute(raw.dispute_id, async () => {
      recordCall({
        at,
        method: "POST",
        path: "/v1/customer/disputes",
        status: 201,
        mode: "simulated",
        actor: "buyer",
        label: "Sandbox · buyer opens dispute",
        request: { disputed_transactions: [{ buyer_transaction_id: o.buyerTxnId }], reason: s.reason, dispute_amount: amount },
        response: subsequentAction(raw!.dispute_id),
        note,
      });
    });
  }
  db()
    .prepare("INSERT INTO disputes (id, scenario, order_id, source, buyer_claim, stage, raw, created_at) VALUES (?, ?, ?, ?, ?, 'new', ?, ?)")
    .run(raw.dispute_id, key, o.id, source, s.claim, JSON.stringify(raw), at);
  logEvent(raw.dispute_id, "opened", `${o.buyer.given} ${o.buyer.surname} opened a case: ${s.claim}`);
  return { id: raw.dispute_id, mode: source === "sandbox" ? "live" : "simulated", note };
}

// ---- Analysis --------------------------------------------------------------------------------

export function startAnalysis(id: string, pace?: number) {
  const c = mustLoad(id);
  if (c.row.stage !== "new" && c.row.stage !== "ready") throw new Error(`Dispute is ${c.row.stage}; nothing to analyse`);
  // Runs in the background; the UI polls the analysis row for the live trace.
  void analyse(id, { pace });
}

// ---- Approve and submit ------------------------------------------------------------------------

export type Approval = { action: Action; note?: string; offerMinor?: number };

function evidencesFor(c: CaseFile, note: string): PPEvidence[] {
  const t = c.tracking;
  if (c.dispute.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" && t) {
    return [
      {
        evidence_type: "PROOF_OF_FULFILLMENT",
        evidence_info: {
          tracking_info: [{ carrier_name: t.carrier, ...(t.carrierOther ? { carrier_name_other: t.carrierOther } : {}), tracking_number: t.number }],
        },
        notes: note.slice(0, 2000),
      },
    ];
  }
  return [{ evidence_type: "OTHER", notes: note.slice(0, 2000) }];
}

export async function approve(id: string, a: Approval) {
  const c = mustLoad(id);
  const analysis = getAnalysis(id);
  const rec = analysis?.result?.recommendation;
  transition(c.row.stage, { type: "APPROVE", action: a.action }); // throws if not allowed
  const note = (a.note ?? rec?.response_to_paypal ?? "").trim();
  const amountCur = c.dispute.dispute_amount.currency_code;

  return withDispute(id, async () => {
    if (a.action === "fight") {
      const attach = c.evidence.filter((e) => e.file && (rec?.evidence_to_attach ?? []).includes(e.id) && e.kind !== "buyer_photo");
      const files = attach
        .map((e) => ({ e, bytes: evidenceBytes(e) }))
        .filter((x) => x.bytes)
        .map(({ e, bytes }) => ({ filename: e.file!.split("/").pop()!, contentType: e.mime ?? "image/png", data: bytes! }));
      const evidences = evidencesFor(c, note);
      const r = await runAction(
        c.dispute,
        c.row.source,
        {
          label: "Provide evidence",
          actor: "seller",
          method: "POST",
          path: `/v1/customer/disputes/${id}/provide-evidence`,
          request: { input: { evidences }, evidence_file: files.map((f) => f.filename) },
          live: () => live.provideEvidence(id, evidences, files),
          sim: (d, at) => simProvideEvidence(d, evidences.map((e) => ({ ...e, documents: files.map((f) => ({ name: f.filename })) })), at),
        },
        (d) => d.status !== "WAITING_FOR_SELLER_RESPONSE",
      );
      save(id, r.dispute, "submitted");
      logEvent(id, "submitted", `Evidence pack submitted to PayPal (${files.length} document${files.length === 1 ? "" : "s"})${r.mode === "simulated" ? " · simulated" : ""}`);
      return r;
    }
    if (a.action === "offer") {
      const offerMinor = a.offerMinor ?? analysis?.result?.offerMinor;
      if (!offerMinor) throw new Error("No offer amount");
      const body = { note, offer_amount: toPayPal({ minor: offerMinor, currency: amountCur }), offer_type: "REFUND" as const };
      const r = await runAction(
        c.dispute,
        c.row.source,
        {
          label: "Make offer",
          actor: "seller",
          method: "POST",
          path: `/v1/customer/disputes/${id}/make-offer`,
          request: body,
          live: () => live.makeOffer(id, body),
          sim: (d, at) => simMakeOffer(d, body, at),
        },
        (d) => d.status !== "WAITING_FOR_SELLER_RESPONSE",
      );
      save(id, r.dispute, "offered");
      logEvent(id, "offer", `Offered a ${formatMoney({ minor: offerMinor, currency: amountCur })} partial refund${r.mode === "simulated" ? " · simulated" : ""}`);
      return r;
    }
    const body = { note, accept_claim_type: "REFUND" as const };
    const r = await runAction(
      c.dispute,
      c.row.source,
      {
        label: "Accept claim",
        actor: "seller",
        method: "POST",
        path: `/v1/customer/disputes/${id}/accept-claim`,
        request: body,
        live: () => live.acceptClaim(id, body),
        sim: (d, at) => simAcceptClaim(d, at),
      },
      (d) => d.status === "RESOLVED",
    );
    save(id, r.dispute, "refunded");
    logEvent(id, "resolved", `Refunded ${formatMoney(moneyFrom(c.dispute.dispute_amount))} in full${r.mode === "simulated" ? " · simulated" : ""}`);
    return r;
  });
}

// ---- Sandbox-only moves that play PayPal and the buyer ------------------------------------------

export async function paypalDecides(id: string, outcome: "SELLER_FAVOR" | "BUYER_FAVOR") {
  const c = mustLoad(id);
  return withDispute(id, async () => {
    const r = await runAction(
      c.dispute,
      c.row.source,
      {
        label: `Sandbox · PayPal adjudicates (${outcome})`,
        actor: "paypal",
        method: "POST",
        path: `/v1/customer/disputes/${id}/adjudicate`,
        request: { adjudication_outcome: outcome },
        live: () => live.adjudicate(id, outcome),
        sim: (d, at) => simAdjudicate(d, outcome, at),
      },
      (d) => d.status === "RESOLVED",
    );
    const stage = save(id, r.dispute);
    logEvent(id, "resolved", stage === "won" ? "PayPal ruled in your favour. The hold is released." : "PayPal ruled for the buyer.");
    return r;
  });
}

export async function buyerAcceptsOffer(id: string) {
  const c = mustLoad(id);
  return withDispute(id, async () => {
    const r = await runAction(
      c.dispute,
      c.row.source,
      {
        label: "Sandbox · buyer accepts offer",
        actor: "buyer",
        method: "POST",
        path: `/v1/customer/disputes/${id}/accept-offer`,
        request: { note: "Thanks, that works for me." },
        live: () => live.acceptOfferAsBuyer(id, "Thanks, that works for me."),
        sim: (d, at) => simAcceptOffer(d, at),
      },
      (d) => d.status === "RESOLVED",
    );
    save(id, r.dispute);
    const off = r.dispute.offer?.seller_offered_amount ?? c.dispute.offer?.seller_offered_amount;
    logEvent(id, "resolved", `The buyer accepted the offer${off ? ` of ${off.value} ${off.currency_code}` : ""}. Case closed.`);
    return r;
  });
}

export async function syncDispute(id: string) {
  const c = mustLoad(id);
  return withDispute(id, async () => {
    const r = await readDispute(c.dispute, c.row.source);
    save(id, r.dispute);
    return r;
  });
}

// ---- Demo controls ----------------------------------------------------------------------------

export function reset() {
  resetDemo();
}

export function jumpClock(hours: number) {
  const at = advance(hours * 3_600_000);
  logEvent(null, "clock", `Demo clock moved forward ${hours >= 24 ? `${hours / 24} day${hours === 24 ? "" : "s"}` : `${hours} h`}`);
  return at;
}
