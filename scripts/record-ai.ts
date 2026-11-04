/**
 * Runs the Gemini agent live on every scenario dispute and saves each run to
 * src/lib/ai/recorded/<scenario>.json. Those recordings are what Rebuttal replays when
 * there is no Gemini key or the free tier is rate-limited.
 *
 *   npx tsx scripts/record-ai.ts [scenario-key ...]
 */
import fs from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile?.(".env");
} catch {
  /* no .env */
}
process.env.REBUTTAL_DB_PATH = path.join(process.cwd(), "data", "record-ai.db");

async function main() {
  const { resetDemo, db } = await import("../src/lib/db");
  const { openScenarioDispute } = await import("../src/lib/service");
  const { analyse, getAnalysis } = await import("../src/lib/ai/agent");
  const { DISPUTES } = await import("../src/lib/scenario");
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required");
  resetDemo();
  db().exec("DELETE FROM ai_cache");
  const wanted = process.argv.slice(2);
  for (const s of DISPUTES.filter((d) => !wanted.length || wanted.includes(d.key))) {
    const { id } = s.preExisting ? { id: s.id } : await openScenarioDispute(s.key);
    await new Promise((r) => setTimeout(r, 30_000)); // stay inside the free tier's per-minute budget
    const t0 = Date.now();
    await analyse(id, { forceMode: "live" });
    const a = getAnalysis(id)!;
    console.log(`\n== ${s.key} (${id}) ${a.aiMode} ${a.model ?? ""} in ${((Date.now() - t0) / 1000).toFixed(1)}s ${a.note ?? ""}`);
    for (const t of a.trace) console.log(`  ${t.status === "done" ? "✓" : "✗"} ${t.tool.padEnd(24)} ${t.ms ?? 0}ms`);
    if (a.aiMode !== "live" || !a.result) {
      console.log("  not recorded: run was not live");
      continue;
    }
    const r = a.result;
    console.log(`  → ${r.recommendation.action} ${r.recommendation.confidence}% · ${r.recommendation.headline}`);
    console.log(`  coverage ${r.coverage.strength} ${r.coverage.score} · baseline ${r.baseline} · agrees ${r.agrees}`);
    const rec = {
      scenario: s.key,
      model: a.model,
      recorded_at: new Date().toISOString(),
      trace: a.trace,
      ai_facts: { carrierScan: r.facts.carrierScan ?? null, photoComparison: r.facts.photoComparison ?? null },
      recommendation: r.recommendation,
    };
    fs.writeFileSync(path.join(process.cwd(), "src/lib/ai/recorded", `${s.key}.json`), JSON.stringify(rec, null, 2) + "\n");
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
