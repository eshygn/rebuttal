import { handle } from "@/lib/http";
import { shopConfig } from "@/lib/shop";

export async function GET() {
  return handle(() => shopConfig());
}
