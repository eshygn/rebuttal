import { handle } from "@/lib/http";
import { startAnalysis } from "@/lib/service";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(() => {
    startAnalysis(id);
    return { started: true };
  });
}
