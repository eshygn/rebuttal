/** Executes one beat of the scripted demo story. The beats themselves are computed in views.ts. */
import { getAnalysis } from "./ai/agent";
import { db } from "./db";
import { approve, buyerAcceptsOffer, jumpClock, openScenarioDispute, paypalDecides, startAnalysis } from "./service";

const idOf = (scenario: string) => (db().prepare("SELECT id FROM disputes WHERE scenario = ?").get(scenario) as { id: string } | undefined)?.id;

export async function runBeat(step: string): Promise<{ disputeId?: string; note?: string }> {
  switch (step) {
    case "open-inr":
      return { disputeId: (await openScenarioDispute("inr-mugs")).id };
    case "open-snad":
      jumpClock(2);
      return { disputeId: (await openScenarioDispute("snad-bowl")).id };
    case "analyse-inr":
    case "analyse-snad": {
      const id = idOf(step === "analyse-inr" ? "inr-mugs" : "snad-bowl")!;
      startAnalysis(id);
      return { disputeId: id };
    }
    case "approve-inr":
    case "approve-snad": {
      const id = idOf(step === "approve-inr" ? "inr-mugs" : "snad-bowl")!;
      const rec = getAnalysis(id)?.result?.recommendation;
      if (!rec) throw new Error("Analyse first");
      const r = await approve(id, { action: rec.action });
      return { disputeId: id, note: r.note };
    }
    case "decide-inr": {
      const id = idOf("inr-mugs")!;
      jumpClock(72);
      const r = await paypalDecides(id, "SELLER_FAVOR");
      return { disputeId: id, note: r.note };
    }
    case "buyer-accepts": {
      const id = idOf("snad-bowl")!;
      jumpClock(24);
      const r = await buyerAcceptsOffer(id);
      return { disputeId: id, note: r.note };
    }
    default:
      throw new Error(`Unknown step ${step}`);
  }
}
