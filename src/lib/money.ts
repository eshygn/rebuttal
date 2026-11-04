/**
 * Money is always held as integer minor units (cents) plus an ISO currency code.
 * PayPal sends and receives decimal strings ("84.00"); we convert at the edge and
 * never do arithmetic on floats.
 */
export type Money = { minor: number; currency: string };

const MINOR_DIGITS: Record<string, number> = { JPY: 0, HUF: 0, TWD: 0 };

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency.toUpperCase()] ?? 2;
}

/** Parse a PayPal decimal string ("84.5", "84.50", "1,084.50" is rejected) into minor units. */
export function parseMinor(value: string, currency: string): number {
  const digits = minorDigits(currency);
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`Invalid money value: ${JSON.stringify(value)}`);
  const [, sign, whole, frac = ""] = m;
  if (frac.length > digits) {
    // Refuse to silently round: PayPal never sends more precision than the currency allows.
    if (/[^0]/.test(frac.slice(digits))) throw new Error(`Too many decimals for ${currency}: ${value}`);
  }
  const fracPadded = (frac + "0".repeat(digits)).slice(0, digits);
  const minor = Number(whole) * 10 ** digits + (digits ? Number(fracPadded) : 0);
  if (!Number.isSafeInteger(minor)) throw new Error(`Money out of range: ${value}`);
  return sign ? -minor : minor;
}

/** Format minor units as the decimal string PayPal expects ("84.00"). */
export function toPayPalValue(minor: number, currency: string): string {
  assertInt(minor);
  const digits = minorDigits(currency);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  if (digits === 0) return `${neg ? "-" : ""}${abs}`;
  const base = 10 ** digits;
  const whole = Math.floor(abs / base);
  const frac = String(abs % base).padStart(digits, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export function fromPayPal(amount: { currency_code: string; value: string }): Money {
  return { minor: parseMinor(amount.value, amount.currency_code), currency: amount.currency_code };
}

export function toPayPal(m: Money): { currency_code: string; value: string } {
  return { currency_code: m.currency, value: toPayPalValue(m.minor, m.currency) };
}

/** Human display, always with the currency code: "$84.00 USD". */
export function formatMoney(m: Money): string {
  const symbol: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", CAD: "$", AUD: "$" };
  const s = symbol[m.currency] ?? "";
  const [whole, frac] = toPayPalValue(Math.abs(m.minor), m.currency).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+$)/g, ",");
  const v = frac === undefined ? grouped : `${grouped}.${frac}`;
  return `${m.minor < 0 ? "−" : ""}${s}${v} ${m.currency}`;
}

/**
 * A share of an amount in basis points (1% = 100 bp), rounded half-up to the
 * nearest minor unit. Integer-only maths.
 */
export function percentOf(minor: number, basisPoints: number): number {
  assertInt(minor);
  assertInt(basisPoints);
  const num = minor * basisPoints;
  const q = Math.floor(num / 10000);
  const r = num - q * 10000;
  return r * 2 >= 10000 ? q + 1 : q;
}

export function clampMinor(minor: number, lo: number, hi: number): number {
  assertInt(minor);
  return Math.min(hi, Math.max(lo, minor));
}

export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function sub(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  return { minor: a.minor - b.minor, currency: a.currency };
}

function assertInt(n: number) {
  if (!Number.isSafeInteger(n)) throw new Error(`Expected integer minor units, got ${n}`);
}
