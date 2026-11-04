"use client";

import type { CallRow } from "./types";

export function Toasts({ calls }: { calls: CallRow[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {calls.map((c) => (
        <div key={c.id} className={`toast ${c.actor}`}>
          <div className="top">
            <span className="who">
              {c.actor === "seller" ? "PayPal API" : c.actor === "buyer" ? "Sandbox · plays buyer" : "Sandbox · plays PayPal"}
            </span>
            <span className={`mode ${c.mode}`}>{c.mode === "live" ? "LIVE" : "SIMULATED"}</span>
          </div>
          <div className="lbl">{c.label}</div>
          <div className="ep">
            {c.method} {c.path} → {c.status}
          </div>
        </div>
      ))}
    </div>
  );
}
