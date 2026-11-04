import { now } from "./clock";
import { db } from "./db";

export type EventKind = "opened" | "analysis" | "submitted" | "offer" | "resolved" | "clock" | "tracking" | "order" | "note";

export function logEvent(disputeId: string | null, kind: EventKind, text: string) {
  db().prepare("INSERT INTO events (dispute_id, at, kind, text) VALUES (?, ?, ?, ?)").run(disputeId, now(), kind, text);
}

export type EventRow = { id: number; dispute_id: string | null; at: string; kind: EventKind; text: string };

export function listEvents(disputeId?: string): EventRow[] {
  return (
    disputeId
      ? db().prepare("SELECT * FROM events WHERE dispute_id = ? ORDER BY id").all(disputeId)
      : db().prepare("SELECT * FROM events ORDER BY id DESC LIMIT 100").all()
  ) as EventRow[];
}
