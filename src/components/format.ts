import { formatMoney } from "@/lib/money";
import { DEMO_TZ } from "@/lib/scenario";

export const money = (minor: number, currency: string) => formatMoney({ minor, currency });

export function fmtClock(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: DEMO_TZ });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: DEMO_TZ });
  return `${day} · ${time}`;
}

export function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: DEMO_TZ });
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: DEMO_TZ })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: DEMO_TZ })}`;
}

/** "6d 22h left" relative to the demo clock. */
export function countdown(dueIso: string, nowIso: string): { text: string; urgent: boolean; overdue: boolean } {
  const ms = Date.parse(dueIso) - Date.parse(nowIso);
  if (ms <= 0) return { text: "Deadline passed", urgent: true, overdue: true };
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  return { text: d > 0 ? `${d}d ${h % 24}h left` : `${h}h left`, urgent: h < 72, overdue: false };
}

export const ACTION_WORD = { fight: "Fight", offer: "Offer", accept: "Accept" } as const;

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}
