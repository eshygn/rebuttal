/**
 * The PayPal adapter. Each dispute action has a live implementation (the real sandbox)
 * and a simulated one (sim.ts, documented response shapes). A dispute that exists in the
 * sandbox goes live while PayPal answers; anything the sandbox refuses or cannot reach is
 * replayed by the simulator and labelled "simulated" in the call log.
 */
import { recordCall } from "../calls";
import { now } from "../clock";
import { env, hasPayPalKeys } from "../env";
import * as live from "./disputes";
import { PayPalApiError, paypalProbeError, paypalReachable } from "./http";
import { SimError, subsequentAction } from "./sim";
import type { PPDispute } from "./types";

export type Mode = "live" | "simulated";

export async function paypalLive(): Promise<boolean> {
  if (!hasPayPalKeys()) return false;
  return paypalReachable();
}

export type PayPalStatus = { mode: "live" | "mock"; detail: string; warning?: boolean };
export async function paypalStatus(): Promise<PayPalStatus> {
  if (env.forceMock) return { mode: "mock", detail: "REBUTTAL_MOCK=1" };
  if (!hasPayPalKeys()) return { mode: "mock", detail: "No PayPal sandbox keys" };
  if (!(await paypalReachable())) return { mode: "mock", detail: `${paypalProbeError ?? "PayPal sandbox unreachable"}: using the simulator`, warning: true };
  const warning = /@business\.example\.com$/i.test(env.paypalBuyerEmail)
    ? " · Warning: PAYPAL_SANDBOX_BUYER_EMAIL is a business account; buyer-side sandbox calls need the personal (buyer) account"
    : !env.paypalBuyerEmail
      ? " · No sandbox buyer email: buyer-side steps are simulated"
      : "";
  return { mode: "live", detail: `PayPal sandbox${warning}`, warning: !!warning };
}

type ActionSpec = {
  label: string;
  actor: "seller" | "buyer" | "paypal";
  method: "POST" | "GET";
  path: string;
  request?: unknown;
  /** Live call. Omit for steps that can never be live. */
  live?: () => Promise<unknown>;
  /** Pure transition used when the step is simulated. */
  sim: (d: PPDispute, at: string) => PPDispute;
};

export type ActionResult = { dispute: PPDispute; mode: Mode; note?: string };

/** Poll show-dispute until the predicate holds (sandbox updates are eventually consistent). */
async function refresh(id: string, until: (d: PPDispute) => boolean, tries = 6): Promise<PPDispute> {
  let last: PPDispute | null = null;
  for (let i = 0; i < tries; i++) {
    try {
      last = (await live.showDispute(id)).body;
      if (until(last)) return last;
    } catch (e) {
      if (!(e instanceof PayPalApiError && e.status === 404)) throw e;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!last) throw new Error(`Dispute ${id} not visible to the seller yet`);
  return last;
}

export async function runAction(
  current: PPDispute,
  source: "sandbox" | "simulated",
  spec: ActionSpec,
  settled: (d: PPDispute) => boolean = () => true,
): Promise<ActionResult> {
  let note: string | undefined;
  if (source === "sandbox" && spec.live && (await paypalLive())) {
    try {
      await spec.live();
      const d = await refresh(current.dispute_id, settled);
      return { dispute: d, mode: "live" };
    } catch (e) {
      note = `Sandbox refused (${e instanceof PayPalApiError ? (e.issue ?? e.status) : (e as Error).message}); replayed by the simulator`;
    }
  } else if (source === "sandbox") {
    note = "PayPal not reachable; replayed by the simulator";
  }
  const at = now();
  try {
    const next = spec.sim(current, at);
    recordCall({
      at,
      method: spec.method,
      path: spec.path,
      status: 200,
      mode: "simulated",
      actor: spec.actor,
      label: spec.label,
      request: spec.request,
      response: subsequentAction(current.dispute_id),
      note,
    });
    return { dispute: next, mode: "simulated", note };
  } catch (e) {
    if (e instanceof SimError) {
      recordCall({ at, method: spec.method, path: spec.path, status: e.status, mode: "simulated", actor: spec.actor, label: spec.label, request: spec.request, response: e.body, note });
    }
    throw e;
  }
}

/** Read a dispute as the seller. Live for sandbox disputes; the stored JSON otherwise. */
export async function readDispute(current: PPDispute, source: "sandbox" | "simulated"): Promise<{ dispute: PPDispute; mode: Mode }> {
  if (source === "sandbox" && (await paypalLive())) {
    try {
      return { dispute: (await live.showDispute(current.dispute_id)).body, mode: "live" };
    } catch {
      /* fall through */
    }
  }
  recordCall({
    at: now(),
    method: "GET",
    path: `/v1/customer/disputes/${current.dispute_id}`,
    status: 200,
    mode: "simulated",
    actor: "seller",
    label: "Show dispute details",
    response: current,
  });
  return { dispute: current, mode: "simulated" };
}
