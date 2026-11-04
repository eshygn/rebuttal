import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { seed } from "./seed";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,                -- shop order number, e.g. FC-1041
  paypal_order_id TEXT,
  capture_id TEXT,
  buyer_transaction_id TEXT,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  paid_at TEXT NOT NULL,
  source TEXT NOT NULL,               -- 'sandbox' | 'simulated'
  tracking TEXT,                      -- what the seller entered in PayPal tracking: {carrier, carrierOther, number, addedAt}
  raw TEXT NOT NULL                   -- Orders v2 GET response JSON
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- carrier_document | listing | listing_photo | item_photo | buyer_photo | buyer_message | return_policy
  title TEXT NOT NULL,
  file TEXT,                          -- public path for images / PDFs
  mime TEXT,
  text TEXT,
  added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,                -- PayPal dispute_id (real or simulated)
  scenario TEXT,                      -- seed key, e.g. 'inr-mugs'
  order_id TEXT NOT NULL,
  source TEXT NOT NULL,               -- 'sandbox' | 'simulated'
  buyer_claim TEXT,
  stage TEXT NOT NULL,                -- Rebuttal workflow stage (see workflow.ts)
  raw TEXT NOT NULL,                  -- PayPal dispute details JSON
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analyses (
  dispute_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,               -- running | done | failed
  ai_mode TEXT NOT NULL,              -- live | recorded
  model TEXT,
  note TEXT,
  trace TEXT NOT NULL,                -- JSON array of agent steps
  facts TEXT,                         -- JSON: extracted evidence facts
  result TEXT,                        -- JSON: final recommendation
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispute_id TEXT,
  at TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  mode TEXT NOT NULL,
  actor TEXT NOT NULL,
  label TEXT NOT NULL,
  request TEXT,
  response TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispute_id TEXT,
  at TEXT NOT NULL,                   -- demo-clock time
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL);
`;

const g = globalThis as unknown as { __rebuttalDb?: Database.Database };

export function db(): Database.Database {
  if (g.__rebuttalDb) return g.__rebuttalDb;
  const file = env.dbPath || path.join(process.cwd(), "data", "rebuttal.db");
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma("journal_mode = WAL");
  conn.exec(SCHEMA);
  const seeded = conn.prepare("SELECT value FROM meta WHERE key = 'seeded_at'").get();
  if (!seeded) seed(conn);
  g.__rebuttalDb = conn;
  return conn;
}

/** Wipe everything except the AI cache and re-seed the demo scenario. */
export function resetDemo() {
  const conn = db();
  conn.transaction(() => {
    for (const t of ["meta", "orders", "evidence", "disputes", "analyses", "calls", "events"]) conn.exec(`DELETE FROM ${t}`);
    seed(conn);
  })();
}

export function getMeta(key: string): string | undefined {
  return (db().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

export function setMeta(key: string, value: string) {
  db().prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
