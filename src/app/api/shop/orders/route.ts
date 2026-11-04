import { z } from "zod";
import { handle } from "@/lib/http";
import { createShopOrder, listShopOrders } from "@/lib/shop";

export async function GET() {
  return handle(() => listShopOrders());
}

/** Called by the PayPal JS SDK button's createOrder callback. */
export async function POST(req: Request) {
  return handle(async () => createShopOrder(z.object({ sku: z.string() }).parse(await req.json()).sku));
}
