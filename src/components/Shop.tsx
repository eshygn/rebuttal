"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { api, fmtDateTime, money } from "./format";
import { Toasts } from "./Toasts";
import { TopBar } from "./TopBar";
import type { AppState, CallRow } from "./types";

const PayPalButton = dynamic(() => import("./PayPalButton"), { ssr: false, loading: () => <div className="paybox muted small">Loading PayPal…</div> });

type Config = {
  mode: "live" | "mock";
  clientId: string | null;
  currency: string;
  seller: string;
  products: { sku: string; name: string; blurb: string; unitMinor: number; shippingMinor: number; tone: string }[];
};
type Order = {
  id: string;
  buyer_name: string;
  amount_minor: number;
  currency: string;
  paid_at: string;
  source: string;
  tracking: { number: string; carrierOther?: string } | null;
  paypal_order_id: string;
  disputed: number;
};

export function Shop() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [state, setState] = useState<AppState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<CallRow[]>([]);

  const load = useCallback(async () => {
    const [o, s] = await Promise.all([api<Order[]>("/api/shop/orders"), api<AppState>("/api/state")]);
    setOrders(o);
    setState(s);
    return s;
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api<Config>("/api/config").then(setCfg).catch((e) => setMsg((e as Error).message));
      load().catch(() => undefined);
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function afterPayPal(note: string) {
    setMsg(note);
    const before = state?.latestCalls[0]?.id ?? 0;
    const s = await load();
    const fresh = s.latestCalls.filter((c) => c.id > before).reverse();
    setToasts(fresh.slice(-3));
    setTimeout(() => setToasts([]), 5200);
  }

  const onPaid = useCallback(
    (r: { id: string; mode: string }) => {
      void afterPayPal(`Paid: order ${r.id} captured through PayPal (${r.mode === "live" ? "sandbox" : "simulated"}).`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state],
  );
  const onError = useCallback((m: string) => setMsg(m), []);

  async function simulatedCheckout(sku: string) {
    setBusy(true);
    try {
      const o = await api<{ id: string }>("/api/shop/orders", { sku });
      const r = await api<{ id: string; mode: string }>("/api/shop/capture", { orderId: o.id, sku });
      onPaid(r);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function track(id: string) {
    setBusy(true);
    try {
      const r = await api<{ mode: string }>("/api/shop/track", { id });
      await afterPayPal(`Tracking added to the PayPal transaction for ${id} (${r.mode === "live" ? "sandbox" : "simulated"}).`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <TopBar state={state} page="shop" />
      <div className="shop">
        <div className="shop-hero">
          <div>
            <div className="caps">The seller’s storefront</div>
            <h1>Fernhill Ceramics</h1>
            <p className="muted" style={{ margin: "4px 0 0", maxWidth: "62ch" }}>
              Buyers pay with PayPal Smart Buttons (JS SDK); the server creates and captures the order through Orders v2. When an order ships, the seller adds tracking to the PayPal transaction. Rebuttal reads all of this when a dispute arrives.
            </p>
          </div>
          {cfg && (
            <span className={`chip ${cfg.mode}`}>
              <span className="dot" />
              {cfg.mode === "live" ? "Checkout: PayPal sandbox" : "Checkout: simulated (no PayPal keys)"}
            </span>
          )}
        </div>
        {msg && <div className="note" style={{ marginBottom: 14 }}>{msg}</div>}
        <div className="products">
          {cfg?.products.map((p) => (
            <div className="card product" key={p.sku}>
              <div className={`swatch ${p.tone}`} />
              <h3>{p.name}</h3>
              <div className="muted small">{p.blurb}</div>
              <div className="price">
                {money(p.unitMinor, cfg.currency)} <span className="muted small">+ {money(p.shippingMinor, cfg.currency)} shipping</span>
              </div>
              {cfg.mode === "live" && cfg.clientId ? (
                <PayPalButton clientId={cfg.clientId} currency={cfg.currency} sku={p.sku} onPaid={onPaid} onError={onError} />
              ) : (
                <button className="simpay" disabled={busy} onClick={() => simulatedCheckout(p.sku)}>
                  Pay with PayPal <span style={{ fontWeight: 500 }}>(simulated)</span>
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="card" style={{ marginTop: 22 }}>
          <div className="card-h">
            <h3>Orders</h3>
            <span className="muted small">Tracking goes to PayPal via POST /v2/checkout/orders/{"{id}"}/track</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="orders">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Buyer</th>
                  <th>Paid</th>
                  <th>Total</th>
                  <th>PayPal tracking</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="mono">{o.id}</td>
                    <td>{o.buyer_name}</td>
                    <td>{fmtDateTime(o.paid_at)}</td>
                    <td>{money(o.amount_minor, o.currency)}</td>
                    <td>
                      {o.tracking ? (
                        <span className="small">
                          {o.tracking.carrierOther ?? "Carrier"} <span className="mono">{o.tracking.number}</span>
                        </span>
                      ) : o.disputed ? (
                        <span className="small muted">Shipped untracked · in dispute</span>
                      ) : (
                        <button className="btn" disabled={busy} onClick={() => track(o.id)}>
                          Mark shipped + add tracking
                        </button>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${o.source}`}>{o.source === "sandbox" ? "Sandbox" : "Simulated"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <Toasts calls={toasts} />
    </div>
  );
}
