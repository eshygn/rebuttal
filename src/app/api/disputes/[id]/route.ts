import { fail, handle } from "@/lib/http";
import { disputeView } from "@/lib/views";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const v = await disputeView(id);
  return v ? handle(() => v) : fail("Not found", 404);
}
