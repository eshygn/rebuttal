/**
 * Runs one "item not received" dispute through its whole sandbox lifecycle:
 *
 *   1. buyer opens the dispute          POST /v1/customer/disputes            (sandbox-only, PayPal-Auth-Assertion)
 *   2. seller reads it                  GET  /v1/customer/disputes/{id}
 *   3. seller provides evidence         POST /v1/customer/disputes/{id}/provide-evidence
 *   4. dispute moves to UNDER_REVIEW    GET  (+ escalate if the sandbox keeps it in the inquiry stage)
 *   5. PayPal adjudicates for seller    POST /v1/customer/disputes/{id}/adjudicate   (sandbox-only)
 *   6. confirm the final status         GET  /v1/customer/disputes/{id}
 *
 * Usage:
 *   npx tsx scripts/sandbox-lifecycle.ts <BUYER_TRANSACTION_ID> [--amount 84.00] [--currency USD]
 *   npx tsx scripts/sandbox-lifecycle.ts --replay        # no network, replays recorded fixtures
 *
 * Every real response is written to fixtures/paypal/lifecycle/ and listed in manifest.json.
 * A step the sandbox will not reach is replayed from the fixture and printed as SIMULATED.
 */
import fs from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile?.(".env");
} catch {
  /* no .env file: fine, use the process environment */
}

const FIXTURE_DIR = path.join(process.cwd(), "fixtures/paypal/lifecycle");
const EVIDENCE_IMAGE = path.join(process.cwd(), "public/evidence/carrier-tracking-NL4471029385US.png");

type StepResult = { n: number; name: string; mode: "LIVE" | "SIMULATED"; status: number; detail: string };
type Manifest = { transaction_id: string; dispute_id?: string; recorded_at?: string; steps: ManifestStep[]; attempts?: Attempt[] };
type Attempt = { at: string; transaction_id: string; live_steps: number; refused_at?: string; issue?: string; debug_id?: string; diagnosis: string[]; files: string[] };
type ManifestStep = { file: string; status: number; source: string; note?: string; recorded_at?: string };

const args = process.argv.slice(2);
const replayOnly = args.includes("--replay") || args.filter((a) => !a.startsWith("--")).length === 0;
const txnId = args.find((a) => !a.startsWith("--") && !/^\d+(\.\d+)?$/.test(a) && a.length > 8);
let amount = flag("--amount");
let currency = flag("--currency");
const RECORDED_DIR = path.join(process.cwd(), "fixtures/paypal/recorded");

function flag(name: string) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const manifestPath = path.join(FIXTURE_DIR, "manifest.json");
const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const results: StepResult[] = [];

function readFixture<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as T;
}

let redact: <T>(v: T) => T = (v) => v;
const attempt: Attempt = { at: new Date().toISOString(), transaction_id: "", live_steps: 0, diagnosis: [], files: [] };

/** A real response that is not part of the happy path (a refusal, a lookup) goes to fixtures/paypal/recorded. */
function recordAside(name: string, body: unknown) {
  fs.mkdirSync(RECORDED_DIR, { recursive: true });
  const file = `${txnId}-${name}.json`;
  fs.writeFileSync(path.join(RECORDED_DIR, file), JSON.stringify(redact(body), null, 2) + "\n");
  attempt.files.push(`fixtures/paypal/recorded/${file}`);
}

function record(file: string, status: number, body: unknown) {
  attempt.live_steps++;
  fs.writeFileSync(path.join(FIXTURE_DIR, file), JSON.stringify(redact(body), null, 2) + "\n");
  const entry: ManifestStep = { file, status, source: "sandbox", recorded_at: new Date().toISOString() };
  const i = manifest.steps.findIndex((s) => s.file === file);
  if (i >= 0) manifest.steps[i] = entry;
  else manifest.steps.push(entry);
}

function print(r: StepResult) {
  results.push(r);
  const tag = r.mode === "LIVE" ? "\x1b[32mLIVE     \x1b[0m" : "\x1b[33mSIMULATED\x1b[0m";
  console.log(`${String(r.n).padStart(2)}. ${tag} ${String(r.status).padEnd(4)} ${r.name.padEnd(34)} ${r.detail}`);
}

async function main() {
  console.log(`\nRebuttal · sandbox dispute lifecycle ${replayOnly ? "(replay from fixtures)" : `for transaction ${txnId}`}\n`);

  const pp = replayOnly ? null : await import("../src/lib/paypal/disputes");
  const { disputeIdFromLinks, hasLink } = await import("../src/lib/paypal/types");
  type D = import("../src/lib/paypal/types").PPDispute;
  let live = !replayOnly;

  /** Run a step live if we still can; otherwise (or on failure) replay its fixture. */
  async function step<T>(
    n: number,
    name: string,
    file: string,
    fn: (() => Promise<{ status: number; body: T }>) | null,
    describe: (b: T) => string,
  ): Promise<T> {
    if (live && fn) {
      try {
        const { status, body } = await fn();
        record(file, status, body);
        print({ n, name, mode: "LIVE", status, detail: describe(body) });
        return body;
      } catch (e) {
        const err = e as { status?: number; body?: { debug_id?: string; details?: { issue?: string }[] }; message: string };
        if (err.body) recordAside(file.replace(/^\d+[a-z]?-/, "").replace(".json", ".error"), err.body);
        attempt.refused_at = name;
        attempt.issue = err.body?.details?.[0]?.issue ?? String(err.status);
        attempt.debug_id = err.body?.debug_id;
        console.log(`    ↳ sandbox refused: ${err.message}`);
        console.log(`    ↳ replaying this and the remaining steps from fixtures`);
        live = false;
      }
    }
    if (!fs.existsSync(path.join(FIXTURE_DIR, file))) {
      print({ n, name, mode: "SIMULATED", status: 0, detail: "skipped (only needed on the live path)" });
      return undefined as T;
    }
    const body = readFixture<T>(file);
    const st = manifest.steps.find((s) => s.file === file)?.status ?? 200;
    print({ n, name, mode: "SIMULATED", status: st, detail: describe(body) });
    return body;
  }

  const showDetail = (d: D) =>
    `${d.status} · ${d.dispute_life_cycle_stage ?? "?"} · links: ${d.links.map((l) => l.rel).filter((r) => r !== "self").join(", ") || "none"}`;

  // 0. Preflight: can this seller see the payment, and is it disputable by the configured buyer?
  if (pp && txnId) {
    const pf = await import("../src/lib/paypal/preflight");
    redact = pf.redact;
    attempt.transaction_id = txnId;
    const check = await pf.preflight(txnId);
    if (check.capture) recordAside("capture-lookup", check.capture);
    if (check.capture) {
      const c = check.capture;
      console.log(`    payment: ${c.amount.value} ${c.amount.currency_code} · ${c.status}${c.status_details?.reason ? ` (${c.status_details.reason})` : ""} · payee ${pf.redact(c.payee?.email_address ?? "?")}`);
    }
    for (const p of check.problems) console.log(`    ⚠ ${p}`);
    attempt.diagnosis = check.problems;
    // Dispute the full payment in its own currency unless told otherwise.
    amount ??= check.amount?.value;
    currency ??= check.amount?.currency_code;
    console.log("");
  }
  amount ??= "84.00";
  currency ??= "USD";

  // 1. Buyer opens an "item not received" dispute.
  const created = await step(
    1,
    "Buyer opens INR dispute",
    "01-create-dispute.json",
    pp && txnId
      ? () =>
          pp.createDisputeAsBuyer({
            buyer_transaction_id: txnId,
            reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
            amount: { currency_code: currency!, value: amount! },
          })
      : null,
    (b) => `dispute ${disputeIdFromLinks(b) ?? "?"}`,
  );
  const disputeId = disputeIdFromLinks(created);
  if (!disputeId) throw new Error("No dispute id in create response");

  // 2. Seller reads it. Newly created sandbox disputes can take a few seconds to appear.
  const show = (id: string) => async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await pp!.showDispute(id);
      } catch (e) {
        if ((e as { status?: number }).status === 404 && attempt < 8) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        throw e;
      }
    }
  };
  let d = await step(2, "Seller reads dispute", "02-show-dispute.json", pp ? show(disputeId) : null, showDetail);

  // In the inquiry stage some sandbox disputes only offer provide-evidence after escalation.
  if (live && pp && !hasLink(d, "provide_evidence") && hasLink(d, "escalate")) {
    await step(2.5, "Seller escalates to claim", "02b-escalate.json", () => pp.escalate(disputeId!, "Escalating so evidence can be reviewed."), () => "escalated");
    d = (await step(2.6, "Seller re-reads dispute", "02c-show-after-escalate.json", show(disputeId), showDetail)) ?? d;
  }

  // 3. Seller provides proof of fulfilment: the tracking record plus the carrier screenshot.
  const files = fs.existsSync(EVIDENCE_IMAGE)
    ? [{ filename: path.basename(EVIDENCE_IMAGE), contentType: "image/png", data: fs.readFileSync(EVIDENCE_IMAGE) }]
    : [];
  await step(
    3,
    "Seller provides evidence",
    "03-provide-evidence.json",
    pp
      ? () =>
          pp.provideEvidence(
            disputeId!,
            [
              {
                evidence_type: "PROOF_OF_FULFILLMENT",
                evidence_info: {
                  tracking_info: [{ carrier_name: "OTHER", carrier_name_other: "Northline Post", tracking_number: "NL4471029385US" }],
                },
                notes:
                  "Delivered 28 Oct 2026 14:12 to the address on the PayPal transaction. Claim opened 30 Oct 2026, two days after delivery. Carrier scan attached.",
              },
            ],
            files,
          )
      : null,
    () => `${files.length} document(s) attached`,
  );

  // 4. Confirm the dispute is now with PayPal for review.
  d = await step(4, "Dispute moves to review", "04-show-after-evidence.json", pp ? show(disputeId) : null, showDetail);
  if (live && pp && d.status !== "UNDER_REVIEW" && hasLink(d, "escalate")) {
    await step(4.5, "Seller escalates to claim", "04b-escalate.json", () => pp.escalate(disputeId!, "Evidence provided; requesting review."), () => "escalated");
    d = (await step(4.6, "Seller re-reads dispute", "04c-show-after-escalate.json", show(disputeId), showDetail)) ?? d;
  }
  if (live && !hasLink(d, "adjudicate")) {
    console.log("    ↳ no adjudicate link on the dispute; the sandbox will not settle it from here");
    live = false;
  }

  // 5. PayPal (sandbox) rules in the seller's favour.
  await step(5, "PayPal adjudicates: SELLER_FAVOR", "05-adjudicate.json", pp ? () => pp.adjudicate(disputeId!, "SELLER_FAVOR") : null, () => "adjudicated");

  // 6. Final status.
  d = await step(6, "Confirm final status", "06-show-resolved.json", pp ? show(disputeId) : null, (b) => `${b.status} · ${b.dispute_outcome?.outcome_code ?? "no outcome yet"}`);

  if (!replayOnly) {
    // Only a run whose create step was live describes the fixtures; every run is logged as an attempt.
    if (results[0]?.mode === "LIVE") {
      manifest.transaction_id = txnId!;
      manifest.dispute_id = disputeId;
      manifest.recorded_at = new Date().toISOString();
    }
    manifest.attempts = [...(manifest.attempts ?? []), attempt];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }

  const liveCount = results.filter((r) => r.mode === "LIVE").length;
  console.log(`\n${liveCount}/${results.length} steps live · final: ${d.status} ${d.dispute_outcome?.outcome_code ?? ""}\n`);
  const ok = d.status === "RESOLVED" && d.dispute_outcome?.outcome_code === "RESOLVED_SELLER_FAVOUR";
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
