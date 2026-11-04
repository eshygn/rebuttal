"use client";

/**
 * PayPal JS SDK Smart Buttons (browser-only; loaded with next/dynamic, ssr: false).
 * createOrder and onApprove call our server, which talks to Orders v2 through the PayPal Server SDK.
 */
import { useEffect, useRef, useState } from "react";

type PayPalNamespace = {
  Buttons: (opts: {
    style?: Record<string, unknown>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onError?: (err: unknown) => void;
  }) => { render: (el: HTMLElement) => Promise<void>; close?: () => void };
};

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

let sdk: Promise<PayPalNamespace> | null = null;
function loadSdk(clientId: string, currency: string): Promise<PayPalNamespace> {
  sdk ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${currency}&intent=capture&components=buttons&disable-funding=paylater,venmo`;
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal SDK missing")));
    s.onerror = () => reject(new Error("Could not load the PayPal JS SDK"));
    document.head.appendChild(s);
  });
  return sdk;
}

export default function PayPalButton(props: {
  clientId: string;
  currency: string;
  sku: string;
  onPaid: (r: { id: string; mode: string }) => void;
  onError: (msg: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const { clientId, currency, sku, onPaid, onError } = props;

  useEffect(() => {
    let cancelled = false;
    let buttons: { close?: () => void } | null = null;
    loadSdk(clientId, currency)
      .then((paypal) => {
        if (cancelled || !el.current) return;
        const b = paypal.Buttons({
          style: { layout: "horizontal", color: "gold", shape: "rect", label: "paypal", height: 42, tagline: false },
          createOrder: async () => {
            const r = await fetch("/api/shop/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sku }) });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error);
            return j.id;
          },
          onApprove: async ({ orderID }) => {
            const r = await fetch("/api/shop/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: orderID, sku }) });
            const j = await r.json();
            if (!r.ok) return onError(j.error);
            onPaid(j);
          },
          onError: (err) => onError(String((err as Error)?.message ?? err)),
        });
        buttons = b;
        return b.render(el.current);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      buttons?.close?.();
    };
  }, [clientId, currency, sku, onPaid, onError]);

  if (failed) return <p className="muted small">PayPal checkout could not load in this browser.</p>;
  return <div ref={el} className="paybox" />;
}
