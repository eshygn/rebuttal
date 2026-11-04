/**
 * Before asking the sandbox to open a dispute, look the transaction up from the seller's side
 * and say plainly why it can or cannot be disputed. PayPal's own answer to a bad transaction
 * is a bare TRANSACTION_NOT_ELIGIBLE, which hides the cause.
 */
import { env } from "../env";
import { PayPalApiError, paypalRequest } from "./http";
import type { PPMoney } from "./types";

export type CaptureLookup = {
  id: string;
  status: string;
  status_details?: { reason?: string };
  amount: PPMoney;
  payee?: { email_address?: string; merchant_id?: string };
  seller_protection?: { status: string };
  create_time?: string;
};

export type Preflight = {
  found: boolean;
  ok: boolean;
  /** Plain-English reasons the dispute will be refused. Empty when ok. */
  problems: string[];
  amount?: PPMoney;
  capture?: CaptureLookup;
};

const isPersonal = (email?: string) => !!email && /@personal\.example\.com$/i.test(email);
const isBusiness = (email?: string) => !!email && /@business\.example\.com$/i.test(email);

/** Pure: judge a capture lookup. Exported for tests. */
export function judge(capture: CaptureLookup | null, buyerEmail: string): Preflight {
  const problems: string[] = [];
  if (isBusiness(buyerEmail)) {
    problems.push(
      "PAYPAL_SANDBOX_BUYER_EMAIL is a business (seller) account. The sandbox buyer must be a personal account (…@personal.example.com).",
    );
  }
  if (!capture) {
    problems.push(
      "This seller cannot see the transaction. It was not paid to this app's merchant account, or the ID is the buyer-side ID of a payment to someone else.",
    );
    return { found: false, ok: false, problems };
  }
  if (capture.payee?.email_address && capture.payee.email_address.toLowerCase() === buyerEmail.toLowerCase()) {
    problems.push("The payment went TO the configured buyer. The buyer must be the one who paid.");
  } else if (isPersonal(capture.payee?.email_address)) {
    problems.push(
      "The payment was made to a personal account, not to this app's business account. The buyer must pay the seller (the business account that owns the REST app).",
    );
  }
  if (capture.status !== "COMPLETED") {
    problems.push(
      `The payment is ${capture.status}${capture.status_details?.reason ? ` (${capture.status_details.reason})` : ""}, not COMPLETED. Only completed payments can be disputed.`,
    );
  }
  return { found: true, ok: problems.length === 0, problems, amount: capture.amount, capture };
}

/** Look the transaction up. A buyer-side ID resolves to the seller's capture when this merchant was paid. */
export async function preflight(transactionId: string, buyerEmail = env.paypalBuyerEmail): Promise<Preflight> {
  try {
    const r = await paypalRequest<CaptureLookup>({
      method: "GET",
      path: `/v2/payments/captures/${encodeURIComponent(transactionId)}`,
      label: "Look up the disputed payment",
    });
    return judge(r.body, buyerEmail);
  } catch (e) {
    if (e instanceof PayPalApiError && (e.status === 404 || e.status === 403)) return judge(null, buyerEmail);
    throw e;
  }
}

/** Mask sandbox account emails and IDs before a response is committed as a fixture. */
export function redact<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value)
      .replace(/"(sb-[a-z0-9]{4})[a-z0-9]+@/gi, '"$1…@')
      .replace(/("merchant_id":\s*")([A-Z0-9]{4})[A-Z0-9]+"/g, '$1$2…"'),
  ) as T;
}
