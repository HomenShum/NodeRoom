export interface RetrievalTelemetryEvent {
  at: number;
  tool: string;
  query?: string;
  hitCount: number;
  selectedConceptIds: string[];
}

export function retrievalTelemetryEvent(args: Omit<RetrievalTelemetryEvent, "at">, now = Date.now()): RetrievalTelemetryEvent {
  return { at: now, ...args };
}

