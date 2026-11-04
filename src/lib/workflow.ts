/**
 * Rebuttal's own workflow for a dispute, layered over PayPal's status.
 *
 *   new ──analyze──▶ analyzing ──done──▶ ready ──approve(fight)──▶ submitted ──PayPal rules──▶ won | lost
 *                        │                  ├──approve(offer)───▶ offered ──buyer accepts──▶ settled
 *                        └──fail──▶ new     │                          └──buyer declines──▶ ready
 *                                           └──approve(accept)──▶ refunded
 */
import type { Action } from "./rules";
import type { PPDispute } from "./paypal/types";

export type Stage = "new" | "analyzing" | "ready" | "submitted" | "offered" | "won" | "lost" | "settled" | "refunded";

export type WorkflowEvent =
  | { type: "ANALYZE" }
  | { type: "ANALYSIS_DONE" }
  | { type: "ANALYSIS_FAILED" }
  | { type: "APPROVE"; action: Action }
  | { type: "PAYPAL_UPDATE"; dispute: PPDispute };

export const TERMINAL: Stage[] = ["won", "lost", "settled", "refunded"];

export class TransitionError extends Error {}

export function transition(stage: Stage, ev: WorkflowEvent): Stage {
  const bad = () => {
    throw new TransitionError(`Cannot ${ev.type}${"action" in ev ? `(${ev.action})` : ""} from “${stage}”`);
  };
  switch (ev.type) {
    case "ANALYZE":
      return stage === "new" || stage === "ready" ? "analyzing" : bad();
    case "ANALYSIS_DONE":
      return stage === "analyzing" ? "ready" : bad();
    case "ANALYSIS_FAILED":
      return stage === "analyzing" ? "new" : bad();
    case "APPROVE":
      if (stage !== "ready") return bad();
      return ev.action === "fight" ? "submitted" : ev.action === "offer" ? "offered" : "refunded";
    case "PAYPAL_UPDATE":
      return fromPayPal(stage, ev.dispute);
  }
}

/** Fold PayPal's status into our stage. Only moves forward; never un-resolves a dispute. */
export function fromPayPal(stage: Stage, d: PPDispute): Stage {
  if (TERMINAL.includes(stage)) return stage;
  if (d.status === "RESOLVED") {
    const code = d.dispute_outcome?.outcome_code;
    if (code === "RESOLVED_SELLER_FAVOUR" || code === "CANCELED_BY_BUYER") return "won";
    if (code === "RESOLVED_WITH_PAYOUT") return "settled";
    if (stage === "offered" && d.offer?.history?.some((h) => h.event_type === "ACCEPTED")) return "settled";
    return stage === "refunded" ? "refunded" : "lost";
  }
  // Buyer declined an offer: the dispute is back with the seller.
  if (stage === "offered" && d.status === "WAITING_FOR_SELLER_RESPONSE") return "ready";
  return stage;
}

export function allowedActions(stage: Stage, d: PPDispute): Action[] {
  if (stage !== "ready") return [];
  const rels = new Set(d.links.map((l) => l.rel));
  const out: Action[] = [];
  if (rels.has("provide_evidence")) out.push("fight");
  if (rels.has("make_offer")) out.push("offer");
  if (rels.has("accept_claim")) out.push("accept");
  return out;
}

export const STAGE_LABEL: Record<Stage, string> = {
  new: "Needs review",
  analyzing: "Analysing",
  ready: "Awaiting your approval",
  submitted: "Evidence submitted",
  offered: "Offer sent",
  won: "Won",
  lost: "Lost",
  settled: "Settled",
  refunded: "Refunded",
};
