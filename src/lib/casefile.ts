/** Loads everything Rebuttal knows about one dispute from SQLite. */
import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { parseMinor } from "./money";
import type { Facts } from "./rules";
import type { PPDispute } from "./paypal/types";
import type { Stage } from "./workflow";

export type OrderRow = {
  id: string;
  paypal_order_id: string | null;
  capture_id: string | null;
  buyer_transaction_id: string | null;
  buyer_name: string;
  buyer_email: string;
  amount_minor: number;
  currency: string;
  paid_at: string;
  source: "sandbox" | "simulated";
  tracking: string | null;
  raw: string;
};

export type EvidenceRow = {
  id: string;
  order_id: string;
  kind: "carrier_document" | "listing" | "listing_photo" | "item_photo" | "buyer_photo" | "buyer_message" | "return_policy";
  title: string;
  file: string | null;
  mime: string | null;
  text: string | null;
  added_at: string;
};

export type DisputeRow = {
  id: string;
  scenario: string | null;
  order_id: string;
  source: "sandbox" | "simulated";
  buyer_claim: string | null;
  stage: Stage;
  raw: string;
  created_at: string;
};

export type Tracking = { carrier: string; carrierOther?: string; number: string; addedAt: string };

export type CaseFile = {
  row: DisputeRow;
  dispute: PPDispute;
  order: OrderRow;
  orderJson: OrderJson;
  tracking: Tracking | null;
  evidence: EvidenceRow[];
};

export type OrderJson = {
  id?: string;
  purchase_units?: {
    items?: { name: string; quantity?: string; sku?: string; unit_amount?: { currency_code: string; value: string } }[];
    shipping?: {
      name?: { full_name?: string };
      address?: { address_line_1?: string; address_line_2?: string; admin_area_2?: string; admin_area_1?: string; postal_code?: string; country_code?: string };
      trackers?: { id: string; status: string; create_time?: string }[];
    };
    payments?: { captures?: { id: string; status: string; seller_protection?: { status: string } }[] };
  }[];
};

export function loadCase(id: string): CaseFile | null {
  const row = db().prepare("SELECT * FROM disputes WHERE id = ?").get(id) as DisputeRow | undefined;
  if (!row) return null;
  const order = db().prepare("SELECT * FROM orders WHERE id = ?").get(row.order_id) as OrderRow;
  const evidence = db().prepare("SELECT * FROM evidence WHERE order_id = ? ORDER BY added_at, id").all(row.order_id) as EvidenceRow[];
  return {
    row,
    dispute: JSON.parse(row.raw),
    order,
    orderJson: JSON.parse(order.raw),
    tracking: order.tracking ? JSON.parse(order.tracking) : null,
    evidence,
  };
}

export function shipTo(o: OrderJson): Facts["shipTo"] {
  const a = o.purchase_units?.[0]?.shipping?.address;
  if (!a?.address_line_1) return undefined;
  return { line1: a.address_line_1, line2: a.address_line_2, city: a.admin_area_2 ?? "", state: a.admin_area_1 ?? "", postal: a.postal_code ?? "" };
}

export function formatAddress(o: OrderJson): string {
  const s = shipTo(o);
  return s ? `${s.line1}${s.line2 ? ", " + s.line2 : ""}, ${s.city}, ${s.state} ${s.postal}` : "No shipping address";
}

/** The PayPal tracker as PayPal stores it: a number and the status the seller entered. No carrier scans. */
export function trackerOf(c: Pick<CaseFile, "orderJson" | "tracking">): Facts["tracker"] {
  const t = c.orderJson.purchase_units?.[0]?.shipping?.trackers?.[0];
  if (!t) return null;
  const number = c.tracking?.number ?? t.id.split("-").slice(1).join("-");
  const carrier = c.tracking ? (c.tracking.carrier === "OTHER" ? (c.tracking.carrierOther ?? "OTHER") : c.tracking.carrier) : "unknown carrier";
  return { carrier, number, status: t.status };
}

/** The facts that need no AI: read straight from PayPal data and the seller's records. */
export function baseFacts(c: CaseFile): Facts {
  const listing = c.evidence.find((e) => e.kind === "listing");
  return {
    reason: c.dispute.reason,
    disputeOpenedAt: c.dispute.create_time,
    amountMinor: parseMinor(c.dispute.dispute_amount.value, c.dispute.dispute_amount.currency_code),
    currency: c.dispute.dispute_amount.currency_code,
    shipTo: shipTo(c.orderJson),
    tracker: trackerOf(c),
    listing: listing ? { present: true, disclosesVariation: /var(y|ies|iation)|unique|each piece/i.test(listing.text ?? "") } : { present: false },
    preShipmentPhoto: c.evidence.some((e) => e.kind === "item_photo"),
    returnPolicy: c.evidence.some((e) => e.kind === "return_policy" || /returns? accepted/i.test(e.text ?? "")),
    buyerCommunication: c.evidence.some((e) => e.kind === "buyer_message"),
    carrierScan: null,
    photoComparison: null,
  };
}

/** Read an evidence file's bytes, from /public for seeded files or data/uploads for uploads. */
export function evidenceBytes(e: EvidenceRow): Buffer | null {
  if (!e.file) return null;
  const p = e.file.startsWith("/uploads/")
    ? path.join(process.cwd(), "data", "uploads", e.file.slice("/uploads/".length))
    : path.join(process.cwd(), "public", e.file);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
