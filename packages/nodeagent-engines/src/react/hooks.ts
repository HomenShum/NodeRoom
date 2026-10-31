import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeAgentEvent } from "../contract.js";
import type { HealthResponse } from "../api.js";
import { createWorkerClient, WorkerError } from "./client.js";
import { emptyRunView, reduceRunEvents, type RunView } from "./eventReducer.js";

export type WorkerHealthState =
  | { state: "checking"; health?: undefined; error?: undefined }
  | { state: "ok"; health: HealthResponse; error?: undefined }
  | { state: "unavailable"; health?: undefined; error: string };

/** Polls /api/health: every 30s while reachable, every 5s while not. */
export function useWorkerHealth(apiBase: string): WorkerHealthState & { refresh(): void; checkedAt?: string } {
  const client = useMemo(() => createWorkerClient(apiBase), [apiBase]);
  const [state, setState] = useState<WorkerHealthState & { checkedAt?: string }>({ state: "checking" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctl = new AbortController();
    const check = async () => {
      let ok = false;
      try {
        const health = await client.health(ctl.signal);
        if (cancelled) return;
        ok = true;
        setState({ state: "ok", health, checkedAt: new Date().toISOString() });
      } catch (err) {
        if (cancelled) return;
        setState({ state: "unavailable", error: err instanceof Error ? err.message : String(err), checkedAt: new Date().toISOString() });
      }
      timer = setTimeout(check, ok ? 30_000 : 5_000);
    };
    void check();
    return () => {
      cancelled = true;
      ctl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [client, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, refresh };
}

export type StreamState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface RunEventsState {
  view: RunView;
  stream: StreamState;
  /** True while the stream is down and being re-established (banner). */
  reconnecting: boolean;
  /** Last stream problem in plain words, if any. */
  error?: string;
  reconnect(): void;
}

const FLUSH_MS = 50;
const MAX_BUFFER = 5_000;
const MAX_BACKOFF_MS = 15_000;

/**
 * Subscribes to /api/runs/:id/events. The browser's automatic EventSource
 * reconnect resends Last-Event-ID; if the source closes for good, a manual
 * reconnect resumes with ?after=<lastSeq>. Duplicates are dropped by seq in the
 * reducer. Once a terminal event has arrived, a dropped stream is not reopened.
 */
export function useRunEvents(apiBase: string, runId: string | undefined): RunEventsState {
  const client = useMemo(() => createWorkerClient(apiBase), [apiBase]);
  const [view, setView] = useState<RunView>(emptyRunView);
  const [stream, setStream] = useState<StreamState>("idle");
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const lastRunRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (lastRunRef.current !== runId) {
      lastRunRef.current = runId;
      viewRef.current = emptyRunView();
      setView(viewRef.current);
      setError(undefined);
    }
    if (!runId || typeof EventSource === "undefined") {
      setStream(runId ? "closed" : "idle");
      if (runId) setError("This browser has no EventSource support");
      return;
    }
    let disposed = false;
    let es: EventSource | undefined;
    let buffer: NodeAgentEvent[] = [];
    let maxBuffered = 0;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const lastSeq = () => Math.max(viewRef.current.lastSeq, maxBuffered);
    const terminal = () => Boolean(viewRef.current.terminal) || buffer.some((e) => e.type === "run.completed" || e.type === "run.failed" || e.type === "run.interrupted");

    const flush = () => {
      flushTimer = undefined;
      if (disposed || buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      const next = reduceRunEvents(batch, viewRef.current);
      viewRef.current = next;
      setView(next);
    };

    const open = () => {
      if (disposed) return;
      setStream(attempt === 0 ? "connecting" : "reconnecting");
      const source = new EventSource(client.eventsUrl(runId, lastSeq()));
      es = source;
      source.onopen = () => {
        attempt = 0;
        setStream("open");
        setError(undefined);
      };
      source.onmessage = (msg) => {
        let event: NodeAgentEvent;
        try {
          event = JSON.parse(msg.data) as NodeAgentEvent;
        } catch {
          setError("Received an event that was not valid JSON; it was skipped");
          return;
        }
        if (typeof event?.seq !== "number" || event.runId !== runId) return;
        buffer.push(event);
        maxBuffered = Math.max(maxBuffered, event.seq);
        if (buffer.length >= MAX_BUFFER) flush();
        else flushTimer ??= setTimeout(flush, FLUSH_MS);
      };
      source.onerror = () => {
        if (disposed) return;
        if (terminal()) {
          source.close();
          flush();
          setStream("closed");
          return;
        }
        if (source.readyState === EventSource.CLOSED) {
          // The browser gave up (e.g. non-200); resume explicitly from lastSeq.
          source.close();
          attempt += 1;
          const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt, 4));
          setStream("reconnecting");
          setError(`Event stream closed; retrying in ${Math.round(delay / 1000)}s from event ${lastSeq()}`);
          retryTimer = setTimeout(open, delay);
        } else {
          attempt = Math.max(attempt, 1);
          setStream("reconnecting");
          setError("Event stream interrupted; the browser is reconnecting");
        }
      };
    };
    open();

    return () => {
      disposed = true;
      es?.close();
      if (flushTimer) clearTimeout(flushTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (buffer.length) {
        viewRef.current = reduceRunEvents(buffer, viewRef.current);
        buffer = [];
      }
    };
  }, [client, runId, nonce]);

  const reconnect = useCallback(() => setNonce((n) => n + 1), []);
  return { view, stream, reconnecting: stream === "reconnecting", error, reconnect };
}

/** Re-run `load` every `intervalMs` (and when `deps` change); keeps the last good value on failure. */
export function usePolled<T>(load: (() => Promise<T>) | null, intervalMs: number, deps: unknown[]): { data?: T; error?: string; reload(): void } {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    setData(undefined);
    setError(undefined);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loadRef.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const fn = loadRef.current;
      if (!fn) return;
      try {
        const value = await fn();
        if (!cancelled) {
          setData(value);
          setError(undefined);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof WorkerError || err instanceof Error ? err.message : String(err));
      }
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs, nonce, load === null, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, reload };
}

/** Wall-clock ticker for elapsed time; ticks only while `live`. */
export function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  return now;
}
