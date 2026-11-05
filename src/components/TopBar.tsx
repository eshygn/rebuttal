"use client";

import Link from "next/link";
import type { AppState } from "./types";
import { fmtClock } from "./format";

type Props = {
  state: AppState | null;
  page: "disputes" | "shop";
  onJump?: (hours: number) => void;
  onReset?: () => void;
  onOpenLog?: () => void;
  busy?: boolean;
};

export function TopBar({ state, page, onJump, onReset, onOpenLog, busy }: Props) {
  const pp = state?.status.paypal;
  const ai = state?.status.ai;
  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="Rebuttal home">
        <span className="brand-mark">R</span>
        <span className="brand-name">Rebuttal</span>
      </Link>
      <span className="brand-for">for Fernhill Ceramics</span>
      <nav className="nav">
        <Link href="/" aria-current={page === "disputes" ? "page" : undefined}>
          Disputes
        </Link>
        <Link href="/shop" aria-current={page === "shop" ? "page" : undefined}>
          Shop &amp; orders
        </Link>
      </nav>
      <span className="spacer" />
      {state && (
        <div className="clock" title="Demo clock: jump time forward to see deadlines move">
          <span className="clock-label">Demo clock</span>
          <span className="clock-time">{fmtClock(state.clock)}</span>
          {onJump && (
            <>
              <button onClick={() => onJump(24)} disabled={busy}>
                +1 day
              </button>
              <button onClick={() => onJump(72)} disabled={busy}>
                +3 days
              </button>
            </>
          )}
        </div>
      )}
      {pp && (
        <span className={`chip ${pp.mode}`} title={pp.detail}>
          <span className="dot" />
          PayPal: {pp.mode === "live" ? "sandbox live" : "mock"}
          {pp.warning && <b style={{ color: "var(--sim)" }} aria-label="Configuration warning"> ⚠</b>}
        </span>
      )}
      {ai && (
        <span className={`chip ${ai.mode}`} title={ai.detail}>
          <span className="dot" />
          AI: {ai.mode === "live" ? "Gemini live" : "fallback" in ai && ai.fallback ? "fallback · recorded" : "recorded runs"}
        </span>
      )}
      {onOpenLog && (
        <button className="btn ghost" onClick={onOpenLog}>
          API log
        </button>
      )}
      {onReset && (
        <button className="btn" onClick={onReset} disabled={busy}>
          Reset demo
        </button>
      )}
    </header>
  );
}
