/**
 * A pure, deterministic model of the PayPal sandbox dispute lifecycle. It produces
 * dispute JSON in the documented "show dispute details" shape, and is used whenever
 * a step cannot (or should not) be sent to the real sandbox. Transitions mirror the
 * behaviour documented at developer.paypal.com/disputes/test-go-live and observed in
 * the recorded fixtures under fixtures/paypal/lifecycle.
 */
import { toPayPalValue } from "../money";
import type { DisputeReason, PPDispute, PPEvidence, PPLink, PPMoney } from "./types";

export class SimError extends Error {
  constructor(
    public status: number,
    public body: { name: string; message: string; details: { issue: string; description?: string }[] },
  ) {
    super(`${body.name}: ${body.details[0]?.issue}`);
  }
}

const BASE = "https://api-m.sandbox.paypal.com/v1/customer/disputes/";

function links(id: string, rels: string[]): PPLink[] {
  return [
    { href: BASE + id, rel: "self", method: "GET" },
    ...rels.map((rel) => ({ href: `${BASE}${id}/${rel.replace(/_/g, "-")}`, rel, method: "POST" })),
  ];
}

function refuse(issue: string, description: string): never {
  throw new SimError(422, {
    name: "UNPROCESSABLE_ENTITY",
    message: "The requested action could not be performed, semantically incorrect, or failed business validation.",
    details: [{ issue, description }],
  });
}

export const subsequentAction = (id: string) => ({ links: [{ href: BASE + id, rel: "self", method: "GET" }] });

export function simCreate(input: {
  id: string;
  buyerTransactionId: string;
  sellerTransactionId: string;
  transactionTime: string;
  buyerName: string;
  seller: { email: string; merchantId: string; name: string };
  reason: DisputeReason;
  amountMinor: number;
  currency: string;
  now: string;
  dueDays: number;
}): PPDispute {
  const amount: PPMoney = { currency_code: input.currency, value: toPayPalValue(input.amountMinor, input.currency) };
  const due = new Date(Date.parse(input.now) + input.dueDays * 86_400_000).toISOString();
  const requested =
    input.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
      ? "PROOF_OF_FULFILLMENT"
      : input.reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"
        ? "ITEM_DESCRIPTION"
        : "OTHER";
  return {
    dispute_id: input.id,
    create_time: input.now,
    update_time: input.now,
    disputed_transactions: [
      {
        buyer_transaction_id: input.buyerTransactionId,
        seller_transaction_id: input.sellerTransactionId,
        create_time: input.transactionTime,
        transaction_status: "COMPLETED",
        gross_amount: amount,
        buyer: { name: input.buyerName },
        seller: { email: input.seller.email, merchant_id: input.seller.merchantId, name: input.seller.name },
        seller_protection_eligible: true,
      },
    ],
    reason: input.reason,
    status: "WAITING_FOR_SELLER_RESPONSE",
    dispute_amount: amount,
    dispute_life_cycle_stage: "INQUIRY",
    dispute_channel: "INTERNAL",
    seller_response_due_date: due,
    evidences: [{ evidence_type: requested, source: "REQUESTED_FROM_SELLER", date: input.now }],
    offer: { buyer_requested_amount: amount },
    extensions: {
      merchant_contacted: true,
      merchant_contacted_outcome: "NO_RESPONSE",
      merchandize_dispute_properties: { issue_type: "PRODUCT" },
    },
    links: links(input.id, ["provide_evidence", "make_offer", "accept_claim", "escalate", "send_message"]),
  };
}

function next(d: PPDispute, now: string, patch: Partial<PPDispute>): PPDispute {
  return { ...structuredClone(d), ...patch, update_time: now };
}

function requireStatus(d: PPDispute, status: PPDispute["status"], action: string) {
  if (d.status !== status) refuse("INVALID_DISPUTE_STATE", `${action} needs status ${status}; dispute is ${d.status}.`);
}

export function simProvideEvidence(d: PPDispute, evidences: PPEvidence[], now: string): PPDispute {
  requireStatus(d, "WAITING_FOR_SELLER_RESPONSE", "provide-evidence");
  const submitted = evidences.map((e) => ({ ...e, source: "SUBMITTED_BY_SELLER", date: now }));
  return next(d, now, {
    status: "UNDER_REVIEW",
    evidences: [...(d.evidences ?? []).filter((e) => e.source !== "REQUESTED_FROM_SELLER"), ...submitted],
    links: links(d.dispute_id, ["adjudicate", "require_evidence"]),
  });
}

export function simMakeOffer(
  d: PPDispute,
  offer: { offer_amount: PPMoney; offer_type: string; note: string },
  now: string,
): PPDispute {
  requireStatus(d, "WAITING_FOR_SELLER_RESPONSE", "make-offer");
  return next(d, now, {
    status: "WAITING_FOR_BUYER_RESPONSE",
    buyer_response_due_date: new Date(Date.parse(now) + 10 * 86_400_000).toISOString(),
    offer: {
      buyer_requested_amount: d.offer?.buyer_requested_amount ?? d.dispute_amount,
      seller_offered_amount: offer.offer_amount,
      offer_type: offer.offer_type,
      history: [
        ...(d.offer?.history ?? []),
        { offer_time: now, actor: "SELLER", event_type: "PROPOSED", offer_type: offer.offer_type, offer_amount: offer.offer_amount },
      ],
    },
    messages: [...(d.messages ?? []), { posted_by: "SELLER", time_posted: now, content: offer.note }],
    links: links(d.dispute_id, ["send_message"]),
  });
}

export function simAcceptOffer(d: PPDispute, now: string): PPDispute {
  requireStatus(d, "WAITING_FOR_BUYER_RESPONSE", "accept-offer");
  const offered = d.offer?.seller_offered_amount;
  if (!offered) refuse("NO_OFFER", "There is no seller offer to accept.");
  return next(d, now, {
    status: "RESOLVED",
    dispute_outcome: { outcome_code: "RESOLVED_WITH_PAYOUT", amount_refunded: offered },
    offer: {
      ...d.offer,
      history: [
        ...(d.offer?.history ?? []),
        { offer_time: now, actor: "BUYER", event_type: "ACCEPTED", offer_type: d.offer?.offer_type ?? "REFUND", offer_amount: offered },
      ],
    },
    links: links(d.dispute_id, []),
  });
}

export function simAcceptClaim(d: PPDispute, now: string): PPDispute {
  if (d.status === "RESOLVED") refuse("INVALID_DISPUTE_STATE", "Dispute is already resolved.");
  return next(d, now, {
    status: "RESOLVED",
    dispute_outcome: { outcome_code: "RESOLVED_BUYER_FAVOUR", amount_refunded: d.dispute_amount },
    links: links(d.dispute_id, []),
  });
}

export function simEscalate(d: PPDispute, now: string): PPDispute {
  if (d.dispute_life_cycle_stage !== "INQUIRY") refuse("INVALID_DISPUTE_STATE", "Only inquiries can be escalated.");
  return next(d, now, { dispute_life_cycle_stage: "CHARGEBACK" });
}

export function simAdjudicate(d: PPDispute, outcome: "SELLER_FAVOR" | "BUYER_FAVOR", now: string): PPDispute {
  requireStatus(d, "UNDER_REVIEW", "adjudicate");
  return next(d, now, {
    status: "RESOLVED",
    dispute_outcome:
      outcome === "SELLER_FAVOR"
        ? { outcome_code: "RESOLVED_SELLER_FAVOUR" }
        : { outcome_code: "RESOLVED_BUYER_FAVOUR", amount_refunded: d.dispute_amount },
    links: links(d.dispute_id, []),
  });
}

export function simRequireEvidence(d: PPDispute, action: "BUYER_EVIDENCE" | "SELLER_EVIDENCE", now: string): PPDispute {
  requireStatus(d, "UNDER_REVIEW", "require-evidence");
  return next(d, now, {
    status: action === "SELLER_EVIDENCE" ? "WAITING_FOR_SELLER_RESPONSE" : "WAITING_FOR_BUYER_RESPONSE",
    links: links(d.dispute_id, action === "SELLER_EVIDENCE" ? ["provide_evidence", "accept_claim"] : []),
  });
}
