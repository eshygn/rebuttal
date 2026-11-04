/**
 * Document reading with Gemini vision. Each reader forces a single tool call whose
 * input is validated against a zod schema: no free-text parsing anywhere.
 */
import { generateText, tool } from "ai";
import crypto from "node:crypto";
import { evidenceBytes, type EvidenceRow } from "../casefile";
import { cacheGet, cacheKey, cacheSet, type ModelHandle } from "./model";
import { CarrierScanSchema, PhotoComparisonSchema, type CarrierScan, type PhotoComparison } from "./schemas";

const hash = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);

function filePart(e: EvidenceRow) {
  const bytes = evidenceBytes(e);
  if (!bytes) throw new Error(`Evidence file missing: ${e.file}`);
  const mediaType = e.mime ?? "image/png";
  return { bytes, part: { type: "file" as const, data: bytes, mediaType } };
}

export async function readCarrierDocument(h: ModelHandle, e: EvidenceRow, timeZone: string): Promise<{ scan: CarrierScan; cached: boolean }> {
  const { bytes, part } = filePart(e);
  const key = cacheKey("carrier-scan-v1", hash(bytes));
  const hit = cacheGet<CarrierScan>(key);
  if (hit) return { scan: hit, cached: true };
  const res = await generateText({
    model: h.model,
    maxRetries: 1,
    tools: { record_carrier_scan: tool({ description: "Record what the carrier document shows", inputSchema: CarrierScanSchema }) },
    toolChoice: { type: "tool", toolName: "record_carrier_scan" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "This is a seller's screenshot or PDF of a parcel carrier's tracking page, submitted as dispute evidence. " +
              "Read it exactly. Do not guess anything that is not printed. " +
              `If a time has no zone printed, assume ${timeZone} for the delivery location and include the correct UTC offset.`,
          },
          part,
        ],
      },
    ],
  });
  const call = res.toolCalls.find((c) => c.toolName === "record_carrier_scan");
  if (!call) throw new Error("Model did not return a carrier scan");
  const scan = CarrierScanSchema.parse(call.input);
  cacheSet(key, scan);
  return { scan, cached: false };
}

export async function comparePhotos(
  h: ModelHandle,
  listingPhoto: EvidenceRow,
  buyerPhoto: EvidenceRow,
  listingText: string,
): Promise<{ comparison: PhotoComparison; cached: boolean }> {
  const a = filePart(listingPhoto);
  const b = filePart(buyerPhoto);
  const key = cacheKey("photo-compare-v1", hash(a.bytes), hash(b.bytes), listingText);
  const hit = cacheGet<PhotoComparison>(key);
  if (hit) return { comparison: hit, cached: true };
  const res = await generateText({
    model: h.model,
    maxRetries: 1,
    tools: { record_photo_comparison: tool({ description: "Record the comparison", inputSchema: PhotoComparisonSchema }) },
    toolChoice: { type: "tool", toolName: "record_photo_comparison" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "A buyer says the item they received is not as described. Image 1 is the seller's listing photo. " +
              "Image 2 is the buyer's photo of what arrived. Compare them as a neutral PayPal reviewer would.\n\nListing text: " +
              listingText,
          },
          a.part,
          b.part,
        ],
      },
    ],
  });
  const call = res.toolCalls.find((c) => c.toolName === "record_photo_comparison");
  if (!call) throw new Error("Model did not return a photo comparison");
  const comparison = PhotoComparisonSchema.parse(call.input);
  cacheSet(key, comparison);
  return { comparison, cached: false };
}
