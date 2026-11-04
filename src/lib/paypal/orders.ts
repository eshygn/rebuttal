/**
 * Orders v2 and order tracking, through the official PayPal Server SDK.
 * We keep the raw JSON body (PayPal's snake_case shape) for storage and display.
 */
import { Client, Environment, LogLevel, OrdersController, CheckoutPaymentIntent, ShipmentCarrier, type ApiResponse } from "@paypal/paypal-server-sdk";
import { recordCall } from "../calls";
import { env } from "../env";
import { toPayPalValue } from "../money";
import { emitCall } from "./http";

let client: Client | null = null;
function orders(): OrdersController {
  client ??= new Client({
    clientCredentialsAuthCredentials: { oAuthClientId: env.paypalClientId, oAuthClientSecret: env.paypalClientSecret },
    environment: Environment.Sandbox,
    timeout: 30_000,
    logging: { logLevel: LogLevel.Warn },
  });
  return new OrdersController(client);
}

function rawBody(res: ApiResponse<unknown>): unknown {
  return typeof res.body === "string" && res.body ? JSON.parse(res.body) : res.result;
}

async function call<T>(label: string, method: string, path: string, request: unknown, fn: () => Promise<ApiResponse<T>>): Promise<unknown> {
  try {
    const res = await fn();
    const body = rawBody(res as ApiResponse<unknown>);
    emitCall({ at: new Date().toISOString(), method, path, status: res.statusCode, mode: "live", actor: "seller", label, request, response: body });
    return body;
  } catch (e) {
    const err = e as { statusCode?: number; body?: string; result?: unknown };
    let body: unknown = err.result ?? null;
    try {
      body = err.body ? JSON.parse(err.body) : body;
    } catch {
      /* keep result */
    }
    emitCall({ at: new Date().toISOString(), method, path, status: err.statusCode ?? 0, mode: "live", actor: "seller", label, request, response: body });
    throw e;
  }
}

export type CartLine = { name: string; sku: string; qty: number; unitMinor: number };

export async function createOrder(input: { invoiceId: string; lines: CartLine[]; shippingMinor: number; currency: string }) {
  const v = (m: number) => toPayPalValue(m, input.currency);
  const itemTotal = input.lines.reduce((s, l) => s + l.qty * l.unitMinor, 0);
  const body = {
    intent: CheckoutPaymentIntent.Capture,
    purchaseUnits: [
      {
        invoiceId: input.invoiceId,
        amount: {
          currencyCode: input.currency,
          value: v(itemTotal + input.shippingMinor),
          breakdown: {
            itemTotal: { currencyCode: input.currency, value: v(itemTotal) },
            shipping: { currencyCode: input.currency, value: v(input.shippingMinor) },
          },
        },
        items: input.lines.map((l) => ({ name: l.name, sku: l.sku, quantity: String(l.qty), unitAmount: { currencyCode: input.currency, value: v(l.unitMinor) } })),
      },
    ],
  };
  return call("Create order", "POST", "/v2/checkout/orders", body, () => orders().createOrder({ body, prefer: "return=representation" }));
}

export function captureOrder(id: string) {
  return call("Capture order", "POST", `/v2/checkout/orders/${id}/capture`, {}, () => orders().captureOrder({ id, prefer: "return=representation" }));
}

export function getOrder(id: string) {
  return call("Show order details", "GET", `/v2/checkout/orders/${id}`, undefined, () => orders().getOrder({ id }));
}

export function addTracking(id: string, t: { captureId: string; trackingNumber: string; carrierOther: string }) {
  const body = { captureId: t.captureId, trackingNumber: t.trackingNumber, carrier: ShipmentCarrier.Other, carrierNameOther: t.carrierOther, notifyPayer: false };
  return call("Add tracking", "POST", `/v2/checkout/orders/${id}/track`, body, () => orders().createOrderTracking({ id, body }));
}

export function recordSimulatedOrderCall(label: string, method: string, path: string, request: unknown, response: unknown) {
  recordCall({ at: new Date().toISOString(), method, path, status: method === "POST" ? 201 : 200, mode: "simulated", actor: "seller", label, request, response });
}
