import type Database from "better-sqlite3";
import { toPayPalValue } from "./money";
import { simAdjudicate, simCreate, simProvideEvidence } from "./paypal/sim";
import { DEMO_START, DISPUTES, EVIDENCE, HISTORY, ORDERS, SELLER, type ScenarioOrder } from "./scenario";

const money = (minor: number, currency: string) => ({ currency_code: currency, value: toPayPalValue(minor, currency) });

/** An Orders v2 "show order details" response for a captured, shipped order. */
export function orderJson(o: ScenarioOrder) {
  const itemTotal = o.items.reduce((s, i) => s + i.qty * i.unitMinor, 0);
  const total = itemTotal + o.shippingMinor;
  const paypalOrderId = "5O" + o.captureId.slice(2, 17);
  return {
    id: paypalOrderId,
    intent: "CAPTURE",
    status: "COMPLETED",
    payment_source: {
      paypal: {
        email_address: o.buyer.email,
        account_id: o.buyer.payerId,
        account_status: "VERIFIED",
        name: { given_name: o.buyer.given, surname: o.buyer.surname },
        address: { country_code: o.shipTo.country },
      },
    },
    payer: {
      name: { given_name: o.buyer.given, surname: o.buyer.surname },
      email_address: o.buyer.email,
      payer_id: o.buyer.payerId,
      address: { country_code: o.shipTo.country },
    },
    purchase_units: [
      {
        reference_id: "default",
        invoice_id: o.id,
        amount: {
          ...money(total, o.currency),
          breakdown: { item_total: money(itemTotal, o.currency), shipping: money(o.shippingMinor, o.currency) },
        },
        payee: { email_address: SELLER.email, merchant_id: SELLER.merchantId },
        items: o.items.map((i) => ({ name: i.name, sku: i.sku, quantity: String(i.qty), unit_amount: money(i.unitMinor, o.currency) })),
        shipping: {
          name: { full_name: `${o.buyer.given} ${o.buyer.surname}` },
          address: {
            address_line_1: o.shipTo.line1,
            ...(o.shipTo.line2 ? { address_line_2: o.shipTo.line2 } : {}),
            admin_area_2: o.shipTo.city,
            admin_area_1: o.shipTo.state,
            postal_code: o.shipTo.postal,
            country_code: o.shipTo.country,
          },
          ...(o.tracking
            ? {
                trackers: [
                  {
                    id: `${o.captureId}-${o.tracking.number}`,
                    status: "SHIPPED",
                    items: o.items.map((i) => ({ name: i.name, sku: i.sku, quantity: String(i.qty) })),
                    links: [
                      { href: `https://api-m.sandbox.paypal.com/v2/checkout/orders/${paypalOrderId}/trackers/${o.captureId}-${o.tracking.number}`, rel: "self", method: "GET" },
                    ],
                    create_time: o.tracking.addedAt,
                    update_time: o.tracking.addedAt,
                  },
                ],
              }
            : {}),
        },
        payments: {
          captures: [
            {
              id: o.captureId,
              status: "COMPLETED",
              amount: money(total, o.currency),
              final_capture: true,
              seller_protection: { status: "ELIGIBLE", dispute_categories: ["ITEM_NOT_RECEIVED", "UNAUTHORIZED_TRANSACTION"] },
              create_time: o.paidAt,
              update_time: o.paidAt,
            },
          ],
        },
      },
    ],
    create_time: o.paidAt,
    update_time: o.tracking?.addedAt ?? o.paidAt,
    links: [{ href: `https://api-m.sandbox.paypal.com/v2/checkout/orders/${paypalOrderId}`, rel: "self", method: "GET" }],
  };
}

export function seed(conn: Database.Database) {
  const insMeta = conn.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
  insMeta.run("seeded_at", new Date().toISOString());
  insMeta.run("clock", DEMO_START);

  const insOrder = conn.prepare(
    `INSERT INTO orders (id, paypal_order_id, capture_id, buyer_transaction_id, buyer_name, buyer_email, amount_minor, currency, paid_at, source, tracking, raw)
     VALUES (@id, @paypal_order_id, @capture_id, @buyer_transaction_id, @buyer_name, @buyer_email, @amount_minor, @currency, @paid_at, 'simulated', @tracking, @raw)`,
  );
  for (const o of ORDERS) {
    const raw = orderJson(o);
    insOrder.run({
      id: o.id,
      paypal_order_id: raw.id,
      capture_id: o.captureId,
      buyer_transaction_id: o.buyerTxnId,
      buyer_name: `${o.buyer.given} ${o.buyer.surname}`,
      buyer_email: o.buyer.email,
      amount_minor: o.items.reduce((s, i) => s + i.qty * i.unitMinor, 0) + o.shippingMinor,
      currency: o.currency,
      paid_at: o.paidAt,
      tracking: o.tracking ? JSON.stringify(o.tracking) : null,
      raw: JSON.stringify(raw),
    });
  }

  const insEv = conn.prepare(
    "INSERT INTO evidence (id, order_id, kind, title, file, mime, text, added_at) VALUES (@id, @orderId, @kind, @title, @file, @mime, @text, @added)",
  );
  for (const e of EVIDENCE) {
    insEv.run({ file: null, mime: null, text: null, ...e, added: DEMO_START });
  }

  const insDispute = conn.prepare(
    "INSERT INTO disputes (id, scenario, order_id, source, buyer_claim, stage, raw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insEvent = conn.prepare("INSERT INTO events (dispute_id, at, kind, text) VALUES (?, ?, ?, ?)");
  for (const s of DISPUTES.filter((d) => d.preExisting)) {
    const o = ORDERS.find((x) => x.id === s.orderId)!;
    const raw = simCreate({
      id: s.id,
      buyerTransactionId: o.buyerTxnId,
      sellerTransactionId: o.captureId,
      transactionTime: o.paidAt,
      buyerName: `${o.buyer.given} ${o.buyer.surname}`,
      seller: { email: SELLER.email, merchantId: SELLER.merchantId, name: SELLER.name },
      reason: s.reason,
      amountMinor: s.amountMinor,
      currency: o.currency,
      now: s.opensAt!,
      dueDays: s.dueDays,
    });
    insDispute.run(s.id, s.key, s.orderId, "simulated", s.claim, "new", JSON.stringify(raw), s.opensAt);
    insEvent.run(s.id, s.opensAt, "opened", `${raw.disputed_transactions![0].buyer!.name} opened an “item not received” case`);
  }

  // Historical outcomes (pre-Rebuttal) for the history strip. No live data behind them.
  for (const h of HISTORY) {
    const opened = new Date(Date.parse(h.closed) - 12 * 86_400_000).toISOString();
    let raw = simCreate({
      id: h.id,
      buyerTransactionId: "HIST" + h.id.slice(-5),
      sellerTransactionId: "HIST" + h.id.slice(-5),
      transactionTime: opened,
      buyerName: h.buyer,
      seller: { email: SELLER.email, merchantId: SELLER.merchantId, name: SELLER.name },
      reason: h.reason,
      amountMinor: h.minor,
      currency: "USD",
      now: opened,
      dueDays: 10,
    });
    raw = simProvideEvidence(raw, [{ evidence_type: "OTHER", notes: h.note }], opened);
    raw = simAdjudicate(raw, "BUYER_FAVOR", h.closed);
    conn
      .prepare(
        "INSERT INTO orders (id, buyer_name, buyer_email, amount_minor, currency, paid_at, source, raw) VALUES (?, ?, '', ?, 'USD', ?, 'simulated', ?)",
      )
      .run(`HIST-${h.id}`, h.buyer, h.minor, opened, JSON.stringify({ purchase_units: [{ items: [{ name: h.item }] }] }));
    insDispute.run(h.id, "history", `HIST-${h.id}`, "simulated", h.note, "lost", JSON.stringify(raw), opened);
  }
}
