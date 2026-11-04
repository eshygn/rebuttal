import { listCalls } from "@/lib/calls";
import { handle } from "@/lib/http";
import { stateView } from "@/lib/views";

export async function GET() {
  return handle(async () => ({ ...(await stateView()), latestCalls: listCalls(undefined, 6) }));
}
