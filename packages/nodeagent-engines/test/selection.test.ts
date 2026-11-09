/**
 * Scenario tests for workspace selection persistence. Persona: an analyst watching a
 * long diligence run reloads the tab (or opens it in a private window, or after the
 * worker store was wiped). The project, run and engine they had open must come back
 * when they still exist, and a broken or stale saved value must never strand the view.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { pickId, readSelection, writeSelection } from "../src/react/NodeAgentWorkspace.js";
import { LeftRail } from "../src/react/components/LeftRail.js";
import type { HealthResponse, ProjectRecord, RunRecord } from "../src/api.js";

const API = "/agent-api";
const g = globalThis as { window?: unknown };

function withStorage<T>(storage: Partial<Storage> | undefined, fn: () => T): T {
  const prev = g.window;
  g.window = storage === undefined ? undefined : { localStorage: storage };
  try {
    return fn();
  } finally {
    g.window = prev;
  }
}

function memoryStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
  };
}

test("reload: the saved project, run, engine and model come back exactly", () => {
  const s = memoryStorage();
  const saved = { projectId: "prj-a", runId: "run-2", engine: "codex-app-server", model: "gpt-5.5" } as const;
  withStorage(s, () => writeSelection(API, saved));
  assert.deepEqual(withStorage(s, () => readSelection(API)), saved);
});

test("two workers on one origin keep separate selections, and sustained writes stay one key per worker", () => {
  const s = memoryStorage();
  withStorage(s, () => {
    for (let i = 0; i < 1000; i++) {
      writeSelection("/agent-api", { projectId: "prj-a", runId: `run-${i}` });
      writeSelection("http://127.0.0.1:4318/api", { projectId: "prj-b" });
    }
    assert.equal(s.map.size, 2);
    assert.deepEqual(readSelection("/agent-api"), { projectId: "prj-a", runId: "run-999" });
    assert.deepEqual(readSelection("http://127.0.0.1:4318/api"), { projectId: "prj-b" });
  });
});

test("storage that throws (private mode, blocked site data) degrades to no selection, never a crash", () => {
  const blocked: Partial<Storage> = {
    getItem: () => {
      throw new DOMException("denied", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("quota", "QuotaExceededError");
    },
  };
  withStorage(blocked, () => {
    assert.deepEqual(readSelection(API), {});
    assert.doesNotThrow(() => writeSelection(API, { projectId: "prj-a" }));
  });
  // Server render / thumbnail capture: no window at all.
  withStorage(undefined, () => {
    assert.deepEqual(readSelection(API), {});
    assert.doesNotThrow(() => writeSelection(API, { projectId: "prj-a" }));
  });
});

test("corrupt or non-object JSON reads as no selection", () => {
  for (const raw of ["{not json", "", "null", "[]", '"prj-a"', "42"]) {
    const s = memoryStorage();
    s.map.set(`naw:selection:${API}`, raw);
    assert.deepEqual(withStorage(s, () => readSelection(API)), {}, `raw=${JSON.stringify(raw)}`);
  }
});

test("a value from an older schema keeps only string fields it knows (model:5 would crash model.trim())", () => {
  const s = memoryStorage();
  s.map.set(`naw:selection:${API}`, JSON.stringify({ projectId: "prj-a", runId: 7, model: 5, engine: { id: "x" }, theme: "dark" }));
  assert.deepEqual(withStorage(s, () => readSelection(API)), { projectId: "prj-a" });
});

test("stale project id (deleted, or the worker store was wiped) falls back to the newest project", () => {
  const projects = [{ id: "prj-new" }, { id: "prj-old" }];
  assert.equal(pickId("prj-gone", projects), "prj-new");
  assert.equal(pickId("prj-old", projects), "prj-old");
  assert.equal(pickId(undefined, projects), "prj-new");
  // Before the list loads the saved id is kept, so the first runs fetch targets the saved project.
  assert.equal(pickId("prj-old", undefined), "prj-old");
  assert.equal(pickId("prj-gone", []), undefined);
});

test("stale run id in a still-existing project falls back to the newest run instead of an empty view", () => {
  const runs = [{ id: "run-3" }, { id: "run-1" }];
  assert.equal(pickId("run-2", runs), "run-3");
  assert.equal(pickId("run-1", runs), "run-1");
});

// LeftRail has no hooks, so calling it returns the element tree without a renderer.
type Props = Record<string, unknown> & { children?: unknown };
function collect(node: unknown, pick: (p: Props) => boolean, out: Props[] = []): Props[] {
  if (Array.isArray(node)) for (const n of node) collect(n, pick, out);
  else if (node && typeof node === "object" && "props" in node) {
    const p = (node as ReactElement<Props>).props;
    if (pick(p)) out.push(p);
    collect(p.children, pick, out);
  }
  return out;
}

test("the rail marks the restored project and run with data-selected so a reload is checkable before any click", () => {
  const health = { engines: [] } as unknown as HealthResponse;
  const project = (id: string) => ({ id, title: id, template: "diligence-pack", createdAt: "2026-10-29T00:00:00Z" }) as ProjectRecord;
  const run = (id: string) => ({ id, prompt: `task ${id}`, status: "completed", engine: "claude-agent-sdk" }) as RunRecord;
  const noop = () => undefined;
  const tree = LeftRail({
    health,
    templates: [],
    templateId: "",
    onTemplate: noop,
    onNewProject: noop,
    creating: false,
    projects: [project("prj-new"), project("prj-old")],
    projectId: "prj-old",
    onProject: noop,
    runs: [run("run-3"), run("run-1")],
    runId: "run-1",
    onRun: noop,
  });
  const selected = (attr: string) => collect(tree, (p) => attr in p && p["data-selected"] === true).map((p) => p[attr]);
  assert.deepEqual(selected("data-project-id"), ["prj-old"]);
  assert.deepEqual(selected("data-run-id"), ["run-1"]);
  assert.equal(collect(tree, (p) => "data-run-id" in p).length, 2);
});
