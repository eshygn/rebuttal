/** Seller-uploaded evidence: stored under data/uploads and served from /uploads/<name>. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadCase } from "./casefile";
import { now } from "./clock";
import { db } from "./db";
import { logEvent } from "./events";

export const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };
const KINDS = new Set(["carrier_document", "item_photo", "buyer_photo", "listing_photo"]);
const MAX_BYTES = 8 * 1024 * 1024;

export async function addEvidence(disputeId: string, file: File, kind: string, title: string) {
  const c = loadCase(disputeId);
  if (!c) throw new Error("No such dispute");
  if (!KINDS.has(kind)) throw new Error("Unsupported evidence kind");
  const ext = TYPES[file.type];
  if (!ext) throw new Error("Upload a PNG, JPEG, WebP or PDF");
  if (file.size > MAX_BYTES) throw new Error("Files must be under 8 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  const id = `up-${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, `${id}.${ext}`), bytes);
  const label = title.trim() || (kind === "carrier_document" ? `Carrier proof (${file.name})` : `Photo (${file.name})`);
  db()
    .prepare("INSERT OR REPLACE INTO evidence (id, order_id, kind, title, file, mime, text, added_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)")
    .run(id, c.order.id, kind, label.slice(0, 120), `/uploads/${id}.${ext}`, file.type, now());
  logEvent(disputeId, "note", `Added evidence: ${label}`);
  return { id };
}
