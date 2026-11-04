import { listCalls } from "@/lib/calls";
import { handle } from "@/lib/http";

export async function GET() {
  return handle(() => listCalls(undefined, 200));
}
