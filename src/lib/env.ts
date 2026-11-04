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
 * Newest Gemini Flash models on the free tier (checked against the Gemini API model list on
 * 2026-11-04). The free tier allows roughly 20 requests per model per day, and each model has
 * its own quota, so we walk down this list when a model is overloaded (503) or out of quota (429).
 */
export const FLASH_FALLBACK_CHAIN = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
];

export function aiModelChain(): string[] {
  return env.aiModel ? [env.aiModel, ...FLASH_FALLBACK_CHAIN.filter((m) => m !== env.aiModel)] : FLASH_FALLBACK_CHAIN;
}
