"use client";

import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { parseMinor, percentOf, toPayPalValue } from "@/lib/money";
import type { TraceStep } from "@/lib/ai/agent";
import type { CallRow, DisputeDetail as Detail } from "./types";
import { ACTION_WORD, api, countdown, fmtDateTime, fmtDay, money } from "./format";
import { CallList } from "./CallList";

type Props = {
  d: Detail;
  clock: string;
  onChanged: () => void;
  approveRef: MutableRefObject<null | (() => Promise<void>)>;
  setBusy: (b: boolean) => void;
  busy: boolean;
};

const TERMINAL = ["won", "lost", "settled", "refunded"];

export function DisputeDetail({ d, clock, onChanged, approveRef, setBusy, busy }: Props) {
  const s = d.summary;
  const a = d.analysis;
  const r = a?.result ?? null;
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cd = s.dueAt ? countdown(s.dueAt, clock) : null;
  const terminal = TERMINAL.includes(s.stage);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="dh">
        <div>
          <div className="dh-eyebrow">
            <span className="caps">{s.id}</span>
            <span className="pill reason">{s.reasonLabel}</span>
            <span className={`pill ${s.source}`} title={s.source === "sandbox" ? "This dispute exists in the PayPal sandbox" : "Replayed by Rebuttal’s sandbox simulator"}>
              {s.source === "sandbox" ? "PayPal sandbox" : "Simulated"}
            </span>
            <span className="pill">PayPal: {s.paypalStatus.replace(/_/g, " ").toLowerCase()}</span>
            {cd && !terminal && <span className={`pill ${cd.urgent ? "urgent" : ""}`}>{cd.text}</span>}
          </div>
          <h1>
            {s.buyer} <em>·</em> {s.item}
          </h1>
          <div className="muted small" style={{ marginTop: 4 }}>
            Order {d.order.id} · paid {fmtDay(d.order.paidAt)} · ships to {d.order.shipTo}
          </div>
        </div>
        <div className="dh-amt">
          <div className="v">
            {money(s.amountMinor, s.currency).replace(` ${s.currency}`, "")}
            <small>{s.currency}</small>
          </div>
          {terminal ? (
            <div className="frozen released">{s.recoveredMinor > 0 ? `${money(s.recoveredMinor, s.currency)} kept` : "Refunded"}</div>
          ) : (
            <div className="frozen">On hold by PayPal{s.dueAt ? ` · respond by ${fmtDay(s.dueAt)}` : ""}</div>
          )}
        </div>
      </div>

      {d.claim && (
        <blockquote className="claim">
          “{d.claim}”<cite>{s.buyer}, opened {fmtDateTime(s.openedAt)}</cite>
        </blockquote>
      )}

      {terminal && <Resolved d={d} />}

      {!a && s.stage === "new" && (
        <div className="start">
          <div>
            <h2>Build the case for this dispute</h2>
            <p>Rebuttal’s agent gathers everything this dispute reason needs and recommends one action. Nothing is sent to PayPal until you approve.</p>
            <ol>
              <li>Pull the dispute and the payment</li>
              <li>Read the PayPal tracking record</li>
              <li>Read your carrier proof and photos</li>
              <li>Check the evidence rules</li>
              <li>Recommend fight, offer or accept</li>
              <li>Draft the response</li>
            </ol>
          </div>
          <button className="btn big" disabled={busy} onClick={() => run(() => api(`/api/disputes/${s.id}/analyse`, {}))}>
            Build my case →
          </button>
        </div>
      )}
      {!a && s.stage === "new" && (
        <div style={{ marginTop: 16 }}>
          <EvidenceFiles d={d} run={run} busy={busy} onZoom={setLightbox} />
        </div>
      )}

      {a && (
        <div className="grid2">
          <div className="stack">
            <Trace a={a} onRerun={s.stage === "ready" ? () => run(() => api(`/api/disputes/${s.id}/analyse`, {})) : undefined} busy={busy} />
            {r && <Checklist r={r} />}
            {(s.stage === "ready" || s.stage === "new") && <EvidenceFiles d={d} run={run} busy={busy} onZoom={setLightbox} />}
          </div>
          <div className="stack">
            {r ? <Verdict d={d} /> : <Thinking />}
            {r && <EvidenceViews d={d} onZoom={setLightbox} />}
            {r && s.stage === "ready" && <Composer key={s.id + a.finishedAt} d={d} approveRef={approveRef} run={run} busy={busy} />}
            {(s.stage === "submitted" || s.stage === "offered") && <SandboxMoves d={d} run={run} busy={busy} />}
          </div>
        </div>
      )}
      {error && <div className="err-box">{error}</div>}

      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-h">
            <h3>Timeline</h3>
          </div>
          <ul className="timeline">
            {d.events.map((e) => (
              <li key={e.id}>
                <time>{fmtDateTime(e.at)}</time>
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="card-h">
            <h3>PayPal API calls</h3>
            <span className="muted small">{d.calls.length} for this dispute</span>
          </div>
          <CallList calls={d.calls as CallRow[]} />
        </div>
      </div>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Evidence" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------

const PAYPAL_TOOLS = new Set(["get_dispute", "get_transaction", "get_tracking_record"]);
const AI_TOOLS = new Set(["read_carrier_document", "compare_photos", "submit_recommendation"]);

function traceSub(t: TraceStep): string | null {
  const o = t.output as Record<string, unknown> | undefined;
  if (!o || t.status !== "done") return null;
  switch (t.tool) {
    case "get_dispute":
      return `${o.reason_label} · ${o.amount} · ${String(o.status).replace(/_/g, " ").toLowerCase()}`;
    case "get_transaction":
      return `${o.order} · ${o.amount} · ships to ${o.ship_to}`;
    case "get_tracking_record": {
      const tr = o.tracker as { carrier: string; number: string; status: string } | null;
      return tr ? `${tr.carrier} ${tr.number} · status “${tr.status}” (entered by seller, no scans)` : "No tracking on the PayPal transaction";
    }
    case "list_seller_evidence":
      return Array.isArray(t.output) ? `${t.output.length} items: ${(t.output as { kind: string }[]).map((x) => x.kind.replace(/_/g, " ")).join(", ")}` : null;
    case "read_carrier_document": {
      const at = o.delivered_at as string | null;
      return `${String(o.status).toLowerCase()}${at ? ` ${fmtDateTime(at)}` : ""} · address ${o.address_matches_paypal_ship_to ? "matches PayPal ✓" : "does not match ✗"}`;
    }
    case "compare_photos":
      return String(o.summary ?? "");
    case "check_evidence_coverage":
      return `Evidence ${o.strength} · ${o.score}/100 · rules say ${String(o.baseline_action).toUpperCase()}`;
    case "submit_recommendation": {
      const i = t.input as { action?: string; confidence?: number };
      return i?.action ? `${i.action.toUpperCase()} · ${i.confidence}% confident` : null;
    }
  }
  return null;
}

function Trace({ a, onRerun, busy }: { a: NonNullable<Detail["analysis"]>; onRerun?: () => void; busy: boolean }) {
  return (
    <div className="card">
      <div className="card-h">
        <h3>Agent at work</h3>
        {onRerun && (
          <button className="btn ghost" style={{ padding: "2px 6px", fontSize: 12 }} disabled={busy} onClick={onRerun}>
            ↻ Re-run
          </button>
        )}
        <span className={`chip ${a.aiMode === "live" || a.aiMode === "cached" ? "live" : "recorded"}`} title={a.note ?? undefined}>
          <span className="dot" />
          {a.aiMode === "live"
            ? `Gemini live · ${a.model ?? ""}`
            : a.aiMode === "cached"
              ? `Gemini · cached run · ${a.model ?? ""}`
              : a.aiMode === "recorded"
                ? `Recorded Gemini run · ${a.model ?? ""}`
                : "Rules only"}
        </span>
      </div>
      <ul className="trace">
        {a.trace.map((t) => (
          <li key={t.id}>
            <span className={`tick ${t.status}`}>{t.status === "done" ? "✓" : t.status === "error" ? "!" : ""}</span>
            <div>
              <div className="t-label">
                {t.label}
                {PAYPAL_TOOLS.has(t.tool) && <span className="ppbadge">PayPal API</span>}
                {AI_TOOLS.has(t.tool) && <span className="aibadge">{t.tool === "submit_recommendation" ? "Gemini" : "Gemini vision"}</span>}
              </div>
              {traceSub(t) && <div className="t-sub">{traceSub(t)}</div>}
              <div className="t-tool">{t.tool}()</div>
            </div>
            <span className="t-ms">{t.ms !== undefined ? `${(t.ms / 1000).toFixed(1)}s` : ""}</span>
          </li>
        ))}
        {a.status === "running" && a.trace.every((t) => t.status !== "running") && (
          <li>
            <span className="tick running" />
            <div className="t-label muted">Thinking…</div>
            <span />
          </li>
        )}
      </ul>
      {a.note && <div className="note">{a.note}</div>}
      {a.status === "failed" && <div className="err-box">Analysis failed. Try again.</div>}
    </div>
  );
}

function Thinking() {
  return (
    <div className="card verdict">
      <div className="caps">Recommendation</div>
      <div className="verdict-word muted" style={{ color: "var(--line-2)" }}>
        …
      </div>
      <p className="muted">The agent is gathering evidence. The recommendation appears when it has checked the rules table.</p>
    </div>
  );
}

function Verdict({ d }: { d: Detail }) {
  const r = d.analysis!.result!;
  const rec = r.recommendation;
  const s = d.summary;
  const offer = r.offerMinor ?? 0;
  const terminal = TERMINAL.includes(s.stage);
  return (
    <div className={`card verdict ${rec.action}`}>
      {terminal && <span className="stamp">{s.stage === "won" ? "WON" : s.stage === "settled" ? "SETTLED" : s.stage === "refunded" ? "REFUNDED" : "CLOSED"}</span>}
      <div className="caps">Rebuttal recommends</div>
      <div className="verdict-word">{ACTION_WORD[rec.action].toUpperCase()}</div>
      <div className="verdict-head">{rec.headline}</div>
      <ul>
        {rec.reasoning.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
      <div className="conf">
        <span>Confidence</span>
        <span className="conf-bar">
          <span style={{ width: `${rec.confidence}%` }} />
        </span>
        <b style={{ color: "var(--ink)" }}>{rec.confidence}%</b>
        <span className={`agree ${r.agrees ? "" : "no"}`} title="The fixed rules table, computed without AI, is a cross-check on the agent">
          {r.agrees ? "✓ Rules table agrees" : `Rules table says ${r.baseline.toUpperCase()}`}
        </span>
      </div>
      <div className="outcomes">
        <div className={`outcome ${rec.action === "fight" ? "pick fight" : ""}`}>
          <div className="k">Fight</div>
          <div className="v">{money(s.amountMinor, s.currency)}</div>
          <div className="s">kept if PayPal agrees</div>
        </div>
        <div className={`outcome ${rec.action === "offer" ? "pick offer" : ""}`}>
          <div className="k">Offer</div>
          <div className="v">{rec.action === "offer" ? money(s.amountMinor - offer, s.currency) : "—"}</div>
          <div className="s">{rec.action === "offer" ? `kept, refund ${money(offer, s.currency)}` : "not suggested"}</div>
        </div>
        <div className={`outcome ${rec.action === "accept" ? "pick accept" : ""}`}>
          <div className="k">Accept</div>
          <div className="v">{money(0, s.currency)}</div>
          <div className="s">kept, full refund</div>
        </div>
      </div>
      {rec.risks.length > 0 && (
        <p className="muted small" style={{ margin: "10px 0 0" }}>
          Risk: {rec.risks.join(" ")}
        </p>
      )}
    </div>
  );
}

function Checklist({ r }: { r: NonNullable<NonNullable<Detail["analysis"]>["result"]> }) {
  const c = r.coverage;
  return (
    <div className="card">
      <div className="card-h">
        <h3>Evidence rules</h3>
        <div className="strength">
          <span className="small muted">
            {c.strength} · {c.score}/100
          </span>
          <span className="strength-bar">
            <span style={{ width: `${c.score}%` }} />
          </span>
        </div>
      </div>
      <ul className="checks">
        {c.items.map((i) => (
          <li key={i.id}>
            <span className={`mark ${i.state}`}>{i.state === "present" ? "✓" : i.state === "against" ? "✗" : "–"}</span>
            <div>
              <div className="c-label">{i.label}</div>
              <div className="c-detail">{i.detail}</div>
              <div className="c-why">{i.why}</div>
            </div>
            <span className={`weight ${i.weight}`}>{i.weight}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceViews({ d, onZoom }: { d: Detail; onZoom: (src: string) => void }) {
  const r = d.analysis!.result!;
  const scan = r.facts.carrierScan as (Record<string, unknown> & { status: string; deliveredAt?: string | null; address?: string | null; trackingNumber?: string | null }) | null | undefined;
  const carrierDoc = d.evidence.find((e) => e.kind === "carrier_document");
  const listingPhoto = d.evidence.find((e) => e.kind === "listing_photo");
  const buyerPhoto = d.evidence.find((e) => e.kind === "buyer_photo");
  const t = d.order.tracker;
  return (
    <>
      {(scan || (t && d.summary.reason !== "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED")) && (
        <div className="card">
          <div className="card-h">
            <h3>Proof of delivery</h3>
          </div>
          <div className="versus">
            <div className="vbox pp">
              <h4>
                What PayPal’s tracking API knows <span className="ppbadge">PayPal</span>
              </h4>
              {t ? (
                <dl className="kv">
                  <dt>Carrier</dt>
                  <dd>{t.carrier}</dd>
                  <dt>Number</dt>
                  <dd className="mono">{t.number}</dd>
                  <dt>Status</dt>
                  <dd>{t.status} <span className="muted small">(set by seller)</span></dd>
                  <dt>Delivered?</dt>
                  <dd className="muted">Unknown: no carrier scans</dd>
                </dl>
              ) : (
                <p className="muted small">No tracking was added to this payment.</p>
              )}
            </div>
            <div className="vbox ai">
              <h4>
                What the carrier says <span className="aibadge">Read by Gemini</span>
              </h4>
              {scan ? (
                <dl className="kv">
                  <dt>Status</dt>
                  <dd className={scan.status === "DELIVERED" ? "ok" : "bad"}>{scan.status}</dd>
                  <dt>Delivered</dt>
                  <dd>{scan.deliveredAt ? fmtDateTime(scan.deliveredAt) : "—"}</dd>
                  <dt>Address</dt>
                  <dd>
                    {scan.address ?? "—"}{" "}
                    {scan.address_matches_paypal_ship_to === true && <span className="ok">✓ matches PayPal</span>}
                    {scan.address_matches_paypal_ship_to === false && <span className="bad">✗ differs</span>}
                  </dd>
                  <dt>Before claim</dt>
                  <dd>{typeof scan.days_delivered_before_claim === "number" ? `${scan.days_delivered_before_claim} days` : "—"}</dd>
                </dl>
              ) : (
                <p className="muted small">No carrier screenshot or PDF on file.</p>
              )}
            </div>
          </div>
          {carrierDoc?.file && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="docthumb" src={carrierDoc.file} alt={carrierDoc.title} onClick={() => onZoom(carrierDoc.file!)} />
          )}
        </div>
      )}
      {listingPhoto?.file && buyerPhoto?.file && (
        <div className="card">
          <div className="card-h">
            <h3>Listing vs what arrived</h3>
            <span className="aibadge">Compared by Gemini</span>
          </div>
          <div className="photos">
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={listingPhoto.file} alt="Listing photo" onClick={() => onZoom(listingPhoto.file!)} />
              <figcaption>Your listing photo</figcaption>
            </figure>
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={buyerPhoto.file} alt="Buyer photo" onClick={() => onZoom(buyerPhoto.file!)} />
              <figcaption>The buyer’s photo</figcaption>
            </figure>
          </div>
          {r.facts.photoComparison && <p style={{ margin: "10px 0 0" }}>{r.facts.photoComparison.summary}</p>}
        </div>
      )}
    </>
  );
}

function Composer({
  d,
  approveRef,
  run,
  busy,
}: {
  d: Detail;
  approveRef: MutableRefObject<null | (() => Promise<void>)>;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const r = d.analysis!.result!;
  const rec = r.recommendation;
  const s = d.summary;
  const [action, setAction] = useState(rec.action);
  const [note, setNote] = useState(rec.response_to_paypal);
  const [offerText, setOfferText] = useState(toPayPalValue(r.offerMinor ?? percentOf(s.amountMinor, 3000), s.currency));
  const offerMinor = useMemo(() => {
    try {
      return parseMinor(offerText, s.currency);
    } catch {
      return NaN;
    }
  }, [offerText, s.currency]);
  const attach = d.evidence.filter((e) => e.file && rec.evidence_to_attach.includes(e.id) && e.kind !== "buyer_photo");
  const endpoint = action === "fight" ? "provide-evidence" : action === "offer" ? "make-offer" : "accept-claim";
  const offerValid = action !== "offer" || (Number.isInteger(offerMinor) && offerMinor > 0 && offerMinor < s.amountMinor);

  const submit = async () =>
    run(() => api(`/api/disputes/${s.id}/approve`, { action, note, ...(action === "offer" ? { offerMinor } : {}) }));

  useEffect(() => {
    approveRef.current = submit;
    return () => {
      approveRef.current = null;
    };
  });

  return (
    <div className="card composer">
      <div className="card-h">
        <h3>{action === "fight" ? "Response to PayPal" : action === "offer" ? "Offer message to the buyer" : "Refund note"}</h3>
        <div className="alts">
          {d.actions.map((x) => (
            <button key={x} className={`pill ${x === action ? x : ""}`} style={{ border: 0 }} onClick={() => setAction(x)}>
              {ACTION_WORD[x]}
              {x === rec.action ? " ★" : ""}
            </button>
          ))}
        </div>
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} aria-label="Draft response" />
      {action === "fight" && (
        <div className="attach">
          <span className="caps" style={{ background: "none", padding: 0 }}>
            Evidence pack:
          </span>
          {d.order.tracker && <span>Tracking {d.order.tracker.number} (PROOF_OF_FULFILLMENT)</span>}
          {attach.map((e) => (
            <span key={e.id}>📎 {e.title}</span>
          ))}
        </div>
      )}
      {action === "offer" && (
        <div className="offerin" style={{ margin: "10px 0" }}>
          <label className="small" htmlFor="offer">
            Refund offer
          </label>
          <input id="offer" inputMode="decimal" value={offerText} onChange={(e) => setOfferText(e.target.value)} />
          <span className="small muted">
            {s.currency} of {money(s.amountMinor, s.currency)} · you keep {offerValid ? money(s.amountMinor - offerMinor, s.currency) : "—"}
          </span>
        </div>
      )}
      <div className="composer-foot">
        <span className="endpoint">POST /v1/customer/disputes/{s.id}/{endpoint}</span>
        <button className="btn verdict big" disabled={busy || !offerValid || !note.trim()} onClick={submit}>
          {action === "fight" ? "Approve & submit evidence" : action === "offer" ? `Approve & send ${offerValid ? money(offerMinor, s.currency) : ""} offer` : "Approve full refund"}
        </button>
      </div>
    </div>
  );
}

function SandboxMoves({ d, run, busy }: { d: Detail; run: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const s = d.summary;
  const move = (m: string) => run(() => api(`/api/disputes/${s.id}/sandbox`, { move: m }));
  return (
    <div className="sandbox-moves">
      <span className="small" style={{ flex: "1 1 220px" }}>
        <b>Sandbox only.</b> {s.stage === "offered" ? "Play the buyer’s response to your offer." : "Play PayPal’s decision on the evidence."}
      </span>
      {s.stage === "submitted" ? (
        <>
          <button className="btn" disabled={busy} onClick={() => move("adjudicate-seller")}>
            PayPal rules for seller
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => move("adjudicate-buyer")}>
            …for buyer
          </button>
        </>
      ) : (
        <button className="btn" disabled={busy} onClick={() => move("buyer-accept-offer")}>
          Buyer accepts offer
        </button>
      )}
    </div>
  );
}

function Resolved({ d }: { d: Detail }) {
  const s = d.summary;
  const good = s.stage === "won";
  const mid = s.stage === "settled";
  return (
    <div className={`resolved ${good ? "good" : mid ? "mid" : "bad"}`}>
      <div>
        <div className="big">
          {good ? `Won · ${money(s.amountMinor, s.currency)} released` : mid ? `Settled · ${money(s.recoveredMinor, s.currency)} kept` : s.stage === "refunded" ? "Refunded in full" : "Closed for the buyer"}
        </div>
        <p>
          {good
            ? "PayPal ruled in your favour. The hold on the money is lifted."
            : mid
              ? "The buyer accepted your partial refund and keeps the item. No return, no lost case."
              : "The buyer was refunded. Rebuttal closed it quickly so it doesn’t drag on."}
          {" "}PayPal outcome: <span className="mono">{s.outcome}</span>
        </p>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  carrier_document: "Carrier proof",
  listing: "Listing text",
  listing_photo: "Listing photo",
  item_photo: "Photo before shipping",
  buyer_photo: "Buyer’s photo",
  buyer_message: "Messages",
  return_policy: "Return policy",
};

function EvidenceFiles({
  d,
  run,
  busy,
  onZoom,
}: {
  d: Detail;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  onZoom: (src: string) => void;
}) {
  const [kind, setKind] = useState("carrier_document");
  async function upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    await run(async () => {
      const r = await fetch(`/api/disputes/${d.summary.id}/evidence`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
    });
  }
  return (
    <div className="card">
      <div className="card-h">
        <h3>Your evidence on file</h3>
        <span className="muted small">{d.evidence.length} items</span>
      </div>
      <ul className="checks">
        {d.evidence.map((e) => (
          <li key={e.id}>
            <span className="mark present">{e.file ? (e.mime === "application/pdf" ? "▤" : "▣") : "≡"}</span>
            <div>
              <div className="c-label">{e.title}</div>
              <div className="c-why">
                {KIND_LABEL[e.kind] ?? e.kind}
                {e.text ? ` · ${e.text.slice(0, 90)}${e.text.length > 90 ? "…" : ""}` : ""}
              </div>
            </div>
            {e.file && e.mime !== "application/pdf" ? (
              <button className="btn ghost" style={{ padding: "2px 6px", fontSize: 12 }} onClick={() => onZoom(e.file!)}>
                View
              </button>
            ) : e.file ? (
              <a className="btn ghost" style={{ padding: "2px 6px", fontSize: 12 }} href={e.file} target="_blank" rel="noreferrer">
                Open
              </a>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
      <div className="offerin" style={{ marginTop: 10, flexWrap: "wrap" }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="btn" aria-label="Evidence type">
          <option value="carrier_document">Carrier screenshot or PDF</option>
          <option value="item_photo">Photo of the item before shipping</option>
        </select>
        <label className="btn" style={{ opacity: busy ? 0.55 : 1 }}>
          Add file…
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            hidden
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </label>
        <span className="muted small">Then re-run the analysis. Gemini reads new files live.</span>
      </div>
    </div>
  );
}
