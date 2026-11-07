/** Thin fetch client for the worker HTTP API (shapes in ../api.ts). Non-2xx always throws. */
import type { EngineId, TemplateConfig } from "../contract.js";
import type {
  CreateRunRequest,
  FileContent,
  FileEntry,
  HealthResponse,
  ProjectRecord,
  RunRecord,
  VerificationReport,
} from "../api.js";

/** `status` is null when the worker could not be reached at all. */
export class WorkerError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "WorkerError";
  }
}

/**
 * Template summary as served by /api/health. `suggestedTasks` is read only when
 * the worker includes it; without it the composer shows no suggestion chips.
 */
export type TemplateSummary = HealthResponse["templates"][number] & { suggestedTasks?: TemplateConfig["suggestedTasks"] };

const DEFAULT_TIMEOUT_MS = 15_000;

export function createWorkerClient(apiBase: string) {
  const base = apiBase.replace(/\/+$/, "");

  async function request<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => ctl.abort();
    init.signal?.addEventListener("abort", onAbort, { once: true });
    let res: Response;
    try {
      res = await fetch(`${base}/api${path}`, {
        method: init.method ?? "GET",
        headers: init.body === undefined ? undefined : { "content-type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: ctl.signal,
      });
    } catch (err) {
      throw new WorkerError(ctl.signal.aborted && !init.signal?.aborted ? `Worker did not answer within ${Math.round((init.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s` : `Worker unreachable: ${(err as Error).message}`, null);
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onAbort);
    }
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      const msg = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : text.slice(0, 300) || res.statusText;
      throw new WorkerError(`${res.status} ${msg}`, res.status);
    }
    if (data === undefined) throw new WorkerError(`${res.status} response was not JSON`, res.status);
    return data as T;
  }

  const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body });
  const enc = encodeURIComponent;

  return {
    base,
    health: (signal?: AbortSignal) => request<HealthResponse>("/health", { timeoutMs: 5_000, signal }),
    projects: () => request<ProjectRecord[]>("/projects"),
    createProject: (template: string, title?: string) => post<ProjectRecord>("/projects", { template, title }),
    files: (projectId: string) => request<FileEntry[]>(`/projects/${enc(projectId)}/files`),
    file: (projectId: string, path: string) => request<FileContent>(`/projects/${enc(projectId)}/file?path=${enc(path)}`),
    runs: (projectId: string) => request<RunRecord[]>(`/runs?projectId=${enc(projectId)}`),
    run: (runId: string) => request<RunRecord>(`/runs/${enc(runId)}`),
    createRun: (req: CreateRunRequest) => post<RunRecord>("/runs", req),
    interrupt: (runId: string) => post<RunRecord>(`/runs/${enc(runId)}/interrupt`),
    resume: (runId: string, prompt?: string) => post<RunRecord>(`/runs/${enc(runId)}/resume`, prompt ? { prompt } : {}),
    message: (runId: string, text: string) => post<{ accepted: boolean; reason?: string }>(`/runs/${enc(runId)}/message`, { text }),
    handoff: (runId: string, engine: EngineId, model?: string) => post<RunRecord>(`/runs/${enc(runId)}/handoff`, model ? { engine, model } : { engine }),
    verify: (runId: string) => post<VerificationReport>(`/runs/${enc(runId)}/verify`),
    eventsUrl: (runId: string, after: number) => `${base}/api/runs/${enc(runId)}/events?after=${after}`,
  };
}

export type WorkerClient = ReturnType<typeof createWorkerClient>;
