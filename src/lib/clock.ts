import { db, getMeta, setMeta } from "./db";
import { DEMO_START } from "./scenario";

/** The demo clock: a stored instant that only moves when the presenter jumps it forward. */
export function now(): string {
  db();
  return getMeta("clock") ?? DEMO_START;
}

export function advance(ms: number): string {
  const next = new Date(Date.parse(now()) + ms).toISOString();
  setMeta("clock", next);
  return next;
}
