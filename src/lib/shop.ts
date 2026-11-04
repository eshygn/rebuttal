/** The seller's storefront: PayPal checkout (Orders v2) and shipment tracking. */
import crypto from "node:crypto";
import { now } from "./clock";
import { db } from "./db";
import { env } from "./env";
import { logEvent } from "./events";
import { paypalLive } from "./paypal/gateway";
import * as orders from "./paypal/orders";
import { orderJson } from "./seed";
import { SELLER, type ScenarioOrder } from "./scenario";

export const PRODUCTS = [
  { sku: "MUG-OAT-2", name: "Speckled stoneware mug, oat (pair)", blurb: "Wheel-thrown, 12 oz, sold as a pair.", unitMinor: 7200, shippingMinor: 1200, tone: "oat" },
  { sku: "BOWL-COB-L", name: "Cobalt Tide serving bowl, large", blurb: "Deep cobalt glaze breaking to midnight at the rim.", unitMinor: 5600, shippingMinor: 900, tone: "cobalt" },
  { sku: "STK-GLZ-3", name: "Glaze-test sticker sheet set", blurb: "Three sheets of our test tiles. Ships as a flat letter.", unitMinor: 1100, shippingMinor: 300, tone: "paper" },
] as const;

export const CURRENCY = "USD";

export async function shopConfig() {
  const live = await paypalLive();
  return { mode: live ? "live" : "mock", clientId: live ? env.paypalClientId : null, currency: CURRENCY, products: PRODUCTS, seller: SELLER.name };
}

function nextInvoice(): string {
  const n = db().prepare("SELECT COUNT(*) AS n FROM orders WHERE id LIKE 'FC-2%'").get() as { n: number };
  return `FC-${2001 + n.n}`;
}

export async function createShopOrder(sku: string): Promise<{ id: string; mode: "live" | "simulated" }> {
  const p = PRODUCTS.find((x) => x.sku === sku);
  if (!p) throw new Error("Unknown product");
  const invoiceId = nextInvoice();
  if (await paypalLive()) {
    const o = (await orders.createOrder({ invoiceId, lines: [{ name: p.name, sku: p.sku, qty: 1, unitMinor: p.unitMinor }], shippingMinor: p.shippingMinor, currency: CURRENCY })) as { id: string };
    return { id: o.id, mode: "live" };
  }
  const id = "SIM" + crypto.randomBytes(7).toString("hex").toUpperCase();
  orders.recordSimulatedOrderCall("Create order", "POST", "/v2/checkout/orders", { intent: "CAPTURE", invoice_id: invoiceId, sku }, { id, status: "CREATED" });
  return { id, mode: "simulated" };
}

type CaptureJson = {
  id: string;
  payer?: { name?: { given_name?: string; surname?: string }; email_address?: string };
  purchase_units?: { invoice_id?: string; payments?: { captures?: { id: string; create_time?: string }[] } }[];
};

export async function captureShopOrder(orderId: string, sku: string) {
  const p = PRODUCTS.find((x) => x.sku === sku);
  if (!p) throw new Error("Unknown product");
  const total = p.unitMinor + p.shippingMinor;
  if (!orderId.startsWith("SIM") && (await paypalLive())) {
    await orders.captureOrder(orderId);
    const full = (await orders.getOrder(orderId)) as CaptureJson;
    const pu = full.purchase_units?.[0];
    const cap = pu?.payments?.captures?.[0];
    const name = [full.payer?.name?.given_name, full.payer?.name?.surname].filter(Boolean).join(" ") || "Sandbox buyer";
    const id = pu?.invoice_id ?? nextInvoice();
    db()
      .prepare(
        `INSERT INTO orders (id, paypal_order_id, capture_id, buyer_name, buyer_email, amount_minor, currency, paid_at, source, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sandbox', ?)`,
      )
      .run(id, orderId, cap?.id ?? null, name, full.payer?.email_address ?? "", total, CURRENCY, cap?.create_time ?? new Date().toISOString(), JSON.stringify(full));
    logEvent(null, "order", `${name} paid ${id} through PayPal checkout (sandbox)`);
    return { id, mode: "live" as const };
  }
  const id = nextInvoice();
  const so: ScenarioOrder = {
    id,
    buyer: { given: "Alex", surname: "Moreau", email: "alex.moreau@mail.example", payerId: "SIMPAYER" + id.slice(3) },
    shipTo: { line1: "77 Juniper Way", city: "Boulder", state: "CO", postal: "80302", country: "US" },
    items: [{ name: p.name, sku: p.sku, qty: 1, unitMinor: p.unitMinor }],
    shippingMinor: p.shippingMinor,
    currency: CURRENCY,
    paidAt: now(),
    captureId: "SIMCAP" + crypto.randomBytes(5).toString("hex").toUpperCase(),
    buyerTxnId: "SIMTXN" + crypto.randomBytes(5).toString("hex").toUpperCase(),
  };
  const raw = { ...orderJson(so), id: orderId };
  orders.recordSimulatedOrderCall("Capture order", "POST", `/v2/checkout/orders/${orderId}/capture`, {}, raw);
  db()
    .prepare(
      `INSERT INTO orders (id, paypal_order_id, capture_id, buyer_transaction_id, buyer_name, buyer_email, amount_minor, currency, paid_at, source, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'simulated', ?)`,
    )
    .run(id, orderId, so.captureId, so.buyerTxnId, "Alex Moreau", so.buyer.email, total, CURRENCY, so.paidAt, JSON.stringify(raw));
  logEvent(null, "order", `Alex Moreau paid ${id} (simulated checkout)`);
  return { id, mode: "simulated" as const };
}

export async function addShopTracking(id: string) {
  const o = db().prepare("SELECT * FROM orders WHERE id = ?").get(id) as { paypal_order_id: string; capture_id: string; source: string; raw: string; tracking: string | null } | undefined;
  if (!o) throw new Error("No such order");
  if (o.tracking) return { mode: "simulated" as const, already: true };
  const number = "NL44710" + String(Date.parse(now())).slice(-5) + "US";
  const tracking = { carrier: "OTHER", carrierOther: "Northline Post", number, addedAt: now() };
  let raw = JSON.parse(o.raw);
  let mode: "live" | "simulated" = "simulated";
  if (o.source === "sandbox" && (await paypalLive())) {
    raw = await orders.addTracking(o.paypal_order_id, { captureId: o.capture_id, trackingNumber: number, carrierOther: "Northline Post" });
    mode = "live";
  } else {
    const pu = raw.purchase_units?.[0];
    if (pu?.shipping) pu.shipping.trackers = [{ id: `${o.capture_id}-${number}`, status: "SHIPPED", create_time: tracking.addedAt, update_time: tracking.addedAt }];
    orders.recordSimulatedOrderCall("Add tracking", "POST", `/v2/checkout/orders/${o.paypal_order_id}/track`, { capture_id: o.capture_id, tracking_number: number, carrier: "OTHER", carrier_name_other: "Northline Post" }, raw);
  }
  db().prepare("UPDATE orders SET tracking = ?, raw = ? WHERE id = ?").run(JSON.stringify(tracking), JSON.stringify(raw), id);
  logEvent(null, "tracking", `Tracking ${number} added to PayPal for ${id}${mode === "simulated" ? " · simulated" : ""}`);
  return { mode };
}

export function listShopOrders() {
  return (
    db()
      .prepare("SELECT id, buyer_name, amount_minor, currency, paid_at, source, tracking, paypal_order_id, capture_id FROM orders WHERE id NOT LIKE 'HIST-%' ORDER BY paid_at DESC")
      .all() as { id: string; buyer_name: string; amount_minor: number; currency: string; paid_at: string; source: string; tracking: string | null; paypal_order_id: string; capture_id: string }[]
  ).map((o) => ({ ...o, tracking: o.tracking ? JSON.parse(o.tracking) : null }));
}
