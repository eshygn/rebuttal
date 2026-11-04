/**
 * Gemini access for Rebuttal: model selection with an overload fallback chain,
 * a process-wide rate limiter for the free tier, and a SQLite response cache.
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { APICallError, RetryError } from "ai";
import crypto from "node:crypto";
import { db } from "../db";
import { aiModelChain, env, hasAIKey } from "../env";

export class RateLimitedError extends Error {
  constructor(message = "Gemini free-tier rate limit reached") {
    super(message);
  }
}

function statusOf(e: unknown): number | undefined {
  if (APICallError.isInstance(e)) return e.statusCode;
  if (RetryError.isInstance(e)) return statusOf(e.lastError);
  return undefined;
}

export const isRateLimit = (e: unknown) => statusOf(e) === 429 || /quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(String((e as Error)?.message));
const isOverloaded = (e: unknown) => [500, 503, 504].includes(statusOf(e) ?? 0) || /overloaded|high demand|UNAVAILABLE/i.test(String((e as Error)?.message));

// ---- Rate limiting: free tier is roughly 10 requests/minute on Flash models ------------

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = Number(process.env.AI_MAX_RPM || 10);
const stamps: number[] = [];
let chain: Promise<void> = Promise.resolve();

/** Wait for a slot. Throws RateLimitedError rather than queue for more than 20 seconds. */
export function acquireSlot(): Promise<void> {
  const next = chain.then(async () => {
    const t = Date.now();
    while (stamps.length && t - stamps[0] > WINDOW_MS) stamps.shift();
    if (stamps.length >= MAX_PER_WINDOW) {
      const wait = WINDOW_MS - (t - stamps[0]);
      if (wait > 20_000) throw new RateLimitedError("Local rate limiter: free-tier budget for this minute is spent");
      await new Promise((r) => setTimeout(r, wait));
    }
    stamps.push(Date.now());
  });
  chain = next.catch(() => undefined);
  return next;
}

// ---- Model with overload fallback --------------------------------------------------

export type ModelHandle = { model: LanguageModelV4; served: () => string };

/**
 * A LanguageModel that tries each model in the Flash chain, moving down (and staying
 * down for the rest of the run) when one answers 5xx "overloaded". Every request
 * takes a rate-limit slot first.
 */
/** Models that answered 429 recently. The free-tier quota is daily, so skip them for an hour. */
const exhausted = new Map<string, number>();
const EXHAUSTED_MS = 60 * 60_000;
const available = (id: string) => (exhausted.get(id) ?? 0) < Date.now();

export function chainModel(): ModelHandle {
  const google = createGoogleGenerativeAI({ apiKey: env.googleKey });
  const all = aiModelChain();
  const ids = all.filter(available).length ? all.filter(available) : all;
  const models = ids.map((id) => google(id) as unknown as LanguageModelV4);
  let idx = 0;
  const model: LanguageModelV4 = {
    specificationVersion: "v4",
    provider: "google",
    get modelId() {
      return ids[idx];
    },
    supportedUrls: models[0].supportedUrls,
    async doGenerate(options) {
      for (;;) {
        await acquireSlot();
        try {
          return await models[idx].doGenerate(options);
        } catch (e) {
          // Free-tier quotas are per model, so a 429 on one model is a reason to try the next.
          if (isRateLimit(e)) exhausted.set(ids[idx], Date.now() + EXHAUSTED_MS);
          if ((isOverloaded(e) || isRateLimit(e)) && idx < models.length - 1) {
            idx++;
            continue;
          }
          if (isRateLimit(e)) throw new RateLimitedError();
          throw e;
        }
      }
    },
    async doStream(options) {
      await acquireSlot();
      return models[idx].doStream(options);
    },
  };
  return { model, served: () => ids[idx] };
}

export const aiLive = () => hasAIKey();

// ---- Cache --------------------------------------------------------------------------

export function cacheKey(...parts: unknown[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function cacheGet<T>(key: string): T | undefined {
  const row = db().prepare("SELECT value FROM ai_cache WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function cacheSet(key: string, value: unknown) {
  db()
    .prepare("INSERT OR REPLACE INTO ai_cache (key, value, created_at) VALUES (?, ?, ?)")
    .run(key, JSON.stringify(value), new Date().toISOString());
}
