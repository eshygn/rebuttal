import { describe, expect, it } from "vitest";
import { CarrierScanSchema, PhotoComparisonSchema, RecommendationSchema, tidyRecommendation } from "@/lib/ai/schemas";
import fs from "node:fs";
import path from "node:path";

const rec = {
  action: "offer",
  confidence: 85,
  headline: "Offer a partial refund",
  reasoning: ["Buyer photo is lighter", "No pre-shipment photo"],
  offer_percent: 40,
  response_to_paypal: "We'd like to offer a partial refund.",
  evidence_to_attach: ["ev-bowl-listing"],
  risks: [],
};

describe("AI tool schemas", () => {
  it("accepts a well-formed recommendation", () => {
    expect(RecommendationSchema.parse(rec).action).toBe("offer");
  });

  it("rejects unknown actions and out-of-range numbers", () => {
    expect(() => RecommendationSchema.parse({ ...rec, action: "ignore" })).toThrow();
    expect(() => RecommendationSchema.parse({ ...rec, confidence: 140 })).toThrow();
    expect(() => RecommendationSchema.parse({ ...rec, offer_percent: 100 })).toThrow();
    expect(() => RecommendationSchema.parse({ ...rec, reasoning: [] })).toThrow();
  });

  it("tidies model output to PayPal's limits", () => {
    const t = tidyRecommendation({
      ...rec,
      confidence: 99.6,
      offer_percent: 33.4,
      response_to_paypal: "x".repeat(2600),
      reasoning: Array(8).fill("because"),
      risks: ["a", "b", "c", "d"],
    } as never);
    expect(t.confidence).toBe(95);
    expect(t.offer_percent).toBe(33);
    expect(t.response_to_paypal.length).toBeLessThanOrEqual(2000);
    expect(t.reasoning).toHaveLength(5);
    expect(t.risks).toHaveLength(3);
  });

  it("validates carrier scans, including the status enum", () => {
    const scan = {
      carrier_name: "Northline Post",
      tracking_number: "NL4471029385US",
      status: "DELIVERED",
      delivered_at: "2026-11-05T14:12:00-08:00",
      delivery_address: "1180 ALDER ST APT 3, PORTLAND, OR 97214",
      delivery_note: "Left at front door",
      scan_events: [{ at: "2026-11-05T14:12:00-08:00", description: "Delivered", location: "PORTLAND, OR" }],
      legibility: "clear",
    };
    expect(CarrierScanSchema.parse(scan).status).toBe("DELIVERED");
    expect(() => CarrierScanSchema.parse({ ...scan, status: "PROBABLY_DELIVERED" })).toThrow();
  });

  it("validates photo comparisons", () => {
    expect(() => PhotoComparisonSchema.parse({ comparable: true, materially_different: "yes" })).toThrow();
  });

  it("ships recorded Gemini runs that still match today's schemas", () => {
    const dir = path.join(process.cwd(), "src/lib/ai/recorded");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.sort()).toEqual(["inr-mugs.json", "inr-stickers.json", "snad-bowl.json"]);
    for (const f of files) {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      expect(() => RecommendationSchema.parse(r.recommendation)).not.toThrow();
    }
  });
});
