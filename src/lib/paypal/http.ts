import { env } from "../env";

/** One recorded PayPal API exchange. Shown in the UI's call log and saved as fixtures by scripts. */
export type PayPalCall = {
  at: string;
  method: string;
  path: string;
  status: number;
  /** "live" = really sent to the PayPal sandbox; "simulated" = replayed from the mock/fixtures. */
  mode: "live" | "simulated";
  /** Which party the call is made as. Sandbox-only buyer/PayPal calls are labelled so on screen. */
  actor: "seller" | "buyer" | "paypal";
  label: string;
  request?: unknown;
  response: unknown;
  debugId?: string;
};

type Listener = (call: PayPalCall) => void;
const listeners = new Set<Listener>();
export function onPayPalCall(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emitCall(call: PayPalCall) {
  for (const l of listeners) l(call);
}

export class PayPalApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    public path: string,
  ) {
    // PayPal uses two error shapes: REST ({name, details[].issue}) and OAuth ({error, error_description}).
    const b = body as { name?: string; message?: string; details?: { issue?: string }[]; error?: string; error_description?: string } | null;
    const issue = b?.details?.map((d) => d.issue).filter(Boolean).join(", ");
    const what = b?.name ? `${b.name} ${issue || b.message || ""}` : b?.error ? `${b.error}: ${b.error_description ?? ""}` : "";
    super(`PayPal ${status} on ${path}: ${what}`.trim());
  }
  get issue(): string | undefined {
    const b = this.body as { details?: { issue?: string }[]; error?: string; error_description?: string } | null;
    return b?.details?.[0]?.issue ?? (b?.error ? `${b.error}: ${b.error_description ?? ""}`.trim() : undefined);
  }
}

let token: { value: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const res = await fetch(`${env.paypalBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${env.paypalClientId}:${env.paypalClientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { access_token: string; expires_in: number };
  if (!res.ok) throw new PayPalApiError(res.status, body, "/v1/oauth2/token");
  token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

/**
 * The sandbox "buyer" identity. PayPal's docs build an unsigned JWT (alg "none") whose
 * payload names the REST app (iss) and the sandbox personal account (email).
 * See developer.paypal.com/disputes/set-up#generate-jwt-for-paypal-auth-assertion
 */
export function buyerAuthAssertion(clientId = env.paypalClientId, email = env.paypalBuyerEmail): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ iss: clientId, email })}.`;
}

export type JsonPart = { kind: "json"; name: string; value: unknown };
export type FilePart = { kind: "file"; name: string; filename: string; contentType: string; data: Uint8Array };

export async function paypalRequest<T>(opts: {
  method: "GET" | "POST" | "PATCH";
  path: string;
  json?: unknown;
  multipart?: (JsonPart | FilePart)[];
  actor?: PayPalCall["actor"];
  label: string;
  assertion?: string;
  /** Idempotency key; PayPal requires one when an order carries a payment_source. */
  requestId?: string;
}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await getAccessToken()}` };
  if (opts.assertion) headers["PayPal-Auth-Assertion"] = opts.assertion;
  if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
  let body: BodyInit | undefined;
  if (opts.multipart) {
    const fd = new FormData();
    for (const p of opts.multipart) {
      if (p.kind === "json") fd.append(p.name, new Blob([JSON.stringify(p.value)], { type: "application/json" }));
      else fd.append(p.name, new Blob([Buffer.from(p.data)], { type: p.contentType }), p.filename);
    }
    body = fd;
  } else if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  const res = await fetch(`${env.paypalBase}${opts.path}`, {
    method: opts.method,
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  const request = opts.multipart
    ? opts.multipart.map((p) => (p.kind === "json" ? { part: p.name, json: p.value } : { part: p.name, file: p.filename }))
    : opts.json;
  emitCall({
    at: new Date().toISOString(),
    method: opts.method,
    path: opts.path,
    status: res.status,
    mode: "live",
    actor: opts.actor ?? "seller",
    label: opts.label,
    request,
    response: parsed,
    debugId: res.headers.get("paypal-debug-id") ?? undefined,
  });
  if (!res.ok) throw new PayPalApiError(res.status, parsed, opts.path);
  return { status: res.status, body: parsed as T };
}

/** Quick reachability + credential check, cached for the process lifetime. */
let reachable: Promise<boolean> | null = null;
/** Why the last check failed, in plain words, for the status chip. */
export let paypalProbeError: string | null = null;
export function paypalReachable(): Promise<boolean> {
  if (!env.paypalClientId || !env.paypalClientSecret) return Promise.resolve(false);
  reachable ??= getAccessToken()
    .then(() => {
      paypalProbeError = null;
      return true;
    })
    .catch((e) => {
      paypalProbeError =
        e instanceof PayPalApiError && e.status === 401
          ? "PayPal rejected the client ID / secret (invalid_client)"
          : "PayPal sandbox unreachable";
      reachable = null; // allow a retry on the next request
      return false;
    });
  return reachable;
}
