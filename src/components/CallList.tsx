"use client";

import { useState } from "react";
import type { CallRow } from "./types";

const ACTOR: Record<string, string> = { seller: "", buyer: "as buyer", paypal: "as PayPal" };

export function CallList({ calls }: { calls: CallRow[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!calls.length) return <p className="muted small">No PayPal calls yet.</p>;
  return (
    <ul className="calls">
      {calls.map((c) => (
        <li key={c.id}>
          <button className="call-row" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
            <span className="m">{c.method}</span>
            <span className="p">
              <span className="l">
                {c.label} {ACTOR[c.actor] && <span className="muted">({ACTOR[c.actor]})</span>}
              </span>
              {c.path}
            </span>
            <span className={`s ${c.status >= 400 ? "err" : ""}`}>{c.status}</span>
            <span className={`mode ${c.mode}`}>{c.mode === "live" ? "LIVE" : "SIMULATED"}</span>
          </button>
          {c.note && <div className="callnote">{c.note}</div>}
          {open === c.id && (
            <>
              {c.request && <pre className="json">{"// request\n" + pretty(c.request)}</pre>}
              <pre className="json">{"// response\n" + pretty(c.response)}</pre>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function pretty(s: string | null) {
  if (!s) return "null";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
