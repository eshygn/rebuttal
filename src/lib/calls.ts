import { AsyncLocalStorage } from "node:async_hooks";
import { now } from "./clock";
import { db } from "./db";
import { onPayPalCall, type PayPalCall } from "./paypal/http";

const ctx = new AsyncLocalStorage<{ disputeId?: string }>();

/** Attribute every PayPal call made inside fn to a dispute, for the per-dispute call log. */
export function withDispute<T>(disputeId: string | undefined, fn: () => Promise<T>): Promise<T> {
  return ctx.run({ disputeId }, fn);
}

export function recordCall(call: PayPalCall & { note?: string }) {
  db()
    .prepare(
      `INSERT INTO calls (dispute_id, at, method, path, status, mode, actor, label, request, response, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ctx.getStore()?.disputeId ?? null,
      now(),
      call.method,
      call.path,
      call.status,
      call.mode,
      call.actor,
      call.label,
      call.request === undefined ? null : JSON.stringify(call.request),
      JSON.stringify(call.response ?? null),
      call.note ?? (call.debugId ? `debug_id ${call.debugId}` : null),
    );
}

const g = globalThis as unknown as { __rebuttalCallHook?: boolean };
if (!g.__rebuttalCallHook) {
  g.__rebuttalCallHook = true;
  onPayPalCall((c) => recordCall(c));
}

export type CallRow = {
  id: number;
  dispute_id: string | null;
  at: string;
  method: string;
  path: string;
  status: number;
  mode: "live" | "simulated";
  actor: "seller" | "buyer" | "paypal";
  label: string;
  request: string | null;
  response: string | null;
  note: string | null;
};

export function listCalls(disputeId?: string, limit = 200): CallRow[] {
  return (
    disputeId
      ? db().prepare("SELECT * FROM calls WHERE dispute_id = ? ORDER BY id DESC LIMIT ?").all(disputeId, limit)
      : db().prepare("SELECT * FROM calls ORDER BY id DESC LIMIT ?").all(limit)
  ) as CallRow[];
}
