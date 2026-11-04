import { z } from "zod";
import { handle } from "@/lib/http";
import { addShopTracking } from "@/lib/shop";

export async function POST(req: Request) {
  return handle(async () => addShopTracking(z.object({ id: z.string() }).parse(await req.json()).id));
}
