import type { PyodideInterface, loadPyodide as LoadPyodide } from "pyodide";
import type { NotebookKernelAdapterOutput } from "./kernelBroker";

type RunMessage = {
  type: "run";
  executionId: string;
  code: string;
  context: unknown;
  limits: { maxOutputBytes: number; maxRows: number; memoryMb: number };
  networkPolicy: "deny";
};

const PYODIDE_INDEX_URL = new URL("/pyodide/", globalThis.location.origin).toString();
const PYODIDE_MODULE_URL = new URL("/pyodide/pyodide.mjs", globalThis.location.origin).toString();
let runtime: Promise<PyodideInterface> | undefined;

globalThis.addEventListener("message", (event: MessageEvent<RunMessage>) => {
  if (event.data?.type !== "run") return;
  void run(event.data);
});

async function run(message: RunMessage): Promise<void> {
  try {
    const pyodide = await pyodideRuntime();
    const policyError = validatePython(pyodide, message.code);
    if (policyError) {
      post({ type: "error", executionId: message.executionId, status: "blocked", errorCode: "python_policy_blocked", message: policyError });
      return;
    }

    let stdout = "";
    let stderr = "";
    pyodide.setStdout({ batched: (text) => {
      stdout = appendBounded(stdout, text, message.limits.maxOutputBytes);
      post({ type: "stream", executionId: message.executionId, channel: "stdout", text });
    } });
    pyodide.setStderr({ batched: (text) => {
      stderr = appendBounded(stderr, text, message.limits.maxOutputBytes);
      post({ type: "stream", executionId: message.executionId, channel: "stderr", text });
    } });

    pyodide.globals.set("__noderoom_context_json", JSON.stringify(message.context ?? {}));
    pyodide.runPython(`
import json as __noderoom_json
__noderoom_context = __noderoom_json.loads(__noderoom_context_json)
TABLES = __noderoom_context.get("tables", {})
ARTIFACTS = __noderoom_context.get("artifacts", [])
`);
    let value = await pyodide.runPythonAsync(message.code);
    if ((value === undefined || value === null) && pyodide.globals.has("result")) value = pyodide.globals.get("result");
    const serializable = toSerializable(value);
    const output = normalizeOutput(serializable, stdout, stderr, message.limits.maxRows);
    post({ type: "result", executionId: message.executionId, output });
  } catch (error) {
    post({ type: "error", executionId: message.executionId, status: "failed", errorCode: "python_execution_failed", message: safeError(error) });
  }
}

async function pyodideRuntime(): Promise<PyodideInterface> {
  runtime ??= import(/* @vite-ignore */ PYODIDE_MODULE_URL)
    .then((module) => (module as { loadPyodide: typeof LoadPyodide }).loadPyodide({ indexURL: PYODIDE_INDEX_URL }))
    .then((pyodide) => {
      denyWorkerNetwork();
      return pyodide;
    });
  return runtime;
}

function denyWorkerNetwork(): void {
  const blocked = () => Promise.reject(new Error("Notebook network access is disabled."));
  const scope = globalThis as unknown as Record<string, unknown>;
  scope.fetch = blocked;
  scope.WebSocket = class { constructor() { throw new Error("Notebook network access is disabled."); } };
  scope.XMLHttpRequest = class { constructor() { throw new Error("Notebook network access is disabled."); } };
  scope.EventSource = class { constructor() { throw new Error("Notebook network access is disabled."); } };
}

function validatePython(pyodide: PyodideInterface, code: string): string | null {
  pyodide.globals.set("__noderoom_user_code", code);
  const value = pyodide.runPython(`
import ast as __nr_ast
__nr_blocked_modules = {"js", "pyodide", "micropip", "socket", "urllib", "http", "requests", "aiohttp", "websockets", "subprocess", "multiprocessing", "ctypes", "importlib"}
__nr_blocked_calls = {"open", "exec", "eval", "compile", "__import__", "input", "breakpoint"}
__nr_error = None
try:
    __nr_tree = __nr_ast.parse(__noderoom_user_code, mode="exec")
    for __nr_node in __nr_ast.walk(__nr_tree):
        if isinstance(__nr_node, (__nr_ast.Import, __nr_ast.ImportFrom)):
            __nr_names = [__nr_alias.name.split(".")[0] for __nr_alias in __nr_node.names] if isinstance(__nr_node, __nr_ast.Import) else [(__nr_node.module or "").split(".")[0]]
            if any(__nr_name in __nr_blocked_modules for __nr_name in __nr_names):
                __nr_error = "Import is blocked by the notebook network/isolation policy."
                break
        if isinstance(__nr_node, __nr_ast.Call) and isinstance(__nr_node.func, __nr_ast.Name) and __nr_node.func.id in __nr_blocked_calls:
            __nr_error = "Dynamic code, file, and interactive input calls are blocked."
            break
        if isinstance(__nr_node, __nr_ast.Attribute) and __nr_node.attr.startswith("__"):
            __nr_error = "Dunder attribute access is blocked."
            break
except SyntaxError as __nr_exc:
    __nr_error = f"Python syntax error: {__nr_exc.msg}"
__nr_error
`);
  return typeof value === "string" && value ? value : null;
}

function normalizeOutput(value: unknown, stdout: string, stderr: string, maxRows: number): NotebookKernelAdapterOutput {
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const rows = Array.isArray(object.rows) ? object.rows.slice(0, maxRows) as Array<Record<string, string | number | boolean | null>> : undefined;
    const chart = validChart(object.chart, maxRows);
    const outputText = typeof object.outputText === "string" ? object.outputText : stdout || JSON.stringify(value);
    return { outputText, ...(rows ? { rows } : {}), ...(chart ? { chart } : {}), ...(stderr ? { errorCode: "python_stderr" } : {}) };
  }
  const outputText = value === undefined || value === null ? stdout || "Completed." : String(value);
  return { outputText, ...(stderr ? { errorCode: "python_stderr" } : {}) };
}

function validChart(value: unknown, maxRows: number): NotebookKernelAdapterOutput["chart"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const chart = value as Record<string, unknown>;
  if (!(["line", "bar", "scatter"] as unknown[]).includes(chart.type) || typeof chart.x !== "string" || typeof chart.y !== "string" || !Array.isArray(chart.points)) return undefined;
  return {
    type: chart.type as "line" | "bar" | "scatter",
    table: typeof chart.table === "string" ? chart.table : "python",
    x: chart.x,
    y: chart.y,
    points: chart.points.slice(0, maxRows).map((point) => {
      const item = point && typeof point === "object" ? point as Record<string, unknown> : {};
      return { x: scalar(item.x), y: scalar(item.y) };
    }),
  };
}

function scalar(value: unknown): string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : String(value ?? "");
}

function toSerializable(value: unknown): unknown {
  const proxy = value as { toJs?: (options?: unknown) => unknown; destroy?: () => void } | null;
  if (proxy?.toJs) {
    try {
      return normalizeSerializable(proxy.toJs({ dict_converter: Object.fromEntries }));
    } finally {
      proxy.destroy?.();
    }
  }
  return normalizeSerializable(value);
}

function normalizeSerializable(value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries([...value.entries()].map(([key, item]) => [String(key), normalizeSerializable(item)]));
  if (Array.isArray(value)) return value.map(normalizeSerializable);
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeSerializable(item)]));
  return value;
}

function appendBounded(current: string, next: string, maxBytes: number): string {
  const joined = current ? `${current}\n${next}` : next;
  return new TextEncoder().encode(joined).byteLength <= maxBytes ? joined : `${joined.slice(0, Math.max(0, maxBytes / 2))}...`;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? "Python execution failed.")).replace(/\s+/g, " ").slice(0, 500);
}

function post(message: unknown): void {
  globalThis.postMessage(message);
}
