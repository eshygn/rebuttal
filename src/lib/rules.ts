/**
 * The fixed rules table: for each PayPal dispute reason, the evidence that answers it.
 * Coverage is computed deterministically from facts; the AI only supplies facts it read
 * from documents (carrier scans, photos). The rules never call a model.
 */
import type { DisputeReason } from "./paypal/types";

export type CarrierStatus = "DELIVERED" | "OUT_FOR_DELIVERY" | "IN_TRANSIT" | "EXCEPTION" | "RETURNED" | "UNKNOWN";

export type Facts = {
  reason: DisputeReason;
  disputeOpenedAt: string;
  amountMinor: number;
  currency: string;
  shipTo?: { line1: string; line2?: string; city: string; state: string; postal: string };
  /** The PayPal tracker on the order: only what the seller typed in. */
  tracker?: { carrier: string; number: string; status: string } | null;
  /** Read by the AI from the seller's carrier screenshot or PDF. */
  carrierScan?: {
    status: CarrierStatus;
    deliveredAt?: string | null;
    trackingNumber?: string | null;
    address?: string | null;
    deliveryNote?: string | null;
  } | null;
  listing?: { present: boolean; disclosesVariation?: boolean };
  /** Photos of the actual unit taken before it shipped. */
  preShipmentPhoto?: boolean;
  /** AI comparison of the buyer's photo with the listing photo. */
  photoComparison?: { comparable: boolean; materiallyDifferent: boolean; summary: string } | null;
  returnPolicy?: boolean;
  buyerCommunication?: boolean;
};

export type Weight = "critical" | "strong" | "supporting";
export type ItemState = "present" | "missing" | "against";

export type Rule = {
  id: string;
  label: string;
  why: string;
  weight: Weight;
  /** The PayPal evidence_type this item is submitted as. */
  evidenceType: string;
  check: (f: Facts) => { state: ItemState; detail: string };
};

export type CoverageItem = Omit<Rule, "check"> & { state: ItemState; detail: string };
export type Strength = "strong" | "partial" | "weak";
export type Coverage = { items: CoverageItem[]; score: number; strength: Strength; missingCritical: string[] };

const WEIGHT_POINTS: Record<Weight, number> = { critical: 3, strong: 2, supporting: 1 };

// ---- Address and date helpers (pure, tested) ---------------------------------

const ABBREV: Record<string, string> = {
  STREET: "ST", AVENUE: "AVE", ROAD: "RD", DRIVE: "DR", COURT: "CT", LANE: "LN", BOULEVARD: "BLVD",
  PLACE: "PL", TERRACE: "TER", APARTMENT: "APT", SUITE: "STE", UNIT: "APT", "#": "APT", NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
};

export function normaliseAddress(s: string): string {
  return s
    .toUpperCase()
    .replace(/#/g, " APT ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ABBREV[w] ?? w)
    .join(" ");
}

/** True when the scanned address contains the ship-to street line, unit and ZIP. */
export function addressMatches(scanned: string, shipTo: NonNullable<Facts["shipTo"]>): boolean {
  const a = ` ${normaliseAddress(scanned)} `;
  const line1 = normaliseAddress(shipTo.line1);
  const zip = shipTo.postal.slice(0, 5);
  if (!a.includes(` ${line1} `) || !a.includes(zip)) return false;
  if (shipTo.line2) {
    const unit = normaliseAddress(shipTo.line2).split(" ").pop()!;
    if (!new RegExp(` (APT )?${unit} `).test(a)) return false;
  }
  return true;
}

/** Calendar days from a to b as the seller's calendar sees them (5 Nov 23:00 → 7 Nov 01:00 is 2). */
export function daysBetween(a: string, b: string, timeZone = "America/Los_Angeles"): number {
  const day = (iso: string) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
    return Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, Number(p.slice(8, 10)));
  };
  return Math.round((day(b) - day(a)) / 86_400_000);
}

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "America/Los_Angeles" });

// ---- The table ------------------------------------------------------------------

const trackingOnPayPal: Rule = {
  id: "tracking_on_paypal",
  label: "Tracking number on the PayPal order",
  why: "PayPal Seller Protection for “not received” needs online tracking uploaded to the transaction.",
  weight: "critical",
  evidenceType: "PROOF_OF_FULFILLMENT",
  check: (f) =>
    f.tracker
      ? { state: "present", detail: `${f.tracker.carrier} ${f.tracker.number} (status entered by seller: ${f.tracker.status})` }
      : { state: "missing", detail: "No tracker was added to this PayPal transaction." },
};

const carrierDelivered: Rule = {
  id: "carrier_delivered",
  label: "Carrier confirms delivery",
  why: "PayPal’s tracker only stores what the seller typed. The carrier’s own scan proves the parcel arrived.",
  weight: "critical",
  evidenceType: "PROOF_OF_FULFILLMENT",
  check: (f) => {
    const c = f.carrierScan;
    if (!c) return { state: "missing", detail: "No carrier screenshot or PDF on file." };
    if (c.status === "DELIVERED") return { state: "present", detail: `Delivered${c.deliveredAt ? ` ${fmtDay(c.deliveredAt)}` : ""}, read from the carrier scan` };
    if (c.status === "RETURNED" || c.status === "EXCEPTION") return { state: "against", detail: `Carrier shows ${c.status.toLowerCase()}` };
    return { state: "missing", detail: `Carrier shows ${c.status.toLowerCase().replace(/_/g, " ")}, not delivered` };
  },
};

const trackingMatches: Rule = {
  id: "tracking_matches",
  label: "Scan matches the PayPal tracking number",
  why: "Ties the carrier’s proof to this transaction.",
  weight: "strong",
  evidenceType: "PROOF_OF_FULFILLMENT",
  check: (f) => {
    const scanned = f.carrierScan?.trackingNumber?.replace(/\s/g, "").toUpperCase();
    if (!scanned || !f.tracker) return { state: "missing", detail: "Nothing to compare yet." };
    return scanned === f.tracker.number.toUpperCase()
      ? { state: "present", detail: `${scanned} on both` }
      : { state: "against", detail: `Scan shows ${scanned}, PayPal has ${f.tracker.number}` };
  },
};

const addressMatchRule: Rule = {
  id: "address_matches",
  label: "Delivered to the PayPal shipping address",
  why: "PayPal only protects deliveries to the address on the transaction.",
  weight: "critical",
  evidenceType: "PROOF_OF_FULFILLMENT",
  check: (f) => {
    const scanned = f.carrierScan?.address;
    if (!scanned || !f.shipTo) return { state: "missing", detail: "No delivery address on the carrier scan." };
    return addressMatches(scanned, f.shipTo)
      ? { state: "present", detail: `${scanned}` }
      : { state: "against", detail: `Scan shows “${scanned}”, PayPal has ${f.shipTo.line1}${f.shipTo.line2 ? " " + f.shipTo.line2 : ""}, ${f.shipTo.postal}` };
  },
};

const deliveredBeforeClaim: Rule = {
  id: "delivered_before_claim",
  label: "Delivered before the claim was opened",
  why: "A claim opened after a confirmed delivery is the core of the rebuttal.",
  weight: "strong",
  evidenceType: "PROOF_OF_FULFILLMENT",
  check: (f) => {
    const at = f.carrierScan?.status === "DELIVERED" ? f.carrierScan.deliveredAt : null;
    if (!at) return { state: "missing", detail: "No delivery date to compare." };
    const days = daysBetween(at, f.disputeOpenedAt);
    return days >= 0
      ? { state: "present", detail: days === 0 ? "Delivered the same day the claim was opened" : `Delivered ${days} day${days === 1 ? "" : "s"} before the claim` }
      : { state: "against", detail: "Claim was opened before delivery" };
  },
};

const buyerComms: Rule = {
  id: "buyer_communication",
  label: "Messages with the buyer",
  why: "Shows the seller shared tracking and responded in good faith.",
  weight: "supporting",
  evidenceType: "OTHER",
  check: (f) => (f.buyerCommunication ? { state: "present", detail: "Message thread on file" } : { state: "missing", detail: "No messages on file" }),
};

const listingRule: Rule = {
  id: "listing_description",
  label: "Listing text as the buyer saw it",
  why: "The baseline for “not as described”: what was promised.",
  weight: "critical",
  evidenceType: "ITEM_DESCRIPTION",
  check: (f) =>
    f.listing?.present
      ? { state: "present", detail: "Listing text on file, as the buyer saw it" }
      : { state: "missing", detail: "No copy of the listing" },
};

const preShipPhoto: Rule = {
  id: "pre_shipment_photo",
  label: "Photo of this exact item before shipping",
  why: "Proves the unit sent matched the listing. Without it, it is the buyer’s photo against yours.",
  weight: "critical",
  evidenceType: "ADDITIONAL_INFORMATION_OF_ITEM",
  check: (f) => (f.preShipmentPhoto ? { state: "present", detail: "Pre-shipment photo on file" } : { state: "missing", detail: "No photo of this unit before it shipped" }),
};

const photoComparison: Rule = {
  id: "buyer_photo_comparison",
  label: "Buyer’s photo vs listing photo",
  why: "If the buyer’s photo shows a clear difference, PayPal usually sides with the buyer.",
  weight: "strong",
  evidenceType: "PROOF_OF_SIGNIFICANT_DIFFERENCE",
  check: (f) => {
    const p = f.photoComparison;
    if (!p || !p.comparable) return { state: "missing", detail: "No buyer photo to compare" };
    return p.materiallyDifferent ? { state: "against", detail: p.summary } : { state: "present", detail: p.summary };
  },
};

const variationDisclosed: Rule = {
  id: "variation_disclosed",
  label: "Listing discloses natural variation",
  why: "Handmade goods vary. A clear disclosure narrows what “as described” means.",
  weight: "strong",
  evidenceType: "ITEM_DESCRIPTION",
  check: (f) =>
    f.listing?.disclosesVariation
      ? { state: "present", detail: "“Colour varies between kiln firings” is in the listing" }
      : { state: "missing", detail: "Listing does not mention variation" },
};

const returnPolicy: Rule = {
  id: "return_policy",
  label: "Published return policy",
  why: "Lets the seller offer a return instead of a refund.",
  weight: "supporting",
  evidenceType: "RETURN_POLICY",
  check: (f) => (f.returnPolicy ? { state: "present", detail: "Returns accepted within 30 days" } : { state: "missing", detail: "No return policy on file" }),
};

export const RULES: Partial<Record<DisputeReason, Rule[]>> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: [trackingOnPayPal, carrierDelivered, addressMatchRule, trackingMatches, deliveredBeforeClaim, buyerComms],
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: [listingRule, preShipPhoto, photoComparison, variationDisclosed, returnPolicy, buyerComms],
  UNAUTHORISED: [trackingOnPayPal, carrierDelivered, addressMatchRule, buyerComms],
};

export const REASON_LABEL: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorised",
  CREDIT_NOT_PROCESSED: "Credit not processed",
  DUPLICATE_TRANSACTION: "Duplicate transaction",
  INCORRECT_AMOUNT: "Incorrect amount",
  PAYMENT_BY_OTHER_MEANS: "Paid by other means",
  CANCELED_RECURRING_BILLING: "Cancelled subscription",
  PROBLEM_WITH_REMITTANCE: "Problem with remittance",
  OTHER: "Other",
};

export function coverage(f: Facts): Coverage {
  const rules = RULES[f.reason] ?? [buyerComms];
  const items = rules.map(({ check, ...r }) => ({ ...r, ...check(f) }));
  const total = items.reduce((s, i) => s + WEIGHT_POINTS[i.weight], 0);
  const got = items.reduce((s, i) => s + (i.state === "present" ? WEIGHT_POINTS[i.weight] : i.state === "against" ? -WEIGHT_POINTS[i.weight] : 0), 0);
  const score = Math.max(0, Math.round((got / total) * 100));
  const missingCritical = items.filter((i) => i.weight === "critical" && i.state !== "present").map((i) => i.id);
  const anyAgainst = items.some((i) => i.state === "against" && i.weight !== "supporting");
  const strength: Strength = missingCritical.length === 0 && !anyAgainst && score >= 70 ? "strong" : score >= 35 ? "partial" : "weak";
  return { items, score, strength, missingCritical };
}

export type Action = "fight" | "offer" | "accept";

/**
 * The deterministic baseline the agent's recommendation is checked against.
 * Fight only with strong coverage; give up only when there is next to nothing to show.
 */
export function baselineAction(c: Coverage): Action {
  if (c.strength === "strong") return "fight";
  if (c.strength === "partial") return "offer";
  return "accept";
}
