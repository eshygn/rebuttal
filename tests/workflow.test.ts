import { describe, expect, it } from "vitest";
import { simAcceptClaim, simAcceptOffer, simAdjudicate, simCreate, simMakeOffer, simProvideEvidence, simRequireEvidence, SimError } from "@/lib/paypal/sim";
import { allowedActions, fromPayPal, transition, TransitionError } from "@/lib/workflow";

const T0 = "2026-11-07T18:00:00.000Z";
const fresh = () =>
  simCreate({
    id: "PP-D-1",
    buyerTransactionId: "BUYER",
    sellerTransactionId: "SELLER",
    transactionTime: "2026-11-02T23:00:00.000Z",
    buyerName: "Jordan Reyes",
    seller: { email: "s@example.com", merchantId: "M", name: "Shop" },
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    amountMinor: 8400,
    currency: "USD",
    now: T0,
    dueDays: 10,
  });

describe("sandbox simulator (PayPal dispute state machine)", () => {
  it("opens a dispute waiting on the seller, with a deadline and seller actions", () => {
    const d = fresh();
    expect(d.status).toBe("WAITING_FOR_SELLER_RESPONSE");
    expect(d.dispute_life_cycle_stage).toBe("INQUIRY");
    expect(d.dispute_amount).toEqual({ currency_code: "USD", value: "84.00" });
    expect(d.seller_response_due_date).toBe("2026-11-17T18:00:00.000Z");
    expect(d.links.map((l) => l.rel)).toEqual(expect.arrayContaining(["provide_evidence", "make_offer", "accept_claim"]));
  });

  it("runs the INR lifecycle: evidence → under review → seller wins", () => {
    let d = simProvideEvidence(fresh(), [{ evidence_type: "PROOF_OF_FULFILLMENT", notes: "Delivered" }], T0);
    expect(d.status).toBe("UNDER_REVIEW");
    expect(d.evidences?.at(-1)?.source).toBe("SUBMITTED_BY_SELLER");
    expect(d.links.map((l) => l.rel)).toContain("adjudicate");
    d = simAdjudicate(d, "SELLER_FAVOR", T0);
    expect(d.status).toBe("RESOLVED");
    expect(d.dispute_outcome?.outcome_code).toBe("RESOLVED_SELLER_FAVOUR");
  });

  it("runs the offer lifecycle: offer → waiting for buyer → accepted with payout", () => {
    let d = simMakeOffer(fresh(), { offer_amount: { currency_code: "USD", value: "26.00" }, offer_type: "REFUND", note: "Offer" }, T0);
    expect(d.status).toBe("WAITING_FOR_BUYER_RESPONSE");
    expect(d.offer?.seller_offered_amount?.value).toBe("26.00");
    d = simAcceptOffer(d, T0);
    expect(d.status).toBe("RESOLVED");
    expect(d.dispute_outcome).toEqual({ outcome_code: "RESOLVED_WITH_PAYOUT", amount_refunded: { currency_code: "USD", value: "26.00" } });
  });

  it("refuses out-of-order moves the way the sandbox does", () => {
    expect(() => simAdjudicate(fresh(), "SELLER_FAVOR", T0)).toThrow(SimError);
    expect(() => simAcceptOffer(fresh(), T0)).toThrow(SimError);
    const resolved = simAcceptClaim(fresh(), T0);
    expect(() => simProvideEvidence(resolved, [], T0)).toThrow(SimError);
    expect(() => simAcceptClaim(resolved, T0)).toThrow(SimError);
  });

  it("can send a reviewed dispute back for more seller evidence", () => {
    const d = simRequireEvidence(simProvideEvidence(fresh(), [], T0), "SELLER_EVIDENCE", T0);
    expect(d.status).toBe("WAITING_FOR_SELLER_RESPONSE");
  });

  it("does not mutate its input", () => {
    const d = fresh();
    const copy = structuredClone(d);
    simProvideEvidence(d, [{ evidence_type: "OTHER" }], T0);
    expect(d).toEqual(copy);
  });
});

describe("Rebuttal workflow", () => {
  it("walks the fight path", () => {
    let s = transition("new", { type: "ANALYZE" });
    s = transition(s, { type: "ANALYSIS_DONE" });
    expect(s).toBe("ready");
    s = transition(s, { type: "APPROVE", action: "fight" });
    expect(s).toBe("submitted");
    const won = simAdjudicate(simProvideEvidence(fresh(), [], T0), "SELLER_FAVOR", T0);
    expect(transition(s, { type: "PAYPAL_UPDATE", dispute: won })).toBe("won");
  });

  it("walks the offer path and settles when the buyer accepts", () => {
    const offered = simMakeOffer(fresh(), { offer_amount: { currency_code: "USD", value: "26.00" }, offer_type: "REFUND", note: "" }, T0);
    expect(transition("ready", { type: "APPROVE", action: "offer" })).toBe("offered");
    expect(fromPayPal("offered", offered)).toBe("offered");
    expect(fromPayPal("offered", simAcceptOffer(offered, T0))).toBe("settled");
  });

  it("returns to ready if the buyer declines and the dispute is back with the seller", () => {
    expect(fromPayPal("offered", fresh())).toBe("ready");
  });

  it("marks accepted claims refunded and lost adjudications lost", () => {
    expect(transition("ready", { type: "APPROVE", action: "accept" })).toBe("refunded");
    expect(fromPayPal("refunded", simAcceptClaim(fresh(), T0))).toBe("refunded");
    const lost = simAdjudicate(simProvideEvidence(fresh(), [], T0), "BUYER_FAVOR", T0);
    expect(fromPayPal("submitted", lost)).toBe("lost");
  });

  it("rejects illegal transitions", () => {
    expect(() => transition("new", { type: "APPROVE", action: "fight" })).toThrow(TransitionError);
    expect(() => transition("submitted", { type: "ANALYZE" })).toThrow(TransitionError);
    expect(() => transition("ready", { type: "ANALYSIS_DONE" })).toThrow(TransitionError);
  });

  it("never un-resolves a terminal stage", () => {
    expect(fromPayPal("won", fresh())).toBe("won");
  });

  it("offers only the actions PayPal's HATEOAS links allow", () => {
    expect(allowedActions("ready", fresh())).toEqual(["fight", "offer", "accept"]);
    expect(allowedActions("ready", simProvideEvidence(fresh(), [], T0))).toEqual([]);
    expect(allowedActions("new", fresh())).toEqual([]);
  });
});

describe("sandbox preflight", () => {
  it("explains why a transaction cannot be disputed (the case seen on 4 Nov 2026)", async () => {
    const { judge } = await import("@/lib/paypal/preflight");
    const capture = JSON.parse(
      (await import("node:fs")).readFileSync("fixtures/paypal/recorded/3KV701938H745371C-capture-lookup.json", "utf8"),
    );
    const r = judge(capture, "sb-seller@business.example.com");
    expect(r.ok).toBe(false);
    expect(r.amount).toEqual({ currency_code: "GBP", value: "40.00" });
    expect(r.problems.join(" ")).toMatch(/business \(seller\) account/);
    expect(r.problems.join(" ")).toMatch(/made to a personal account/);
    expect(r.problems.join(" ")).toMatch(/PENDING \(UNILATERAL\)/);
  });

  it("passes a completed payment to the seller from a personal buyer", async () => {
    const { judge } = await import("@/lib/paypal/preflight");
    const r = judge(
      { id: "X", status: "COMPLETED", amount: { currency_code: "USD", value: "84.00" }, payee: { email_address: "sb-shop@business.example.com" } },
      "sb-buyer@personal.example.com",
    );
    expect(r).toMatchObject({ ok: true, problems: [] });
  });

  it("redacts sandbox emails and merchant ids before fixtures are committed", async () => {
    const { redact } = await import("@/lib/paypal/preflight");
    expect(redact({ payee: { email_address: "sb-3j7yv53688109@personal.example.com", merchant_id: "Q2WPLANASGYGN" } })).toEqual({
      payee: { email_address: "sb-3j7y…@personal.example.com", merchant_id: "Q2WP…" },
    });
  });
});

describe("create-dispute refusals", () => {
  it("reads PayPal's OAuth-shaped error and explains the missing buyer consent (seen 12 Nov 2026)", async () => {
    const { PayPalApiError } = await import("@/lib/paypal/http");
    const { explainCreateRefusal } = await import("@/lib/paypal/preflight");
    const body = { error: "invalid_request", error_description: "No permissions to set target_client_id" };
    const e = new PayPalApiError(400, body, "/v1/customer/disputes");
    expect(e.message).toContain("No permissions to set target_client_id");
    expect(e.issue).toBe("invalid_request: No permissions to set target_client_id");
    expect(explainCreateRefusal(body)).toMatch(/consent/);
  });

  it("still reads the REST-shaped error", async () => {
    const { PayPalApiError } = await import("@/lib/paypal/http");
    const e = new PayPalApiError(400, { name: "INVALID_REQUEST", details: [{ issue: "TRANSACTION_NOT_ELIGIBLE" }] }, "/v1/customer/disputes");
    expect(e.issue).toBe("TRANSACTION_NOT_ELIGIBLE");
  });
});
