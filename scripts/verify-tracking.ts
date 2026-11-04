/**
 * Verifies the Tracking API path live without a buyer login: captures a sandbox test-card
 * payment to this app's own business account (Orders v2), then adds a tracker with the same
 * Server SDK call the shop uses, and re-reads the order. Responses are saved (redacted) to
 * fixtures/paypal/recorded/tracking-*.json.
 *
 *   npx tsx scripts/verify-tracking.ts
 */
import fs from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile?.(".env");
} catch {
  /* no .env */
}

async function main() {
  const { paypalRequest } = await import("../src/lib/paypal/http");
  const orders = await import("../src/lib/paypal/orders");
  const { redact } = await import("../src/lib/paypal/preflight");
  const out = (name: string, body: unknown) =>
    fs.writeFileSync(path.join(process.cwd(), "fixtures/paypal/recorded", `tracking-${name}.json`), JSON.stringify(redact(body), null, 2) + "\n");

  // PayPal's documented sandbox test Visa; no buyer approval is needed for a card payment source.
  const order = await paypalRequest<{ id: string; status: string; purchase_units: { payments: { captures: { id: string }[] } }[] }>({
    method: "POST",
    path: "/v2/checkout/orders",
    label: "Create + capture test-card order",
    requestId: `rebuttal-verify-${Date.now()}`,
    json: {
      intent: "CAPTURE",
      purchase_units: [{ invoice_id: `FC-VERIFY-${Date.now()}`, amount: { currency_code: "USD", value: "84.00" }, description: "Speckled stoneware mug, oat (pair)" }],
      payment_source: {
        card: {
          number: "4032039317984658",
          expiry: "2030-12",
          name: "Test Buyer",
          security_code: "123",
          billing_address: { address_line_1: "1 Main St", admin_area_2: "San Jose", admin_area_1: "CA", postal_code: "95131", country_code: "US" },
        },
      },
    },
  });
  const captureId = order.body.purchase_units[0].payments.captures[0].id;
  console.log(`order ${order.body.id} ${order.body.status} · capture ${captureId}`);
  out("01-order-captured", order.body);

  const tracked = (await orders.addTracking(order.body.id, { captureId, trackingNumber: "NL4471029385US", carrierOther: "Northline Post" })) as {
    purchase_units?: { shipping?: { trackers?: { id: string; status: string }[] } }[];
  };
  out("02-add-tracking", tracked);
  const trackers = tracked.purchase_units?.[0]?.shipping?.trackers ?? [];
  console.log(`trackers after add: ${trackers.map((t) => `${t.id} ${t.status}`).join(", ") || "none"}`);

  const reread = (await orders.getOrder(order.body.id)) as typeof tracked;
  out("03-order-with-tracker", reread);
  const t = reread.purchase_units?.[0]?.shipping?.trackers?.[0];
  console.log(`re-read: ${t ? `${t.id} ${t.status}` : "no tracker"}`);
  process.exit(t ? 0 : 1);
}

main().catch((e) => {
  console.error(e?.message ?? e, e?.body ?? e?.result ?? "");
  process.exit(1);
});
