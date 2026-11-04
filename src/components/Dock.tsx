"use client";

import type { AppState } from "./types";

type Props = { beat: AppState["director"]; onRun: () => void; busy: boolean; hidden: boolean; onHide: (h: boolean) => void };

export function Dock({ beat, onRun, busy, hidden, onHide }: Props) {
  if (hidden)
    return (
      <button className="btn primary dock-min" onClick={() => onHide(false)}>
        Demo script · {beat.index}/{beat.total}
      </button>
    );
  const done = beat.step === "done";
  return (
    <div className="dock" role="region" aria-label="Demo script">
      <span className="n">
        {beat.index}/{beat.total}
      </span>
      <div className="txt">
        <div className="t">{beat.title}</div>
        <div className="h">{beat.hint}</div>
      </div>
      {!done && (
        <button className="btn big" onClick={onRun} disabled={busy}>
          {busy ? "Working…" : "Next →"}
        </button>
      )}
      <button className="x" onClick={() => onHide(true)} aria-label="Hide demo script">
        ×
      </button>
    </div>
  );
}
