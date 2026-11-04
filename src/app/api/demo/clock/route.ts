import { z } from "zod";
import { handle } from "@/lib/http";
import { jumpClock } from "@/lib/service";

export async function POST(req: Request) {
  return handle(async () => {
    const { hours } = z.object({ hours: z.number().int().min(1).max(24 * 30) }).parse(await req.json());
    return { clock: jumpClock(hours) };
  });
}
