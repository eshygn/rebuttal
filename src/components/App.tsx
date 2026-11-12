"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CallList } from "./CallList";
import { DisputeDetail } from "./DisputeDetail";
import { Dock } from "./Dock";
import { api } from "./format";
import { Inbox } from "./Inbox";
import { Toasts } from "./Toasts";
import { TopBar } from "./TopBar";
import type { AppState, CallRow, DisputeDetail as Detail } from "./types";

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<CallRow[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [logOpen, setLogOpen] = useState(false);
  const [allCalls, setAllCalls] = useState<CallRow[]>([]);
  const [dockHidden, setDockHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastCall = useRef<number | null>(null);
  const knownIds = useRef<Set<string> | null>(null);
  const approveRef = useRef<null | (() => Promise<void>)>(null);

  const loadState = useCallback(async () => {
    try {
      const s = await api<AppState>("/api/state");
      setState(s);
      setError(null);
      // Toast every new PayPal call so each PayPal moment is visible on screen.
      const maxId = s.latestCalls[0]?.id ?? 0;
      if (lastCall.current === null) lastCall.current = maxId;
      else if (maxId > lastCall.current) {
        const fresh = s.latestCalls.filter((c) => c.id > lastCall.current!).reverse();
        lastCall.current = maxId;
        setToasts((t) => [...t, ...fresh].slice(-4));
        for (const c of fresh) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== c.id)), 5200);
      }
      // Highlight and open newly arrived disputes.
      const ids = new Set(s.disputes.map((d) => d.id));
      if (knownIds.current) {
        const arrived = [...ids].filter((id) => !knownIds.current!.has(id));
        if (arrived.length) {
          setFresh(new Set(arrived));
          setSelected(arrived[0]);
          setTimeout(() => setFresh(new Set()), 1500);
        }
      }
      knownIds.current = ids;
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const loadDetail = useCallback(async () => {
    if (!selected) return setDetail(null);
    try {
      setDetail(await api<Detail>(`/api/disputes/${selected}`));
    } catch {
      setDetail(null);
    }
  }, [selected]);

  // Poll the server: it is the source of truth for disputes, the clock and PayPal calls.
  useEffect(() => {
    const first = setTimeout(loadState, 0);
    const t = setInterval(loadState, 1500);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [loadState]);

  const analysing = detail?.analysis?.status === "running";
  useEffect(() => {
    const first = setTimeout(loadDetail, 0);
    const t = setInterval(loadDetail, analysing ? 600 : 1500);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [loadDetail, analysing]);

  useEffect(() => {
    if (!logOpen) return;
    const load = () => api<CallRow[]>("/api/calls").then(setAllCalls).catch(() => undefined);
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [logOpen]);

  const refresh = useCallback(async () => {
    await Promise.all([loadState(), loadDetail()]);
  }, [loadState, loadDetail]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runBeat() {
    if (!state) return;
    const beat = state.director;
    if (beat.disputeId && beat.disputeId !== selected) setSelected(beat.disputeId);
    if (beat.step.startsWith("approve") && approveRef.current && selected === beat.disputeId) {
      // Submit exactly what is in the composer, including any edits.
      await approveRef.current();
      return;
    }
    await act(async () => {
      const r = await api<{ disputeId?: string }>("/api/demo/step", { step: beat.step });
      if (r.disputeId) setSelected(r.disputeId);
    });
  }

  async function reset() {
    await act(async () => {
      await api("/api/demo/reset", {});
      knownIds.current = null;
      lastCall.current = null;
      setToasts([]);
      setSelected(null);
    });
  }

  return (
    <div className="shell">
      <TopBar
        state={state}
        page="disputes"
        busy={busy}
        onJump={(h) => act(() => api("/api/demo/clock", { hours: h }))}
        onReset={reset}
        onOpenLog={() => setLogOpen(true)}
      />
      {state ? (
        <div className="work">
          <Inbox state={state} selected={selected} onSelect={setSelected} fresh={fresh} />
          <main className="main">
            {error && <div className="err-box" style={{ marginBottom: 12 }}>{error}</div>}
            {detail && detail.summary.id === selected ? (
              <DisputeDetail d={detail} clock={state.clock} onChanged={refresh} approveRef={approveRef} setBusy={setBusy} busy={busy} />
            ) : (
              <Welcome state={state} />
            )}
          </main>
        </div>
      ) : (
        <div className="empty">
          <div>
            <h2>Rebuttal</h2>
            <p>{error ?? "Loading your disputes…"}</p>
          </div>
        </div>
      )}
      {state && <Dock beat={state.director} onRun={runBeat} busy={busy || analysing} hidden={dockHidden} onHide={setDockHidden} />}
      <Toasts calls={toasts} />
      {logOpen && (
        <>
          <div className="drawer-bg" onClick={() => setLogOpen(false)} />
          <aside className="drawer" aria-label="PayPal API log">
            <div className="drawer-h">
              <h2>PayPal API log</h2>
              <button className="btn ghost" onClick={() => setLogOpen(false)}>
                Close
              </button>
            </div>
            <div className="drawer-b">
              <p className="muted small">
                Every PayPal call Rebuttal made. <b>LIVE</b> went to the PayPal sandbox; <b>SIMULATED</b> was replayed by the sandbox simulator in the documented response shape. Click a row for the JSON.
              </p>
              <CallList calls={allCalls} />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

function Welcome({ state }: { state: AppState }) {
  const open = state.disputes.filter((d) => !["won", "lost", "settled", "refunded"].includes(d.stage)).length;
  return (
    <div className="empty">
      <div style={{ maxWidth: 520 }}>
        <h2>Disputes freeze your money. Rebuttal gets it back.</h2>
        <p>
          Rebuttal takes each PayPal dispute, gathers the proof it needs, and tells you whether to fight, offer a partial refund, or accept.
          You approve; it submits through the PayPal Disputes API and counts down every deadline.
        </p>
        <p className="small">
          {open} open dispute{open === 1 ? "" : "s"} · pick one on the left, or press <b>Next</b> below to run the demo story.
        </p>
      </div>
    </div>
  );
}
