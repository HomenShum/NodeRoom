/**
 * Core worker scenarios. Persona: Dana, an analyst, runs a data-cleaning task
 * in a templated workspace and expects every run, event and artifact to be
 * durable and honest. Engines are scripted fakes injected through
 * createWorker({ adapters }) — test-only, never on the product path.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { RunRecord } from "../src/api.js";
import type { Capability, EngineAdapter, EngineHost, EngineId, EngineRunOutcome, RunSpec } from "../src/contract.js";
import { emptyUsage } from "../src/contract.js";
import { classify, diff, snapshot } from "../src/artifacts.js";
import { createWorker, type Worker as NodeWorker } from "../src/server/index.js";
import { MAX_BODY_BYTES, MAX_RAW_PAYLOAD, Store } from "../src/server/store.js";
import { HttpError, parseVerifierChecks } from "../src/server/runManager.js";

// Concurrent appender: one sqlite connection per thread on the same file, loading the real Store through tsx.
const APPENDER = `
const { workerData, parentPort } = require("node:worker_threads");
(async () => {
  const { tsImport } = await import(workerData.tsxApi);
  const { Store } = await tsImport(workerData.storeUrl, workerData.parentUrl);
  const store = new Store(workerData.home);
  for (let i = 0; i < workerData.n; i++) store.append(workerData.runId, { type: "message.delta", text: workerData.tag + "-" + i });
  store.close();
  parentPort.postMessage("done");
})().catch((err) => { throw err; });
`;

await runTests();

// ---------------------------------------------------------------------------

type Script = (spec: RunSpec, host: EngineHost) => Promise<EngineRunOutcome>;

interface FakeAdapter extends EngineAdapter {
  specs: RunSpec[];
  sent: string[];
}

function fakeAdapter(id: EngineId, script: Script, opts: { missing?: string[]; send?: boolean } = {}): FakeAdapter {
  const caps = ["start", "stream", "interrupt", "resume", "subagents", "childEventIdentity", "compaction", "toolSearch", "skillLoad", "skillRefresh", "goals", "permissions", "usage", "costUsd"] as Capability[];
  const specs: RunSpec[] = [];
  const sent: string[] = [];
  return {
    specs,
    sent,
    descriptor: () => ({
      id,
      label: `fake ${id}`,
      sdk: { name: "fake", version: "0.0.0" },
      defaultModel: "fake-model",
      models: ["fake-model"],
      capabilities: Object.fromEntries(caps.map((c) => [c, { status: "UNTESTED", note: "test fake" }])) as never,
    }),
    availability: async () => ({ ok: !opts.missing?.length, missing: opts.missing ?? [] }),
    start(spec, host) {
      specs.push(spec);
      return {
        done: script(spec, host),
        interrupt: async () => {},
        send: opts.send ? async (t) => void sent.push(t) : undefined,
      };
    },
  };
}

const done = (finalText = "done", nativeSessionId?: string): EngineRunOutcome => ({ status: "completed", finalText, usage: emptyUsage(), nativeSessionId });

function untilAborted(host: EngineHost): Promise<EngineRunOutcome> {
  return new Promise((resolve) => {
    const fin = () => resolve({ status: "interrupted", finalText: "", usage: emptyUsage(), error: String(host.signal.reason?.message ?? "aborted") });
    if (host.signal.aborted) fin();
    else host.signal.addEventListener("abort", fin, { once: true });
  });
}

function makeFixtures(root: string): string {
  const fx = path.join(root, "fixtures");
  mkdirSync(path.join(fx, "t1", "data"), { recursive: true });
  mkdirSync(path.join(fx, "t1", "secret"), { recursive: true });
  mkdirSync(path.join(fx, "verifiers"), { recursive: true });
  writeFileSync(
    path.join(fx, "t1", "template.json"),
    JSON.stringify({ id: "t1", title: "Cleaning", description: "Clean raw.csv", restrictedGlobs: ["secret/**"], checks: {}, verifier: "../verifiers/t1.verify.mjs" }),
  );
  writeFileSync(path.join(fx, "t1", "data", "raw.csv"), "a,b\n1,2\n");
  writeFileSync(path.join(fx, "t1", "secret", "key.txt"), "do-not-read");
  writeFileSync(
    path.join(fx, "verifiers", "t1.verify.mjs"),
    `import { existsSync } from "node:fs";
import { join } from "node:path";
const ws = process.argv[2];
if (existsSync(join(ws, "GARBAGE"))) { console.log("not json at all"); process.exit(0); }
const ok = existsSync(join(ws, "analysis", "out.md"));
console.log(JSON.stringify({ checks: [{ id: "out-exists", ok, detail: ok ? "analysis/out.md present" : "analysis/out.md missing" }] }));
process.exit(ok ? 0 : 1);
`,
  );
  return fx;
}

async function waitFor<T>(fn: () => T | undefined | false, ms = 5000, label = "condition"): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

const terminal = (r: RunRecord) => r.status === "completed" || r.status === "failed" || r.status === "interrupted";

async function runTests(): Promise<void> {
  const { test, after } = await import("node:test");
  const root = mkdtempSync(path.join(tmpdir(), "nodeagent-core-"));
  const fixturesDir = makeFixtures(root);
  const workers: NodeWorker[] = [];
  after(async () => {
    for (const w of workers) await w.close();
    rmSync(root, { recursive: true, force: true });
  });

  let homeN = 0;
  async function boot(adapters: EngineAdapter[], extra: { maxConcurrent?: number; abortGraceMs?: number; home?: string } = {}) {
    const home = extra.home ?? path.join(root, `home-${++homeN}`);
    const w = await createWorker({ home, envFiles: [], port: 0, adapters, fixturesDir, artifactDebounceMs: 30, abortGraceMs: extra.abortGraceMs ?? 300, log: () => {}, ...extra });
    workers.push(w);
    const project = w.manager.createProject({ template: "t1", title: "Dana's cleaning" });
    return { w, home, project, m: w.manager };
  }

  test("store: seq stays gap-free with 4 threads appending to one run concurrently", async () => {
    const home = path.join(root, "concurrent");
    const store = new Store(home);
    const run = { id: "run-c", projectId: "p", engine: "claude-agent-sdk", model: "m", prompt: "x", status: "running", createdAt: new Date().toISOString(), lastSeq: 0, usage: emptyUsage(), goals: [], counters: {} as never, budget: {}, context: {} } as RunRecord;
    store.insertRun(run);
    const n = 150;
    const threads = ["a", "b", "c", "d"].map(
      (tag) =>
        new Promise<void>((resolve, reject) => {
          const t = new Worker(APPENDER, {
            eval: true,
            workerData: { home, runId: "run-c", n, tag, tsxApi: import.meta.resolve("tsx/esm/api"), storeUrl: new URL("../src/server/store.ts", import.meta.url).href, parentUrl: import.meta.url },
          });
          t.once("message", () => resolve());
          t.once("error", reject);
        }),
    );
    // Main thread appends too, interleaved with the workers.
    for (let i = 0; i < n; i++) store.append("run-c", { type: "message.delta", text: `main-${i}` });
    await Promise.all(threads);
    const all = [];
    for (let after = 0; ; ) {
      const page = store.events("run-c", after, 1000);
      if (!page.length) break;
      all.push(...page);
      after = page[page.length - 1].seq;
    }
    assert.equal(all.length, 5 * n);
    all.forEach((e, i) => assert.equal(e.seq, i + 1, "seq must be 1..N without gaps or duplicates"));
    assert.equal(store.getRun("run-c")!.lastSeq, 5 * n);
    // Each writer's own events keep their order.
    const mine = all.filter((e) => e.type === "message.delta" && e.text.startsWith("b-")).map((e) => (e as { text: string }).text);
    assert.deepEqual(mine, Array.from({ length: n }, (_, i) => `b-${i}`));
    store.close();
  });

  test("store: oversized bodies are capped (64KB) and engine.raw payloads to 8KB", () => {
    const store = new Store(path.join(root, "caps"));
    const huge = "x".repeat(500_000);
    const e1 = store.append("r", { type: "message", role: "assistant", text: huge });
    assert.ok(Buffer.byteLength(JSON.stringify(e1)) <= MAX_BODY_BYTES + 512);
    assert.match((e1 as { text: string }).text, /truncated/);
    const e2 = store.append("r", { type: "engine.raw", nativeType: "x", payload: huge });
    assert.ok((e2 as { payload: string }).payload.length <= MAX_RAW_PAYLOAD + 64);
    assert.equal(store.events("r", 0, 10_000).length, 2, "page limit is clamped, not an error");
    store.close();
  });

  test("createRun persists the run (queued) before returning; a second connection sees it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fake = fakeAdapter("claude-agent-sdk", async () => {
      await gate;
      return done();
    });
    const { m, home, project } = await boot([fake]);
    const run = await m.createRun({ projectId: project.id, engine: "claude-agent-sdk", prompt: "Clean data/raw.csv" });
    assert.equal(run.status, "queued");
    const other = new Store(home);
    const seen = other.getRun(run.id);
    assert.ok(seen, "row must exist before createRun resolved");
    assert.equal(other.events(run.id)[0].type, "message", "the user prompt is the first durable event");
    other.close();
    release();
    const final = await waitFor(() => terminal(m.getRun(run.id)) && m.getRun(run.id), 5000, "completion");
    assert.equal(final.status, "completed");
    const types = m.events(run.id).map((e) => e.type);
    assert.equal(types.filter((t) => t === "run.completed").length, 1);
  });

  test("sad path: missing provider config is an honest 412 and no run is persisted", async () => {
    const fake = fakeAdapter("codex-app-server", async () => done(), { missing: ["OPENAI_API_KEY is not set"] });
    const { m, project } = await boot([fake]);
    await assert.rejects(m.createRun({ projectId: project.id, engine: "codex-app-server", prompt: "x" }), (e: unknown) => e instanceof HttpError && e.status === 412 && /Setup required.*OPENAI_API_KEY/.test(e.message));
    assert.equal(m.listRuns(project.id).length, 0);
    await assert.rejects(m.createRun({ projectId: project.id, engine: "google-adk" as EngineId, prompt: "x" }), (e: unknown) => e instanceof HttpError && e.status === 400);
    await assert.rejects(m.createRun({ projectId: project.id, engine: "codex-app-server", prompt: "x", budget: { maxUsd: -1 } }), (e: unknown) => e instanceof HttpError && e.status === 400);
  });

  test("worker restart marks runs a dead worker left running as interrupted (worker_restart)", async () => {
    const home = path.join(root, "restart");
    const s = new Store(home);
    const base = { projectId: "p", engine: "claude-agent-sdk", model: "m", prompt: "x", createdAt: new Date().toISOString(), lastSeq: 0, usage: emptyUsage(), goals: [], counters: {} as never, budget: {}, context: {} };
    s.insertRun({ ...base, id: "run-live", status: "running" } as RunRecord);
    s.insertRun({ ...base, id: "run-q", status: "queued" } as RunRecord);
    s.insertRun({ ...base, id: "run-ok", status: "completed" } as RunRecord);
    s.append("run-live", { type: "run.status", status: "running" });
    s.close();
    const { m } = await boot([fakeAdapter("claude-agent-sdk", async () => done())], { home });
    for (const id of ["run-live", "run-q"]) {
      const r = m.getRun(id);
      assert.equal(r.status, "interrupted");
      const last = m.events(id).at(-1)!;
      assert.equal(last.type, "run.interrupted");
      assert.equal((last as { reason: string }).reason, "worker_restart");
    }
    assert.equal(m.events("run-live").at(-1)!.seq, 2, "appended after the existing event, gap-free");
    assert.equal(m.getRun("run-ok").status, "completed", "finished runs are untouched");
  });

  test("budget.maxWallMs aborts the engine and the run ends interrupted", async () => {
    const fake = fakeAdapter("claude-agent-sdk", async (_s, host) => {
      host.emit({ type: "run.started", engine: "claude-agent-sdk", model: "fake-model", sdkVersion: "0", cwd: _s.workspaceDir, tools: [], skills: [] });
      return untilAborted(host);
    });
    const { m, project } = await boot([fake]);
    const run = await m.createRun({ projectId: project.id, engine: "claude-agent-sdk", prompt: "loop forever", budget: { maxWallMs: 150 } });
    const r = await waitFor(() => terminal(m.getRun(run.id)) && m.getRun(run.id), 5000, "wall-clock abort");
    assert.equal(r.status, "interrupted");
    assert.match(r.error ?? "", /maxWallMs 150/);
    assert.equal(m.events(run.id).filter((e) => e.type === "run.interrupted").length, 1);
  });

  test("adversarial: an engine that ignores abort is finalized by Node after the grace period", async () => {
    const fake = fakeAdapter("claude-agent-sdk", () => new Promise<EngineRunOutcome>(() => {}));
    const { m, project } = await boot([fake], { abortGraceMs: 120 });
    const run = await m.createRun({ projectId: project.id, engine: "claude-agent-sdk", prompt: "hang", budget: { maxWallMs: 80 } });
    const r = await waitFor(() => terminal(m.getRun(run.id)) && m.getRun(run.id), 5000, "forced finalize");
    assert.equal(r.status, "interrupted");
  });

  test("artifacts: snapshot/diff classify created, modified and deleted files", () => {
    const ws = mkdtempSync(path.join(root, "ws-"));
    mkdirSync(path.join(ws, "analysis"), { recursive: true });
    mkdirSync(path.join(ws, "node_modules", "x"), { recursive: true });
    writeFileSync(path.join(ws, "notes.md"), "hello");
    writeFileSync(path.join(ws, "gone.json"), "{}");
    writeFileSync(path.join(ws, "node_modules", "x", "i.js"), "skip me");
    const a = snapshot(ws);
    assert.equal(a.files.has("node_modules/x/i.js"), false);
    writeFileSync(path.join(ws, "notes.md"), "hello, changed");
    unlinkSync(path.join(ws, "gone.json"));
    writeFileSync(path.join(ws, "analysis", "summary.md"), "| a | b |\n|---|---|\n| 1 | 2 |\n");
    writeFileSync(path.join(ws, "clean.mjs"), "export {}");
    const b = snapshot(ws, a);
    const d = diff(a, b, ws);
    const by = Object.fromEntries(d.map((x) => [x.path, x]));
    assert.equal(by["notes.md"].change, "modified");
    assert.equal(by["notes.md"].kind, "doc");
    assert.equal(by["gone.json"].change, "deleted");
    assert.equal(by["analysis/summary.md"].kind, "table");
    assert.equal(by["clean.mjs"].kind, "code");
    assert.match(by["clean.mjs"].sha256, /^[0-9a-f]{64}$/);
    assert.equal(diff(b, snapshot(ws, b), ws).length, 0, "no change => no events");
    assert.equal(classify("test/clean.test.mjs"), "test");
    assert.equal(classify("analysis/report.ipynb"), "notebook");
    assert.equal(classify(".claude/skills/clean/SKILL.md"), "skill");
    assert.equal(classify("skill-drafts/x/SKILL.md"), "skill");
    assert.equal(classify("data/raw.csv"), "data");
    assert.equal(classify("analysis/out.csv"), "table");
    assert.equal(classify("image.png"), "other");
  });

  test("run: tool results trigger artifact.written, reads are counted once, engine terminal events are dropped", async () => {
    const fake = fakeAdapter("claude-agent-sdk", async (spec, host) => {
      host.emit({ type: "tool.call", callId: "c1", name: "Read", family: "native", native: true, inputPreview: JSON.stringify({ file_path: path.join(spec.workspaceDir, "data", "raw.csv") }) });
      host.emit({ type: "tool.result", callId: "c1", ok: true, preview: "a,b" });
      host.emit({ type: "tool.call", callId: "c2", name: "mcp__node__read_file", family: "workspace", native: false, inputPreview: JSON.stringify({ path: "data/raw.csv" }) });
      host.emit({ type: "tool.result", callId: "c2", ok: true, preview: "a,b" });
      mkdirSync(path.join(spec.workspaceDir, "analysis"), { recursive: true });
      writeFileSync(path.join(spec.workspaceDir, "analysis", "out.md"), "| a |\n|---|\n| 1 |\n");
      host.emit({ type: "tool.call", callId: "c3", name: "Write", family: "native", native: true, inputPreview: '{"file_path":"analysis/out.md"}' });
      host.emit({ type: "tool.result", callId: "c3", ok: false, preview: "denied" });
      host.emit({ type: "permission.decision", tool: "Write", decision: "deny", reason: "test" });
      host.emit({ type: "run.completed", finalText: "fake claims done", usage: emptyUsage() });
      await new Promise((r) => setTimeout(r, 120));
      return done("real final");
    });
    const { m, project } = await boot([fake]);
    const run = await m.createRun({ projectId: project.id, engine: "claude-agent-sdk", prompt: "clean" });
    const r = await waitFor(() => m.getRun(run.id).verification && m.getRun(run.id), 10_000, "verification");
    const evs = m.events(run.id, 0, 1000);
    const art = evs.filter((e) => e.type === "artifact.written");
    assert.equal(art.length, 1, "one written file => one artifact event, even across debounce + final flush");
    assert.equal((art[0] as { path: string }).path, "analysis/out.md");
    assert.equal(evs.filter((e) => e.type === "run.completed").length, 1);
    assert.equal((evs.find((e) => e.type === "run.completed") as { finalText: string }).finalText, "real final");
    assert.equal(r.counters.uniqueFilesRead, 1, "absolute and relative reads of the same file count once");
    assert.equal(r.counters.toolCalls, 3);
    assert.equal(r.counters.toolCallsFailed, 1);
    assert.equal(r.counters.permissionDenials, 1);
    assert.equal(r.counters.artifactsWritten, 1);
    // Independent verifier ran after completion.
    assert.equal(r.verification!.passed, 1);
    const checks = evs.filter((e) => e.type === "check.result");
    assert.equal(checks.length, 1);
    assert.equal((checks[0] as { independent: boolean }).independent, true);
    assert.ok(evs.findIndex((e) => e.type === "check.result") > evs.findIndex((e) => e.type === "run.completed"));
  });

  test("verifier: unparseable output is a failed check, never a pass", async () => {
    const fake = fakeAdapter("claude-agent-sdk", async (spec) => {
      writeFileSync(path.join(spec.workspaceDir, "GARBAGE"), "1");
      return done();
    });
    const { m, project } = await boot([fake]);
    const run = await m.createRun({ projectId: project.id, engine: "claude-agent-sdk", prompt: "x" });
    const r = await waitFor(() => m.getRun(run.id).verification && m.getRun(run.id), 10_000, "verification");
    assert.equal(r.verification!.passed, 0);
    assert.equal(r.verification!.failed, 1);
    assert.match(r.verification!.checks[0].detail, /no JSON report/);
    assert.deepEqual(parseVerifierChecks('log line\n[{"id":"a","ok":true,"detail":"x"}]'), [{ id: "a", ok: true, detail: "x" }]);
    assert.deepEqual(parseVerifierChecks('{"checks":[{"id":"b","ok":"yes"}]}'), [{ id: "b", ok: false, detail: "" }], "only literal true passes");
  });

  test("concurrency cap: with 1 slot the second run waits in queue", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fake = fakeAdapter("claude-agent-sdk", async () => {
      await gate;
      return done();
    });
    const { m, project } = await boot([fake], { maxConcurrent: 1 });
    const a = await m.createRun({ projectId: project.id, engine: "claude-agent-sdk", prompt: "a" });
    const b = await m.createRun({ projectId: project.id, engine: "claude-agent-sdk", prompt: "b" });
    await waitFor(() => m.getRun(a.id).status === "running", 2000, "a running");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(m.getRun(b.id).status, "queued");
    assert.equal(fake.specs.length, 1);
    release();
    await waitFor(() => m.getRun(b.id).status === "completed", 5000, "b completes");
  });

  test("interrupt a queued run, resume by native session, and refuse resume without one", async () => {
    const fake = fakeAdapter("claude-agent-sdk", async (spec, host) => {
      host.emit({ type: "run.started", engine: "claude-agent-sdk", model: spec.model, sdkVersion: "0", nativeSessionId: spec.resume?.nativeSessionId ?? "sess-1", cwd: spec.workspaceDir, tools: [], skills: [] });
      return done("ok", spec.resume?.nativeSessionId ?? "sess-1");
    });
    const noSession = fakeAdapter("openai-agents", async () => done());
    const { m, project } = await boot([fake, noSession], { maxConcurrent: 1 });
    const a = await m.createRun({ projectId: project.id, engine: "claude-agent-sdk", prompt: "first" });
    const q = await m.createRun({ projectId: project.id, engine: "claude-agent-sdk", prompt: "queued" });
    const qi = await m.interrupt(q.id);
    assert.equal(qi.status, "interrupted");
    await waitFor(() => m.getRun(a.id).status === "completed", 5000, "a completes");
    assert.equal(m.getRun(a.id).nativeSessionId, "sess-1");
    const r = await m.resume(a.id, {});
    assert.equal(r.relation, "resume");
    assert.equal(r.parentRunId, a.id);
    assert.match(r.prompt, /Continue the task from where you stopped/);
    await waitFor(() => m.getRun(r.id).status === "completed", 5000, "resume completes");
    assert.equal(fake.specs.at(-1)!.resume?.nativeSessionId, "sess-1");
    await assert.rejects(m.interrupt(a.id), (e: unknown) => e instanceof HttpError && e.status === 409);
    const b = await m.createRun({ projectId: project.id, engine: "openai-agents", prompt: "x" });
    await waitFor(() => m.getRun(b.id).status === "completed", 5000, "b completes");
    await assert.rejects(m.resume(b.id), (e: unknown) => e instanceof HttpError && e.status === 409 && /no native session id/.test(e.message));
  });

  test("handoff: packet carries hashes, checks and engine claims as unresolved; emitted on both runs", async () => {
    const claude = fakeAdapter("claude-agent-sdk", async (spec, host) => {
      host.emit({ type: "goals.updated", source: "TodoWrite", goals: [{ id: "g1", title: "Write analysis/out.md", status: "done", claimedBy: "engine" }, { id: "g2", title: "Add tests", status: "pending", claimedBy: "engine" }] });
      host.emit({ type: "message", role: "assistant", text: "Wrote the summary." });
      host.emit({ type: "tool.call", callId: "dangling", name: "Bash", family: "native", native: true, inputPreview: "{}" });
      mkdirSync(path.join(spec.workspaceDir, "analysis"), { recursive: true });
      writeFileSync(path.join(spec.workspaceDir, "analysis", "out.md"), "result");
      return done("Summary written.");
    });
    const codex = fakeAdapter("codex-app-server", async () => done("finished"));
    const { m, project } = await boot([claude, codex]);
    const a = await m.createRun({ projectId: project.id, engine: "claude-agent-sdk", prompt: "Clean data and summarize" });
    await waitFor(() => m.getRun(a.id).verification, 10_000, "a verified");
    const b = await m.handoff(a.id, { engine: "codex-app-server" });
    assert.equal(b.relation, "handoff");
    assert.equal(b.engine, "codex-app-server");
    const packet = b.handoff!;
    assert.equal(packet.fromRunId, a.id);
    assert.equal(packet.originalPrompt, "Clean data and summarize");
    assert.equal(packet.lastSummary, "Summary written.");
    assert.ok(packet.artifacts.some((x) => x.path === "analysis/out.md" && /^[0-9a-f]{64}$/.test(x.sha256)));
    assert.ok(packet.checks.some((c) => c.checkId === "verify:out-exists" && c.ok));
    assert.ok(packet.unresolved.some((u) => /claimed done by the engine/.test(u)));
    assert.ok(packet.unresolved.some((u) => /Add tests" is pending/.test(u)));
    assert.ok(packet.unresolved.some((u) => /dangling/.test(u)));
    assert.equal(m.events(b.id)[0].type, "handoff.packet");
    assert.equal(m.events(a.id).at(-1)!.type, "handoff.packet");
    await waitFor(() => m.getRun(b.id).status === "completed", 5000, "b completes");
    assert.deepEqual(codex.specs[0].handoff, packet);
  });

  test("message: steering reaches a live engine that supports it; refused otherwise", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const steer = fakeAdapter("claude-agent-sdk", async () => {
      await gate;
      return done();
    }, { send: true });
    const { m, project } = await boot([steer]);
    const run = await m.createRun({ projectId: project.id, engine: "claude-agent-sdk", prompt: "x" });
    await waitFor(() => m.getRun(run.id).status === "running", 2000, "running");
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(await m.message(run.id, "also dedupe rows"), { accepted: true });
    assert.deepEqual(steer.sent, ["also dedupe rows"]);
    release();
    await waitFor(() => m.getRun(run.id).status === "completed", 5000, "completes");
    const res = await m.message(run.id, "too late");
    assert.equal(res.accepted, false);
  });
}
