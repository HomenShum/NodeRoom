export type NodeRoomAnalyticsEventType =
  | "evidence_cards_built"
  | "runway_milestones_computed"
  | "chart_validation_completed"
  | "chart_artifact_rendered"
  | "coach_cue_created"
  | "review_round_prepared"
  | "downstream_draft_prepared";

export interface NodeRoomAnalyticsEvent {
  type: NodeRoomAnalyticsEventType;
  at: number;
  toolName?: string;
  ok: boolean;
  counts?: Record<string, number>;
  metadata?: Record<string, string | number | boolean | null>;
}

export type NodeRoomAnalyticsSink = (event: NodeRoomAnalyticsEvent) => void | Promise<void>;

let analyticsSink: NodeRoomAnalyticsSink | null = null;

export function setNodeRoomAnalyticsSink(sink: NodeRoomAnalyticsSink | null): () => void {
  analyticsSink = sink;
  return () => {
    if (analyticsSink === sink) analyticsSink = null;
  };
}

export function recordNodeRoomAnalyticsEvent(
  event: Omit<NodeRoomAnalyticsEvent, "at" | "ok"> & Partial<Pick<NodeRoomAnalyticsEvent, "at" | "ok">>,
  sink = analyticsSink,
): NodeRoomAnalyticsEvent {
  const normalized: NodeRoomAnalyticsEvent = {
    ...event,
    at: event.at ?? Date.now(),
    ok: event.ok ?? true,
  };
  if (!sink) return normalized;
  try {
    const result = sink(normalized);
    if (isPromiseLike(result)) {
      void result.catch(() => {
        // Observability must never take down the agent path.
      });
    }
  } catch {
    // Observability must never take down the agent path.
  }
  return normalized;
}

export const consoleAnalyticsSink: NodeRoomAnalyticsSink = (event) => {
  console.info("[noderoom.analytics]", JSON.stringify(event));
};

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof (value as { then?: unknown }).then === "function";
}
