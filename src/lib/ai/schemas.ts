/** Zod schemas for every structured thing the model hands back. Validated before use. */
import { z } from "zod";

export const CarrierScanSchema = z.object({
  carrier_name: z.string().describe("Carrier name as printed on the document"),
  tracking_number: z.string().nullable().describe("Tracking number exactly as printed, no spaces"),
  status: z
    .enum(["DELIVERED", "OUT_FOR_DELIVERY", "IN_TRANSIT", "EXCEPTION", "RETURNED", "UNKNOWN"])
    .describe("Latest shipment status shown on the document"),
  delivered_at: z
    .string()
    .nullable()
    .describe("Delivery date-time as ISO 8601 with the UTC offset shown or implied by the document's time zone, or null if not delivered"),
  delivery_address: z.string().nullable().describe("Full delivery address exactly as printed, one line"),
  delivery_note: z.string().nullable().describe("Where/how it was left, signature name, photo-on-delivery, if shown"),
  scan_events: z
    .array(z.object({ at: z.string().describe("ISO 8601 date-time"), description: z.string(), location: z.string().nullable() }))
    .describe("Scan history, newest first, at most 12 events"),
  legibility: z.enum(["clear", "partial", "unreadable"]),
});
export type CarrierScan = z.infer<typeof CarrierScanSchema>;

export const PhotoComparisonSchema = z.object({
  comparable: z.boolean().describe("Both photos clearly show the same kind of item"),
  materially_different: z
    .boolean()
    .describe("Would a reasonable buyer say the received item is significantly different from the listing photo?"),
  differences: z.array(z.string()).describe("Concrete visible differences: colour, size, damage, finish"),
  lighting_could_explain: z.boolean().describe("Could lighting or camera white balance plausibly explain the difference?"),
  summary: z.string().describe("One sentence a PayPal reviewer would accept, under 180 characters"),
});
export type PhotoComparison = z.infer<typeof PhotoComparisonSchema>;

export const RecommendationSchema = z.object({
  action: z.enum(["fight", "offer", "accept"]).describe("fight = submit evidence; offer = propose a partial refund; accept = refund in full"),
  confidence: z.number().min(0).max(100).describe("How confident you are this is the best action for the seller, 0–95"),
  headline: z.string().describe("One line verdict for the seller, plain words, no jargon, under 100 characters"),
  reasoning: z.array(z.string()).min(1).describe("2 to 4 short bullets (under 200 characters each) on why, citing specific facts with dates and amounts"),
  offer_percent: z
    .number()
    .min(5)
    .max(90)
    .nullable()
    .describe("For action=offer only: share of the disputed amount to refund, in whole percent. null otherwise"),
  response_to_paypal: z
    .string()
    .describe("Under 1,500 characters. For fight: the evidence note PayPal's reviewer reads. For offer: the message to the buyer. For accept: a short courteous note."),
  evidence_to_attach: z.array(z.string()).describe("Seller evidence document ids to attach"),
  risks: z.array(z.string()).describe("Up to 3 short notes on what could still go wrong"),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** Trim a validated recommendation to the sizes the UI and PayPal accept. */
export function tidyRecommendation(r: Recommendation): Recommendation {
  return {
    ...r,
    confidence: Math.round(Math.min(95, Math.max(0, r.confidence))),
    headline: clip(r.headline, 120),
    reasoning: r.reasoning.slice(0, 5).map((x) => clip(x, 280)),
    offer_percent: r.offer_percent === null ? null : Math.round(r.offer_percent),
    response_to_paypal: clip(r.response_to_paypal, 2000),
    risks: r.risks.slice(0, 3).map((x) => clip(x, 240)),
  };
}
