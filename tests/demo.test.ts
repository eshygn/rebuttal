import { describe, expect, it } from "vitest";

/** The whole scripted story, in mock mode, against an in-memory database. */
describe("demo story (mock mode)", () => {
  it("runs end to end: fight and win, then offer and settle", async () => {
    const { resetDemo } = await import("@/lib/db");
    const { runBeat } = await import("@/lib/director");
    const { stateView } = await import("@/lib/views");
    const { getAnalysis } = await import("@/lib/ai/agent");
    resetDemo();

    const waitAnalysis = async (id: string) => {
      for (let i = 0; i < 200; i++) {
        const a = getAnalysis(id);
        if (a?.status === "done") return a;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("analysis did not finish");
    };

    let s = await stateView();
    expect(s.director.step).toBe("open-inr");
    const { disputeId: inr } = await runBeat("open-inr");
    await runBeat("analyse-inr");
    const a1 = await waitAnalysis(inr!);
    expect(a1.aiMode).toBe("recorded");
    expect(a1.result?.recommendation.action).toBe("fight");
    expect(a1.result?.coverage.strength).toBe("strong");
    await runBeat("approve-inr");
    await runBeat("decide-inr");
    s = await stateView();
    expect(s.disputes.find((d) => d.id === inr)?.stage).toBe("won");

    const { disputeId: snad } = await runBeat("open-snad");
    await runBeat("analyse-snad");
    const a2 = await waitAnalysis(snad!);
    expect(a2.result?.recommendation.action).toBe("offer");
    expect(Number.isInteger(a2.result?.offerMinor)).toBe(true);
    await runBeat("approve-snad");
    await runBeat("buyer-accepts");
    s = await stateView();
    const settled = s.disputes.find((d) => d.id === snad)!;
    expect(settled.stage).toBe("settled");
    expect(settled.recoveredMinor).toBe(6500 - a2.result!.offerMinor!);
    expect(s.stats.keptMinor).toBe(8400 + settled.recoveredMinor);
    expect(s.director.step).toBe("done");
  });
});
