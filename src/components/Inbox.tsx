"use client";

import type { AppState } from "./types";
import { ACTION_WORD, countdown, money } from "./format";

type Props = { state: AppState; selected: string | null; onSelect: (id: string) => void; fresh: Set<string> };

export function Inbox({ state, selected, onSelect, fresh }: Props) {
  const { stats } = state;
  const open = state.disputes.filter((d) => !["won", "lost", "settled", "refunded"].includes(d.stage));
  const closed = state.disputes.filter((d) => ["won", "lost", "settled", "refunded"].includes(d.stage));
  return (
    <aside className="rail">
      <div className="stats">
        <div className="stat">
          <div className="caps">Frozen by disputes</div>
          <div className="v">
            {money(stats.atStakeMinor, stats.currency)}
          </div>
        </div>
        <div className="stat kept">
          <div className="caps">Kept with Rebuttal</div>
          <div className="v">{money(stats.keptMinor, stats.currency)}</div>
        </div>
        <div className="stat wide">
          <span className="caps">Lost before Rebuttal</span>
          <span className="muted small">
            {state.history.length} disputes · {money(stats.lostBeforeMinor, stats.currency)}
          </span>
        </div>
      </div>

      <div className="list-h">
        <span className="caps">Open · {open.length}</span>
        <span className="muted small">sorted by deadline</span>
      </div>
      {open.length === 0 && <p className="muted small">No open disputes. Quiet day.</p>}
      {[...open]
        .sort((a, b) => Date.parse(a.dueAt ?? "2100-01-01") - Date.parse(b.dueAt ?? "2100-01-01"))
        .map((d) => (
          <Card key={d.id} d={d} state={state} sel={selected === d.id} fresh={fresh.has(d.id)} onSelect={onSelect} />
        ))}

      {closed.length > 0 && (
        <>
          <div className="list-h" style={{ marginTop: 14 }}>
            <span className="caps">Resolved · {closed.length}</span>
          </div>
          {closed.map((d) => (
            <Card key={d.id} d={d} state={state} sel={selected === d.id} fresh={false} onSelect={onSelect} />
          ))}
        </>
      )}

      <div className="history">
        <div className="caps" style={{ marginBottom: 4 }}>
          Before Rebuttal
        </div>
        {state.history.map((h) => (
          <div className="hrow" key={h.id}>
            <span>
              {h.buyer} · {h.reasonLabel}
            </span>
            <span>lost {money(h.amountMinor, h.currency)}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function Card({ d, state, sel, fresh, onSelect }: { d: AppState["disputes"][number]; state: AppState; sel: boolean; fresh: boolean; onSelect: (id: string) => void }) {
  const cd = d.dueAt ? countdown(d.dueAt, state.clock) : null;
  const terminal = ["won", "lost", "settled", "refunded"].includes(d.stage);
  return (
    <button className={`dcard ${sel ? "sel" : ""} ${fresh ? "fresh" : ""}`} onClick={() => onSelect(d.id)}>
      <div className="dcard-top">
        <span className="dcard-buyer">{d.buyer}</span>
        <span className="dcard-amt">{money(d.amountMinor, d.currency)}</span>
      </div>
      <div className="dcard-item">{d.item}</div>
      <div className="dcard-meta">
        <span className="pill reason">{d.reasonLabel}</span>
        {terminal ? (
          <span className={`pill ${d.stage}`}>{d.stageLabel}</span>
        ) : d.recommendation ? (
          <span className={`pill ${d.recommendation.action}`}>
            {ACTION_WORD[d.recommendation.action as keyof typeof ACTION_WORD]}
            {d.recommendation.action === "offer" && d.recommendation.offerMinor ? ` ${money(d.recommendation.offerMinor, d.currency)}` : ""}
          </span>
        ) : (
          <span className="pill">{d.stageLabel}</span>
        )}
        <span className={`pill ${d.source}`}>{d.source === "sandbox" ? "Sandbox" : "Simulated"}</span>
        <span className="spacer" />
        {cd && !terminal && <span className={`due ${cd.urgent ? "urgent" : ""}`}>{cd.text}</span>}
      </div>
    </button>
  );
}
