import { z } from "zod";
import { handle } from "@/lib/http";
import { buyerAcceptsOffer, paypalDecides, syncDispute } from "@/lib/service";

const Body = z.object({ move: z.enum(["adjudicate-seller", "adjudicate-buyer", "buyer-accept-offer", "sync"]) });

/** Sandbox-only moves that play PayPal or the buyer. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => {
    const { move } = Body.parse(await req.json());
    const r =
      move === "adjudicate-seller"
        ? await paypalDecides(id, "SELLER_FAVOR")
        : move === "adjudicate-buyer"
          ? await paypalDecides(id, "BUYER_FAVOR")
          : move === "buyer-accept-offer"
            ? await buyerAcceptsOffer(id)
            : await syncDispute(id);
    return { mode: r.mode, status: r.dispute.status };
  });
}
