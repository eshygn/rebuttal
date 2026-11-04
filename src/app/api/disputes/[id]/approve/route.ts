import { z } from "zod";
import { handle } from "@/lib/http";
import { approve } from "@/lib/service";

const Body = z.object({
  action: z.enum(["fight", "offer", "accept"]),
  note: z.string().max(2000).optional(),
  offerMinor: z.number().int().positive().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => {
    const body = Body.parse(await req.json());
    const r = await approve(id, body);
    return { mode: r.mode, note: r.note, status: r.dispute.status };
  });
}
