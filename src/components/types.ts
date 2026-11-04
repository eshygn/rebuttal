import type { disputeView, stateView } from "@/lib/views";
import type { CallRow } from "@/lib/calls";

export type AppState = Awaited<ReturnType<typeof stateView>> & { latestCalls: CallRow[] };
export type DisputeDetail = NonNullable<Awaited<ReturnType<typeof disputeView>>>;
export type { CallRow };
