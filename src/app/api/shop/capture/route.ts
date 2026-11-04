import { z } from "zod";
import { handle } from "@/lib/http";
import { captureShopOrder } from "@/lib/shop";

/** Called by the PayPal JS SDK button's onApprove callback. */
export async function POST(req: Request) {
  return handle(async () => {
    const { orderId, sku } = z.object({ orderId: z.string(), sku: z.string() }).parse(await req.json());
    return captureShopOrder(orderId, sku);
  });
}
