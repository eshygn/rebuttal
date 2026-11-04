/**
 * The deterministic demo scenario. Every person and business here is fictional.
 *
 * Seller: Fernhill Ceramics, a two-person pottery studio that sells online and takes PayPal.
 * Demo clock starts Saturday 7 Nov 2026, 10:00 Pacific.
 */
import type { DisputeReason } from "./paypal/types";

export const DEMO_START = "2026-11-07T18:00:00.000Z"; // 10:00 PT
export const DEMO_TZ = "America/Los_Angeles";

export const SELLER = {
  name: "Fernhill Ceramics",
  owner: "Maya Lindqvist",
  email: "studio@fernhill-ceramics.example",
  merchantId: "8LQSDK2YN7Q6E",
};

export type ScenarioOrder = {
  id: string;
  buyer: { given: string; surname: string; email: string; payerId: string };
  shipTo: { line1: string; line2?: string; city: string; state: string; postal: string; country: string };
  items: { name: string; sku: string; qty: number; unitMinor: number }[];
  shippingMinor: number;
  currency: string;
  paidAt: string;
  captureId: string;
  buyerTxnId: string;
  tracking?: { carrier: "OTHER"; carrierOther: string; number: string; addedAt: string };
};

export const ORDERS: ScenarioOrder[] = [
  {
    id: "FC-1041",
    buyer: { given: "Jordan", surname: "Reyes", email: "jordan.reyes@mailbox.example", payerId: "QY7N3RJ2PZ6WA" },
    shipTo: { line1: "1180 Alder Street", line2: "Apt 3", city: "Portland", state: "OR", postal: "97214", country: "US" },
    items: [{ name: "Speckled stoneware mug, oat (pair)", sku: "MUG-OAT-2", qty: 1, unitMinor: 7200 }],
    shippingMinor: 1200,
    currency: "USD",
    paidAt: "2026-11-02T23:22:41.000Z",
    captureId: "5KX28116AH431373W",
    buyerTxnId: "9GS80322F8442283L",
    tracking: { carrier: "OTHER", carrierOther: "Northline Post", number: "NL4471029385US", addedAt: "2026-11-03T19:05:00.000Z" },
  },
  {
    id: "FC-1037",
    buyer: { given: "Priya", surname: "Natarajan", email: "priya.n@inbox.example", payerId: "M4V8TCX0LQ2JE" },
    shipTo: { line1: "42 Larkspur Court", city: "Ann Arbor", state: "MI", postal: "48104", country: "US" },
    items: [{ name: "Cobalt Tide serving bowl, large", sku: "BOWL-COB-L", qty: 1, unitMinor: 5600 }],
    shippingMinor: 900,
    currency: "USD",
    paidAt: "2026-10-29T17:48:10.000Z",
    captureId: "7HB51902LM620884P",
    buyerTxnId: "3RT65019KD2271554",
    tracking: { carrier: "OTHER", carrierOther: "Northline Post", number: "NL4471029112US", addedAt: "2026-10-30T21:40:00.000Z" },
  },
  {
    id: "FC-1029",
    buyer: { given: "Sam", surname: "Whitfield", email: "sam.whitfield@post.example", payerId: "B2K9WQ7XE4M1S" },
    shipTo: { line1: "9 Orchard Lane", city: "Burlington", state: "VT", postal: "05401", country: "US" },
    items: [{ name: "Glaze-test sticker sheet set", sku: "STK-GLZ-3", qty: 1, unitMinor: 1100 }],
    shippingMinor: 300,
    currency: "USD",
    paidAt: "2026-10-19T20:11:52.000Z",
    captureId: "1FD80733NS904216C",
    buyerTxnId: "6PA42088WE3317390",
  },
];

export type ScenarioDispute = {
  key: string;
  orderId: string;
  id: string;
  reason: DisputeReason;
  amountMinor: number;
  claim: string;
  /** When the buyer opens it, relative to the demo story. */
  opensAt?: string;
  /** Pre-existing disputes are in the inbox at reset; the others arrive during the demo. */
  preExisting?: boolean;
  dueDays: number;
};

export const DISPUTES: ScenarioDispute[] = [
  {
    key: "inr-mugs",
    orderId: "FC-1041",
    id: "PP-D-21837",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    amountMinor: 8400,
    claim: "I never got my mugs. Tracking hasn't updated and nobody has replied to me.",
    dueDays: 10,
  },
  {
    key: "snad-bowl",
    orderId: "FC-1037",
    id: "PP-D-21864",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    amountMinor: 6500,
    claim:
      "The bowl is a pale, washed-out blue, nothing like the deep cobalt in the listing photos. I bought it to match a set. Not what I paid for.",
    dueDays: 10,
  },
  {
    key: "inr-stickers",
    orderId: "FC-1029",
    id: "PP-D-21702",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    amountMinor: 1400,
    claim: "Ordered stickers three weeks ago, nothing has arrived.",
    opensAt: "2026-11-04T16:30:00.000Z",
    preExisting: true,
    dueDays: 10,
  },
];

/** Seller-side evidence the shop already holds. Images live in /public/evidence. */
export const EVIDENCE = [
  {
    id: "ev-mugs-carrier",
    orderId: "FC-1041",
    kind: "carrier_document",
    title: "Northline Post tracking page (screenshot)",
    file: "/evidence/carrier-tracking-NL4471029385US.png",
    mime: "image/png",
  },
  {
    id: "ev-mugs-listing",
    orderId: "FC-1041",
    kind: "listing",
    title: "Listing: Speckled stoneware mug, oat (pair)",
    text:
      "Speckled stoneware mug, oat — sold as a pair. Wheel-thrown in our Asheville studio, 12 oz, dishwasher safe. Ships in 1–2 business days with Northline Post tracked delivery.",
  },
  {
    id: "ev-mugs-msg",
    orderId: "FC-1041",
    kind: "buyer_message",
    title: "Buyer messages",
    text:
      "3 Nov 2026, Fernhill Ceramics: Your mugs are on their way! Tracking: NL4471029385US (Northline Post).\n7 Nov 2026, Jordan Reyes: I never got my mugs. Tracking hasn't updated and nobody has replied to me.",
  },
  {
    id: "ev-bowl-listing",
    orderId: "FC-1037",
    kind: "listing",
    title: "Listing: Cobalt Tide serving bowl, large",
    text:
      "Cobalt Tide serving bowl, large. A deep cobalt glaze that breaks to midnight at the rim. 11 in across. Each piece is glazed by hand and colour varies between kiln firings, so yours will be unique. Returns accepted within 30 days.",
  },
  {
    id: "ev-bowl-listing-photo",
    orderId: "FC-1037",
    kind: "listing_photo",
    title: "Listing photo (studio)",
    file: "/evidence/listing-cobalt-bowl.jpg",
    mime: "image/jpeg",
  },
  {
    id: "ev-bowl-buyer-photo",
    orderId: "FC-1037",
    kind: "buyer_photo",
    title: "Photo the buyer sent",
    file: "/evidence/buyer-photo-cobalt-bowl.jpg",
    mime: "image/jpeg",
  },
  {
    id: "ev-bowl-msg",
    orderId: "FC-1037",
    kind: "buyer_message",
    title: "Buyer messages",
    text:
      "4 Nov 2026, Priya Natarajan: The bowl arrived but it's a pale blue, not the deep cobalt in your photos. Photo attached.\n4 Nov 2026, Fernhill Ceramics: Sorry to hear that! Glaze colour does vary a little between firings. Could you send a photo in daylight?\n10 Nov 2026, Priya Natarajan: I've opened a case with PayPal.",
  },
  {
    id: "ev-stickers-listing",
    orderId: "FC-1029",
    kind: "listing",
    title: "Listing: Glaze-test sticker sheet set",
    text: "Three sticker sheets of our glaze test tiles. Ships as a flat letter (untracked) to keep postage low.",
  },
] as const;

/** Resolved disputes from before Rebuttal, for the outcome history. */
export const HISTORY = [
  { id: "PP-D-20411", buyer: "Elena Marsh", item: "Ash-glaze planter", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" as const, minor: 4800, outcome: "RESOLVED_BUYER_FAVOUR", closed: "2026-08-21T17:00:00.000Z", note: "No response sent before the deadline" },
  { id: "PP-D-20587", buyer: "Tomás Ibarra", item: "Bud vase trio", reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" as const, minor: 3600, outcome: "RESOLVED_BUYER_FAVOUR", closed: "2026-09-30T17:00:00.000Z", note: "Refunded in full" },
];
