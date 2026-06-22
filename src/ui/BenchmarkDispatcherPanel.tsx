/**
 * BenchmarkDispatcherPanel — the #bench hash route surface.
 *
 * Mounts a self-contained scroll container (NOT .r-screen — that class is flex-row
 * and would collapse this page; see the saved memory). Provides:
 *   - a list of bundled benchmark task ids
 *   - a "Run" button per task that calls dispatchBenchmarkTask against the live
 *     in-memory RoomEngine (the same engine the memory lane uses)
 *   - a results panel with the pass/fail grade per allowed_key
 *
 * Stamps `data-testid="benchmark-dispatcher"` + `data-bench-task=<slug>` so the
 * Live-DOM verification step (per the global rule) can grep raw HTML at
 * https://noderoom.live/#bench for the dispatcher signal without booting JS.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import { engine } from "../app/roomStore";
import {
  dispatchBenchmarkTask,
  listBenchmarkTaskIds,
  DEFAULT_PROXY_MODEL_ID,
  type BenchmarkResult,
  type ModelProxyCall,
} from "../app/benchmarkDispatcher";
import type { Actor } from "../engine/types";

// One bench room per browser session, lazily seeded on first run.
let cachedBenchRoomId: string | null = null;

function ensureBenchRoom(): { roomId: string; actor: Actor; sessionId: string } {
  const actor: Actor = { kind: "agent", id: "bench-agent", name: "BenchAgent", scope: "public" };
  if (cachedBenchRoomId) {
    const sess = engine.listSessions(cachedBenchRoomId).find((s) => s.scope === "public");
    if (sess) return { roomId: cachedBenchRoomId, actor, sessionId: sess.id };
  }
  // autoAllow: true so agent edits commit directly (not held as pending proposals).
  // The bench room is a fresh isolated workspace — there are no human reviewers to gate writes,
  // and the grading invariant is "did the agent actually write the rubric values" not "did a
  // human approve them". Matches buildDemoRoom in src/engine/demoRoom.ts.
  const { room } = engine.createRoom({ title: "Benchmark dispatcher", hostName: "BenchHost", autoAllow: true });
  cachedBenchRoomId = room.id;
  const sess = engine.startSession({ roomId: room.id, agentId: "bench-agent", agentName: "BenchAgent", scope: "public" });
  return { roomId: room.id, actor, sessionId: sess.id };
}

type RunState =
  | { kind: "idle" }
  | { kind: "running"; taskId: string }
  | { kind: "done"; taskId: string; result: BenchmarkResult };

export function BenchmarkDispatcherPanel({ initialTaskId }: { initialTaskId?: string }) {
  const taskIds = useMemo(() => listBenchmarkTaskIds(), []);
  const [activeTask, setActiveTask] = useState(initialTaskId || taskIds[0] || "");
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [chat, setChat] = useState<string[]>([]);
  // Wire the Convex action proxy. We probe `useConvex` first — it returns
  // `undefined` (not a throw) when no ConvexProvider is in the tree (e.g.
  // VITE_CONVEX_URL unset in local dev). The actual `useAction` call lives in
  // a sub-component that is only mounted when convex IS present, so hooks
  // order is stable and the no-provider path never crashes.
  const convex = useConvex() as (ReturnType<typeof useConvex> | undefined);
  const [callModelProxy, setCallModelProxy] = useState<ModelProxyCall | undefined>(undefined);
  const seedRef = useRef<{ ok: boolean; error?: string } | null>(null);
  if (!seedRef.current) {
    try {
      ensureBenchRoom();
      seedRef.current = { ok: true };
    } catch (e) {
      seedRef.current = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Sync the URL hash → activeTask so /#bench/nb-01-company-profile lands on the task.
  useEffect(() => {
    const fromHash = window.location.hash.match(/^#\/?bench\/([a-z0-9-]+)/i)?.[1];
    if (fromHash && taskIds.includes(fromHash.toLowerCase())) {
      setActiveTask(fromHash.toLowerCase());
    }
  }, [taskIds]);

  const handleRun = async (taskId: string) => {
    if (!seedRef.current?.ok) return;
    setRun({ kind: "running", taskId });
    setChat([`> @bench:${taskId}`]);
    setActiveTask(taskId);
    try {
      const { roomId, actor, sessionId } = ensureBenchRoom();
      const result = await dispatchBenchmarkTask({
        engine,
        roomId,
        taskId,
        actor,
        sessionId,
        postMessage: (text) => setChat((cur) => [...cur, text]),
        callModelProxy,
      });
      setRun({ kind: "done", taskId, result });
    } catch (e) {
      // Convex action errors surface here as a banner row instead of a white-
      // screen (the ErrorBoundary above the route stays armed for true crashes).
      setChat((cur) => [...cur, `ERROR ${e instanceof Error ? e.message : String(e)}`]);
      setRun({ kind: "idle" });
    }
  };

  return (
    <section
      data-testid="benchmark-dispatcher"
      data-noderoom-surface="benchmark.dispatcher"
      data-bench-task={activeTask || ""}
      style={{
        // Self-contained scroll container — do NOT inherit .r-screen (flex-row).
        minHeight: "100vh",
        padding: "32px 24px",
        maxWidth: 960,
        margin: "0 auto",
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        color: "#e8e8e8",
        background: "#0d0d10",
        overflowY: "auto",
      }}
    >
      {convex ? (
        <ProxyWiring
          onReady={(call) => {
            // setState with a function form `(prev) => next` so React stores
            // the proxy call itself instead of treating the function as a
            // state updater and invoking it with `undefined` (which fires a
            // bogus empty-args probe to the Convex modelProxy action).
            setCallModelProxy(() => call);
          }}
        />
      ) : null}
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Benchmark dispatcher</h1>
        <p style={{ color: "#9aa0a6", marginTop: 6, fontSize: 14 }}>
          Type <code>@bench:&lt;task-id&gt;</code> in any chat (or click Run below) to route to the live nodeagent runtime against bundled rubrics. Results compare actuals to <code>rubric.expected ± tol</code>.
        </p>
        {/* Model route surface. Before a run lands we display the BUILD-TIME
            resolution (live OpenRouter id when VITE_OPENROUTER_API_KEY was
            baked in, else "scripted:<task>" indicating dry-run mode). After a
            run lands we display the resolved route from the result so the
            value reflects fallback (live→scripted) when it happened. The
            data-testid="model-route" attribute is the live-DOM verification
            handle required by the spec. */}
        {(() => {
          // Pre-run preview — caller can see which lane WILL fire on click.
          //   1. Convex proxy wired (preferred prod lane, server holds key).
          //   2. Scripted dry-run.
          // (The legacy browser-direct OpenRouter lane was removed — Vercel CSP
          //  forbade it in prod and the proxy supersedes it everywhere.)
          const proxyAvailable = !!callModelProxy;
          const initial = proxyAvailable
            ? `proxy:${DEFAULT_PROXY_MODEL_ID}`
            : `scripted:bench:${activeTask || "(none)"}`;
          const resolved = run.kind === "done" ? run.result.modelRoute : initial;
          const live = run.kind === "done" ? run.result.liveModel : proxyAvailable;
          const isProxiedDryRun = resolved.startsWith("proxied-dry-run:");
          const label = live
            ? "(live)"
            : isProxiedDryRun
              ? "(proxy reached but server key missing or error — see chat)"
              : "(scripted — no model key configured; dispatcher is dry-run only)";
          return (
            <p
              data-testid="model-route"
              data-model-live={String(live)}
              data-model-name={resolved}
              style={{ color: "#9aa0a6", marginTop: 4, fontSize: 13 }}
            >
              model route: <code style={{ color: live ? "#7bd88f" : "#ffb84d" }}>{resolved}</code>{" "}
              {label}
            </p>
          );
        })()}
        {seedRef.current && !seedRef.current.ok ? (
          <p data-testid="benchmark-dispatcher-seed-error" style={{ color: "#ff8a80" }}>
            seed error: {seedRef.current.error}
          </p>
        ) : null}
      </header>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {taskIds.length === 0 ? (
          <li style={{ color: "#9aa0a6" }}>No benchmark tasks bundled.</li>
        ) : null}
        {taskIds.map((taskId) => {
          const isActive = activeTask === taskId;
          const isRunning = run.kind === "running" && run.taskId === taskId;
          return (
            <li
              key={taskId}
              data-bench-task-row={taskId}
              style={{
                padding: 12,
                background: isActive ? "#1a1d24" : "#15171c",
                border: `1px solid ${isActive ? "#3d4654" : "#222"}`,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <code style={{ fontSize: 14 }}>{taskId}</code>
              <button
                type="button"
                onClick={() => handleRun(taskId)}
                disabled={isRunning || !seedRef.current?.ok}
                data-testid={`benchmark-run-${taskId}`}
                style={{
                  background: isRunning ? "#3d4654" : "#1f5fff",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  padding: "6px 12px",
                  fontSize: 13,
                  cursor: isRunning ? "default" : "pointer",
                }}
              >
                {isRunning ? "Running…" : "Run"}
              </button>
            </li>
          );
        })}
      </ul>

      <div data-testid="public-chat-panel" data-noderoom-surface="benchmark.chat" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, color: "#bdbdbd" }}>Dispatcher chat</h2>
        <pre
          style={{
            background: "#0a0a0c",
            border: "1px solid #222",
            borderRadius: 6,
            padding: 12,
            fontSize: 12,
            maxHeight: 240,
            overflowY: "auto",
            color: "#cfd0d5",
            whiteSpace: "pre-wrap",
          }}
        >
          {chat.length === 0 ? "(no messages — click Run to dispatch a task)" : chat.join("\n")}
        </pre>
      </div>

      {run.kind === "done" ? (
        <div data-testid="benchmark-result" data-bench-result-ok={String(run.result.ok)} style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16, color: "#bdbdbd" }}>
            Result: <span style={{ color: run.result.ok ? "#7bd88f" : "#ff8a80" }}>{run.result.ok ? "PASS" : "FAIL"}</span>
            <span style={{ color: "#9aa0a6", marginLeft: 8, fontSize: 13 }}>
              {run.result.grade.filter((g) => g.ok).length}/{run.result.grade.length} keys
            </span>
          </h2>
          {run.result.error ? (
            <p data-testid="benchmark-result-error" style={{ color: "#ff8a80" }}>{run.result.error}</p>
          ) : (
            <>
            {run.result.warnings && run.result.warnings.length > 0 ? (
              <div
                data-testid="benchmark-result-warnings"
                style={{
                  background: "#1b1408",
                  border: "1px solid #5a3a12",
                  borderRadius: 4,
                  padding: 8,
                  marginBottom: 12,
                  color: "#ffb84d",
                  fontSize: 12,
                }}
              >
                <strong>Proxy warnings:</strong>
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                  {run.result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            ) : null}
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#15171c", color: "#9aa0a6" }}>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>key</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>expected</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>actual</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>tol</th>
                  <th style={{ padding: "6px 8px", textAlign: "center" }}>ok</th>
                </tr>
              </thead>
              <tbody>
                {run.result.grade.map((g) => (
                  <tr key={g.key} data-bench-grade-key={g.key} style={{ borderBottom: "1px solid #1f2128" }}>
                    <td style={{ padding: "6px 8px" }}><code>{g.key}</code></td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{g.expected}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{g.actual ?? "—"}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{g.tol}</td>
                    <td style={{ padding: "6px 8px", textAlign: "center" }}>{g.ok ? "✓" : "✗"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Sub-component that calls `useAction` and hands the resulting bound action up
 * to the parent via `onReady`. Only mounted when a ConvexProvider is in the
 * tree — `useAction` THROWS without a provider, so isolating it here keeps the
 * parent panel safe in local-dev (VITE_CONVEX_URL unset). The wiring is one-
 * shot: we report `onReady` once on mount, then render nothing.
 */
function ProxyWiring({ onReady }: { onReady: (call: ModelProxyCall) => void }) {
  const rawAction = useAction(api.modelProxy.openRouterChat);
  useEffect(() => {
    // Wrap so the dispatcher sees a stable callable shape (independent of
    // Convex SDK internals). Errors thrown by the action propagate to the
    // dispatcher's try/catch and surface as result.error / a chat banner —
    // not a white-screen. The parent wraps this with `() => call` before
    // handing it to `setCallModelProxy` so React doesn't mistake a bare
    // function for a state updater and fire a bogus empty-args probe.
    onReady((proxyArgs) => rawAction(proxyArgs));
  }, [rawAction, onReady]);
  return null;
}
