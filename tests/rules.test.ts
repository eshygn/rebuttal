import { describe, expect, it } from "vitest";
import { addressMatches, baselineAction, coverage, daysBetween, normaliseAddress, type Facts } from "@/lib/rules";

const shipTo = { line1: "1180 Alder Street", line2: "Apt 3", city: "Portland", state: "OR", postal: "97214" };
const inr = (over: Partial<Facts> = {}): Facts => ({
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  disputeOpenedAt: "2026-11-07T18:00:00.000Z",
  amountMinor: 8400,
  currency: "USD",
  shipTo,
  tracker: { carrier: "Northline Post", number: "NL4471029385US", status: "SHIPPED" },
  carrierScan: { status: "DELIVERED", deliveredAt: "2026-11-05T14:12:00-08:00", trackingNumber: "NL4471029385US", address: "1180 ALDER ST APT 3, PORTLAND, OR 97214" },
  buyerCommunication: true,
  ...over,
});

describe("address and date helpers", () => {
  it("normalises common abbreviations", () => {
    expect(normaliseAddress("1180 Alder Street, Apt. 3")).toBe("1180 ALDER ST APT 3");
    expect(normaliseAddress("1180 alder st #3")).toBe("1180 ALDER ST APT 3");
  });
  it("matches the carrier's address to the PayPal ship-to", () => {
    expect(addressMatches("1180 ALDER ST APT 3, PORTLAND, OR 97214", shipTo)).toBe(true);
    expect(addressMatches("1180 Alder Street Unit 3 Portland OR 97214-1234", shipTo)).toBe(true);
    expect(addressMatches("1180 ALDER ST APT 5, PORTLAND, OR 97214", shipTo)).toBe(false);
    expect(addressMatches("1180 ALDER ST APT 3, PORTLAND, OR 97215", shipTo)).toBe(false);
    expect(addressMatches("118 ALDER ST APT 3, PORTLAND, OR 97214", shipTo)).toBe(false);
  });
  it("counts calendar days in the seller's time zone", () => {
    expect(daysBetween("2026-11-05T14:12:00-08:00", "2026-11-07T18:00:00.000Z")).toBe(2);
    expect(daysBetween("2026-11-05T23:30:00-08:00", "2026-11-06T00:30:00-08:00")).toBe(1);
    expect(daysBetween("2026-11-07T10:00:00-08:00", "2026-11-05T10:00:00-08:00")).toBe(-2);
  });
});

describe("rules table", () => {
  it("rates a delivered, matching INR case strong: fight", () => {
    const c = coverage(inr());
    expect(c.items.every((i) => i.state === "present")).toBe(true);
    expect(c.strength).toBe("strong");
    expect(baselineAction(c)).toBe("fight");
  });

  it("knows PayPal's tracker alone does not prove delivery", () => {
    const c = coverage(inr({ carrierScan: null }));
    expect(c.missingCritical).toContain("carrier_delivered");
    expect(c.strength).not.toBe("strong");
  });

  it("counts a delivery to the wrong address against the seller", () => {
    const c = coverage(inr({ carrierScan: { ...inr().carrierScan!, address: "9 ELSEWHERE RD, PORTLAND, OR 97214" } }));
    expect(c.items.find((i) => i.id === "address_matches")?.state).toBe("against");
    expect(baselineAction(c)).not.toBe("fight");
  });

  it("says accept when nothing answers an INR claim", () => {
    const c = coverage(inr({ tracker: null, carrierScan: null, buyerCommunication: false }));
    expect(c.score).toBe(0);
    expect(baselineAction(c)).toBe("accept");
  });

  it("says offer for a not-as-described case with mixed evidence", () => {
    const c = coverage({
      reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      disputeOpenedAt: "2026-11-10T20:00:00.000Z",
      amountMinor: 6500,
      currency: "USD",
      listing: { present: true, disclosesVariation: true },
      preShipmentPhoto: false,
      photoComparison: { comparable: true, materiallyDifferent: true, summary: "Lighter blue" },
      returnPolicy: true,
      buyerCommunication: true,
    });
    expect(c.items.find((i) => i.id === "buyer_photo_comparison")?.state).toBe("against");
    expect(c.strength).toBe("partial");
    expect(baselineAction(c)).toBe("offer");
  });
});
