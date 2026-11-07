// @vitest-environment jsdom
/**
 * #workspace route, driven as an analyst would: open it before the worker is
 * started, then with a worker whose engine needs setup, then against a live run
 * whose event stream drops and replays. fetch and EventSource are test doubles;
 * every assertion checks that the UI shows only what the worker reported.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The package dir carries its own React copy (a lucide-react peer). Vite dedupes
// it via resolve.dedupe; vitest.config has no dedupe, so point the package's
// copy at the app's React here (test-only) to keep one React instance.
vi.mock("../packages/nodeagent-engines/node_modules/react/index.js", async () => await import("react"));
vi.mock("../packages/nodeagent-engines/node_modules/react/jsx-runtime.js", async () => await import("react/jsx-runtime"));
vi.mock("../packages/nodeagent-engines/node_modules/react/jsx-dev-runtime.js", async () => await import("react/jsx-dev-runtime"));

import { AgentWorkspaceRoute } from "../src/ui/workspace/AgentWorkspaceRoute";

type Json = Record<string, unknown> | unknown[];
type Route = (init: RequestInit | undefined, url: URL) => { status?: number; body: Json } | undefined;

const calls: Array<{ method: string; path: string; body?: unknown }> = [];
let routes: Record<string, Route> = {};

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[`${method} ${url.pathname}`];
    if (!route) throw new TypeError("Failed to fetch");
    const out = route(init, url);
    if (!out) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }));
}

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event("open"));
  }
  emit(events: object[]) {
    for (const e of events) this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(e) }));
  }
  drop() {
    this.readyState = FakeEventSource.CONNECTING;
    this.onerror?.(new Event("error"));
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

const usage = { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null, costSource: "unknown", modelTurns: 2 };
const counters = { toolCalls: 1, toolCallsOk: 1, toolCallsFailed: 0, nativeToolCalls: 1, nodeToolCalls: 0, toolSearches: 0, toolsLoaded: 0, skillsLoaded: 0, skillLifecycleEvents: 0, helpersStarted: 1, helpersCompleted: 0, compactions: 1, artifactsWritten: 0, uniqueFilesRead: 1, checksRun: 1, permissionDenials: 0 };
const caps = Object.fromEntries(["start", "stream", "interrupt", "resume", "subagents", "childEventIdentity", "compaction", "toolSearch", "skillLoad", "skillRefresh", "goals", "permissions", "usage", "costUsd"].map((c) => [c, { status: "UNTESTED", note: "not observed" }]));
const engine = (id: string, label: string, ok: boolean, missing: string[] = []) => ({
  descriptor: { id, label, sdk: { name: `${id}-sdk`, version: "1.0.0" }, defaultModel: `${id}-default`, models: [`${id}-default`], capabilities: caps },
  availability: { ok, missing },
});
const health = (engines: ReturnType<typeof engine>[]) => ({
  ok: true,
  worker: { version: "0.1.0", startedAt: "2026-10-29T00:00:00.000Z", pid: 4242, home: "/tmp/w" },
  engines,
  templates: [{ id: "diligence-pack", title: "Diligence pack", description: "Two-company diligence", suggestedTasks: [{ id: "full-diligence", title: "Full diligence", prompt: "Compare ACME and BETA with citations." }] }],
});
const project = { id: "p1", title: "ACME vs BETA", template: "diligence-pack", workspaceDir: "/tmp/w/p1", createdAt: "2026-10-29T00:00:00.000Z" };
const runRecord = (over: Record<string, unknown> = {}) => ({
  id: "r1", projectId: "p1", engine: "claude-agent-sdk", model: "claude-sonnet-5-5", prompt: "Compare ACME and BETA with citations.", status: "running",
  createdAt: "2026-10-29T00:00:01.000Z", startedAt: "2026-10-29T00:00:01.000Z", lastSeq: 0, usage, goals: [], counters, budget: {}, context: {}, ...over,
});
let seq = 0;
const ev = (body: Record<string, unknown>) => ({ ...body, schema: "nodeagent.workspace-event/v1", runId: "r1", seq: ++seq, ts: new Date(Date.UTC(2026, 9, 29, 0, 0, seq)).toISOString() });

beforeEach(() => {
  calls.length = 0;
  routes = {};
  seq = 0;
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  installFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("#workspace route", () => {
  it("worker not started: shows the honest unavailable state with the start command and no sample content", async () => {
    render(<AgentWorkspaceRoute />);
    const panel = await screen.findByTestId("naw-unavailable");
    expect(panel.textContent).toMatch(/Execution unavailable/);
    expect(within(panel).getByText("npm run agent:worker")).toBeTruthy();
    expect(panel.textContent).toContain("/agent-api");
    for (const id of ["naw-run-item", "naw-timeline", "naw-tool-card", "naw-goal-item", "naw-artifact-item", "naw-composer"]) {
      expect(screen.queryAllByTestId(id)).toHaveLength(0);
    }
    expect(calls[0]).toMatchObject({ method: "GET", path: "/agent-api/api/health" });
    // Retry goes back to the real worker, not to a fallback.
    routes["GET /agent-api/api/health"] = () => ({ status: 503, body: { error: "starting" } });
    fireEvent.click(screen.getByRole("button", { name: /retry now/i }));
    await waitFor(() => expect(screen.getByTestId("naw-unavailable").textContent).toMatch(/503 starting/));
  });

  it("engine without credentials: setup required lists what is missing and Send stays disabled", async () => {
    routes["GET /agent-api/api/health"] = () => ({ body: health([engine("claude-agent-sdk", "Claude Agent SDK", false, ["ANTHROPIC_API_KEY is not set"])]) });
    routes["GET /agent-api/api/projects"] = () => ({ body: [project] });
    routes["GET /agent-api/api/runs"] = () => ({ body: [] });
    render(<AgentWorkspaceRoute />);
    const setup = await screen.findByTestId("naw-setup-required");
    expect(setup.textContent).toContain("ANTHROPIC_API_KEY is not set");
    fireEvent.change(screen.getByTestId("naw-composer"), { target: { value: "Do the diligence" } });
    expect((screen.getByTestId("naw-send") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByTestId("naw-composer"), { key: "Enter" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("new task: suggested chip fills the composer, Enter starts a run, Shift+Enter does not", async () => {
    routes["GET /agent-api/api/health"] = () => ({ body: health([engine("claude-agent-sdk", "Claude Agent SDK", true)]) });
    routes["GET /agent-api/api/projects"] = () => ({ body: [project] });
    routes["GET /agent-api/api/runs"] = () => ({ body: [] });
    routes["POST /agent-api/api/runs"] = () => ({ status: 201, body: runRecord({ status: "queued" }) });
    render(<AgentWorkspaceRoute />);
    fireEvent.click(await screen.findByTestId("naw-suggested-task"));
    const composer = screen.getByTestId("naw-composer") as HTMLTextAreaElement;
    expect(composer.value).toBe("Compare ACME and BETA with citations.");
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() => expect(calls.find((c) => c.method === "POST")).toMatchObject({ path: "/agent-api/api/runs", body: { projectId: "p1", engine: "claude-agent-sdk", prompt: "Compare ACME and BETA with citations." } }));
    await waitFor(() => expect(screen.getByTestId("naw-run-status").getAttribute("data-status")).toBe("queued"));
    expect(composer.value).toBe("");
    await waitFor(() => expect(FakeEventSource.instances.at(-1)?.url).toBe("/agent-api/api/runs/r1/events?after=0"));
  });

  it("live run: projects real events, survives a dropped stream without double counting, and keeps unknown cost unknown", async () => {
    routes["GET /agent-api/api/health"] = () => ({ body: health([engine("claude-agent-sdk", "Claude Agent SDK", true), engine("codex-app-server", "Codex", true)]) });
    routes["GET /agent-api/api/projects"] = () => ({ body: [project] });
    routes["GET /agent-api/api/runs"] = () => ({ body: [runRecord()] });
    routes["POST /agent-api/api/runs/r1/message"] = () => ({ body: { accepted: false, reason: "engine has no mid-run input" } });
    routes["POST /agent-api/api/runs"] = () => ({ status: 201, body: runRecord({ id: "r2", status: "queued", prompt: "Also check BETA." }) });
    render(<AgentWorkspaceRoute />);
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(1));
    const es = FakeEventSource.instances[0];
    const batch = [
      ev({ type: "run.started", engine: "claude-agent-sdk", model: "claude-sonnet-5-5", sdkVersion: "0.3.312", cwd: "/tmp/w/p1", tools: ["Read"], skills: [], nativeSessionId: "sess-1" }),
      ev({ type: "goals.updated", source: "update_goals", goals: [{ id: "g1", title: "Build comparison table", status: "done", claimedBy: "engine" }] }),
      ev({ type: "helper.started", helperId: "h1", description: "Research ACME", subagentType: "researcher" }),
      ev({ type: "tool.call", callId: "c1", name: "Read", family: "native", native: true, inputPreview: '{"file_path":"sources/acme.md"}', agentId: "h1" }),
      ev({ type: "tool.result", callId: "c1", ok: true, preview: "ACME...", ms: 8, agentId: "h1" }),
      ev({ type: "context.compacted", trigger: "auto", preTokens: 182000, postTokens: 31000 }),
      ev({ type: "usage", totals: usage }),
      ev({ type: "check.result", checkId: "verifier", command: "node verify.mjs", ok: true, passed: 4, failed: 0, durationMs: 300, outputTail: "", independent: true }),
    ];
    act(() => {
      es.open();
      es.emit(batch);
    });
    await waitFor(() => expect(screen.getAllByTestId("naw-tool-card")).toHaveLength(1));
    const card = screen.getByTestId("naw-tool-card");
    expect(card.dataset).toMatchObject({ tool: "Read", family: "native", native: "true", status: "ok", agentId: "h1" });
    expect(screen.getByTestId("naw-run-status").dataset.status).toBe("running");
    expect(screen.getByTestId("naw-helper-item").dataset).toMatchObject({ helperId: "h1", status: "running" });
    expect(screen.getByTestId("naw-compaction-marker").dataset).toMatchObject({ preTokens: "182000", postTokens: "31000", trigger: "auto" });
    expect(screen.getByTestId("naw-compaction-marker").textContent).toContain("182k → 31k tokens · auto");
    expect(screen.getByTestId("naw-goal-item").textContent).toMatch(/engine claim/);
    expect(within(screen.getByTestId("naw-verification")).getByTestId("naw-check-item").dataset).toMatchObject({ independent: "true", ok: "true" });
    const brief = screen.getByTestId("naw-task-brief").textContent ?? "";
    expect(brief).toContain("—");
    expect(brief).not.toContain("$0.00");

    // Stream drops; the browser reconnects with Last-Event-ID and the server replays the tail.
    act(() => es.drop());
    expect(screen.getByTestId("naw-reconnecting")).toBeTruthy();
    act(() => {
      es.open();
      es.emit(batch.slice(3));
    });
    await waitFor(() => expect(screen.queryByTestId("naw-reconnecting")).toBeNull());
    expect(screen.getAllByTestId("naw-tool-card")).toHaveLength(1);
    expect(screen.getAllByTestId("naw-compaction-marker")).toHaveLength(1);

    // Clicking the helper filters the timeline to its events.
    fireEvent.click(within(screen.getByTestId("naw-helper-item")).getByRole("button"));
    expect(screen.queryAllByTestId("naw-compaction-marker")).toHaveLength(0);
    expect(screen.getAllByTestId("naw-tool-card")).toHaveLength(1);

    // Developer drawer shows counters with their names, collapsed until asked for.
    expect(screen.queryByTestId("naw-dev-drawer")).toBeNull();
    fireEvent.click(screen.getByTestId("naw-dev-toggle"));
    expect(screen.getByTestId("naw-counters").dataset.counterToolCalls).toBe("1");

    // Mid-run input the engine refuses falls back to a new run, and says so.
    fireEvent.change(screen.getByTestId("naw-composer"), { target: { value: "Also check BETA." } });
    fireEvent.click(screen.getByTestId("naw-send"));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/agent-api/api/runs")).toBe(true));
    expect(calls.find((c) => c.path === "/agent-api/api/runs/r1/message")?.body).toEqual({ text: "Also check BETA." });
    await waitFor(() => expect(screen.getByText(/did not accept mid-run input \(engine has no mid-run input\)/)).toBeTruthy());
  });
});
