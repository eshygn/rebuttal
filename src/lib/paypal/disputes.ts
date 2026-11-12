/**
 * Live PayPal Disputes API v1 client. The PayPal Server SDK has no disputes controller,
 * so these are plain REST calls shaped from the official OpenAPI schema
 * (developer.paypal.com/api/customer-disputes/v1/schema.json).
 */
import { buyerAuthAssertion, paypalRequest, type FilePart } from "./http";
import type { PPDispute, PPDisputeList, PPEvidence, PPMoney, PPSubsequentAction, DisputeReason } from "./types";

const base = "/v1/customer/disputes";

// ---- Seller endpoints -------------------------------------------------------

export const listDisputes = (query = "page_size=50") =>
  paypalRequest<PPDisputeList>({ method: "GET", path: `${base}?${query}`, label: "List disputes" });

export const showDispute = (id: string) =>
  paypalRequest<PPDispute>({ method: "GET", path: `${base}/${id}`, label: "Show dispute details" });

export function provideEvidence(
  id: string,
  evidences: PPEvidence[],
  files: Omit<FilePart, "kind" | "name">[] = [],
) {
  return paypalRequest<PPSubsequentAction>({
    method: "POST",
    path: `${base}/${id}/provide-evidence`,
    label: "Provide evidence",
    multipart: [
      { kind: "json", name: "input", value: { evidences } },
      ...files.map((f) => ({ kind: "file" as const, name: "evidence_file", ...f })),
    ],
  });
}

export const makeOffer = (
  id: string,
  body: { note: string; offer_amount: PPMoney; offer_type: "REFUND" | "REFUND_WITH_RETURN" | "REFUND_WITH_REPLACEMENT" },
) => paypalRequest<PPSubsequentAction>({ method: "POST", path: `${base}/${id}/make-offer`, json: body, label: "Make offer" });

export const acceptClaim = (id: string, body: { note: string; accept_claim_type?: "REFUND" | "PARTIAL_REFUND"; refund_amount?: PPMoney }) =>
  paypalRequest<PPSubsequentAction>({
    method: "POST",
    path: `${base}/${id}/accept-claim`,
    label: "Accept claim",
    multipart: [{ kind: "json", name: "input", value: body }],
  });

export const escalate = (id: string, note: string) =>
  paypalRequest<PPSubsequentAction>({ method: "POST", path: `${base}/${id}/escalate`, json: { note }, label: "Escalate to claim" });

// ---- Sandbox-only endpoints that play the buyer and PayPal -------------------

export function createDisputeAsBuyer(input: {
  buyer_transaction_id: string;
  reason: DisputeReason;
  amount: PPMoney;
  issue_type?: "PRODUCT" | "SERVICE";
}) {
  return paypalRequest<PPSubsequentAction>({
    method: "POST",
    path: base,
    actor: "buyer",
    label: "Sandbox · buyer opens dispute",
    assertion: buyerAuthAssertion(),
    multipart: [
      {
        kind: "json",
        name: "input",
        value: {
          disputed_transactions: [{ buyer_transaction_id: input.buyer_transaction_id }],
          reason: input.reason,
          dispute_amount: input.amount,
          extensions: {
            merchant_contacted: true,
            merchant_contacted_outcome: "NO_RESPONSE",
            merchandize_dispute_properties: { issue_type: input.issue_type ?? "PRODUCT" },
          },
        },
      },
    ],
  });
}

export const acceptOfferAsBuyer = (id: string, note: string) =>
  paypalRequest<PPSubsequentAction>({
    method: "POST",
    path: `${base}/${id}/accept-offer`,
    actor: "buyer",
    label: "Sandbox · buyer accepts offer",
    assertion: buyerAuthAssertion(),
    json: { note },
  });

export const adjudicate = (id: string, outcome: "SELLER_FAVOR" | "BUYER_FAVOR") =>
  paypalRequest<PPSubsequentAction>({
    method: "POST",
    path: `${base}/${id}/adjudicate`,
    actor: "paypal",
    label: `Sandbox · PayPal adjudicates (${outcome})`,
    json: { adjudication_outcome: outcome },
  });
