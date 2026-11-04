import { handle } from "@/lib/http";
import { reset } from "@/lib/service";

export async function POST() {
  return handle(() => {
    reset();
    return { reset: true };
  });
}
