import { z } from "zod";
import { handle } from "@/lib/http";
import { runBeat } from "@/lib/director";

export async function POST(req: Request) {
  return handle(async () => {
    const { step } = z.object({ step: z.string() }).parse(await req.json());
    return runBeat(step);
  });
}
