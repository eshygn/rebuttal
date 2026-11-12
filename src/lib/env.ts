/** Central place for configuration read from the environment. Secrets never leave the server. */
export const env = {
  paypalClientId: process.env.PAYPAL_CLIENT_ID?.trim() || "",
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET?.trim() || "",
  paypalBuyerEmail: process.env.PAYPAL_SANDBOX_BUYER_EMAIL?.trim() || "",
  paypalBase: process.env.PAYPAL_API_BASE?.trim() || "https://api-m.sandbox.paypal.com",
  googleKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || "",
  aiModel: process.env.AI_MODEL?.trim() || "",
  /** Force every adapter to its mock, whatever keys are present. */
  forceMock: process.env.REBUTTAL_MOCK === "1",
  /** Sandbox transaction IDs (buyer side) the demo disputes are opened against when PayPal is live. */
  inrTransactionId: process.env.SANDBOX_INR_TRANSACTION_ID?.trim() || "",
  snadTransactionId: process.env.SANDBOX_SNAD_TRANSACTION_ID?.trim() || "",
  dbPath: process.env.REBUTTAL_DB_PATH?.trim() || "",
};

export const hasPayPalKeys = () => !env.forceMock && !!env.paypalClientId && !!env.paypalClientSecret;
export const hasAIKey = () => !env.forceMock && !!env.googleKey;

/**
 * The model order, as the project owner specified: Gemini's newest Flash model first, then
 * gemini-2.5-flash, then (outside this list) recorded responses. "Newest Flash" was
 * gemini-3.8-flash in the Gemini API model list on 2026-11-12. AI_MODEL overrides the first
 * entry and AI_FALLBACK_MODEL the second; e.g. keys created after 2.5 was retired for new users
 * get a 404 from gemini-2.5-flash and can set AI_FALLBACK_MODEL to a model they can use.
 */
export const NEWEST_FLASH = "gemini-3.8-flash";
export const DEFAULT_FALLBACK_MODEL = "gemini-2.5-flash";

export function aiModelChain(): string[] {
  const first = env.aiModel || NEWEST_FLASH;
  const second = process.env.AI_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;
  return first === second ? [first] : [first, second];
}
