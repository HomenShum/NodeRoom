import { executeNotebookKernel, type NotebookKernelChart, type NotebookKernelKind, type NotebookKernelResult, type NotebookKernelScalar, type NotebookKernelStatus, type NotebookKernelTable } from "./notebookKernel";

export type NotebookKernelBackend = "safe" | "pyodide" | "jupyter" | "container";
export type NotebookKernelNetworkPolicy = "deny";

export type NotebookKernelArtifactMount = {
  id: string;
  name: string;
  mimeType: string;
  text: string;
};

export type NotebookKernelLimits = {
  timeoutMs: number;
  maxOutputBytes: number;
  maxRows: number;
  maxArtifacts: number;
  maxArtifactBytes: number;
  memoryMb: number;
};

export type NotebookKernelBrokerRequest = {
  executionId?: string;
  backend?: NotebookKernelBackend;
  kind: NotebookKernelKind;
  input: string;
  tables?: Record<string, NotebookKernelTable>;
  artifacts?: NotebookKernelArtifactMount[];
  networkPolicy?: NotebookKernelNetworkPolicy;
  limits?: Partial<NotebookKernelLimits>;
  traceId?: string;
  approval?: {
    externalExecutionApproved: boolean;
    approvedBy?: string;
    approvedAt?: number;
  };
};

export type NotebookKernelExecutionEvent = {
  sequence: number;
  executionId: string;
  kind: "queued" | "started" | "stdout" | "stderr" | "result" | "cancelled" | "timed_out" | "failed";
  text?: string;
  at: number;
};

export type NotebookKernelAdapterOutput = {
  status?: NotebookKernelStatus;
  outputText: string;
  rows?: Array<Record<string, NotebookKernelScalar>>;
  chart?: NotebookKernelChart;
  errorCode?: string;
  memoryLimitEnforced?: boolean;
  networkPolicyEnforced?: NotebookKernelNetworkPolicy;
};

export type NotebookKernelAdapterContext = {
  executionId: string;
  request: NotebookKernelBrokerRequest;
  limits: NotebookKernelLimits;
  signal: AbortSignal;
  emit: (kind: Extract<NotebookKernelExecutionEvent["kind"], "stdout" | "stderr">, text: string) => void;
};

export interface NotebookKernelAdapter {
  readonly backend: NotebookKernelBackend;
  readonly isolation: NonNullable<NotebookKernelResult["receipt"]["isolation"]>;
  readonly available: boolean;
  supports(kind: NotebookKernelKind): boolean;
  execute(context: NotebookKernelAdapterContext): Promise<NotebookKernelAdapterOutput>;
}

export type NotebookKernelExecutionHandle = {
  executionId: string;
  result: Promise<NotebookKernelResult>;
  cancel: () => void;
};

export type NotebookKernelBrokerOptions = {
  adapters: NotebookKernelAdapter[];
  maxConcurrent?: number;
  maxQueued?: number;
  now?: () => number;
};

export type NotebookKernelStartOptions = {
  signal?: AbortSignal;
  onEvent?: (event: NotebookKernelExecutionEvent) => void;
};

const DEFAULT_LIMITS: NotebookKernelLimits = {
  timeoutMs: 30_000,
  maxOutputBytes: 256_000,
  maxRows: 1_000,
  maxArtifacts: 8,
  maxArtifactBytes: 5_000_000,
  memoryMb: 256,
};

type QueueEntry = {
  active: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};

export class NotebookKernelBroker {
  private readonly adapters = new Map<NotebookKernelBackend, NotebookKernelAdapter>();
  private readonly maxConcurrent: number;
  private readonly maxQueued: number;
  private readonly now: () => number;
  private readonly controllers = new Map<string, AbortController>();
  private readonly queue: QueueEntry[] = [];
  private occupied = 0;

  constructor(options: NotebookKernelBrokerOptions) {
    for (const adapter of options.adapters) this.adapters.set(adapter.backend, adapter);
    this.maxConcurrent = clampInteger(options.maxConcurrent ?? 2, 1, 8);
    this.maxQueued = clampInteger(options.maxQueued ?? 16, 0, 100);
    this.now = options.now ?? (() => Date.now());
  }

  start(request: NotebookKernelBrokerRequest, options: NotebookKernelStartOptions = {}): NotebookKernelExecutionHandle {
    const executionId = cleanExecutionId(request.executionId) ?? createExecutionId();
    const controller = new AbortController();
    if (options.signal?.aborted) controller.abort(options.signal.reason);
    else options.signal?.addEventListener("abort", () => controller.abort(options.signal?.reason), { once: true });
    this.controllers.set(executionId, controller);
    const result = this.run(executionId, { ...request, executionId }, controller, options)
      .finally(() => this.controllers.delete(executionId));
    return {
      executionId,
      result,
      cancel: () => controller.abort(new Error("kernel_cancelled")),
    };
  }

  cancel(executionId: string): boolean {
    const controller = this.controllers.get(executionId);
    if (!controller) return false;
    controller.abort(new Error("kernel_cancelled"));
    return true;
  }

  private async run(
    executionId: string,
    request: NotebookKernelBrokerRequest,
    controller: AbortController,
    options: NotebookKernelStartOptions,
  ): Promise<NotebookKernelResult> {
    const startedAt = this.now();
    const events: NotebookKernelExecutionEvent[] = [];
    const emit = (kind: NotebookKernelExecutionEvent["kind"], text?: string) => {
      const event = { sequence: events.length + 1, executionId, kind, ...(text ? { text: capText(text, 16_000) } : {}), at: this.now() };
      events.push(event);
      options.onEvent?.(event);
    };
    const limits = normalizeLimits(request.limits);
    const backend = request.backend ?? "safe";
    const adapter = this.adapters.get(backend);
    const validation = validateRequest(request, limits);
    if (validation) return brokerResult(request, backend, adapter?.isolation ?? "in_process_bounded", executionId, startedAt, this.now(), "blocked", validation.message, validation.code, limits, events, false);
    if (!adapter?.available || !adapter.supports(request.kind)) {
      return brokerResult(request, backend, adapter?.isolation ?? "in_process_bounded", executionId, startedAt, this.now(), "blocked", `${backend} kernel is unavailable for ${request.kind}.`, "kernel_backend_unavailable", limits, events, false);
    }

    emit("queued");
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(new Error("kernel_timeout")), limits.timeoutMs);
    const signal = AbortSignal.any([controller.signal, timeoutController.signal]);
    try {
      await this.acquire(signal);
    } catch {
      clearTimeout(timeout);
      const status = timeoutController.signal.aborted ? "timed_out" : "cancelled";
      emit(status);
      return brokerResult(request, backend, adapter.isolation, executionId, startedAt, this.now(), status, status === "timed_out" ? "Kernel timed out while waiting for an execution slot." : "Kernel execution was cancelled.", status === "timed_out" ? "kernel_timeout" : "kernel_cancelled", limits, events, false);
    }

    emit("started");
    try {
      if (signal.aborted) throw abortError();
      const output = await adapter.execute({
        executionId,
        request,
        limits,
        signal,
        emit: (kind, text) => emit(kind, text),
      });
      if (signal.aborted) throw abortError();
      const normalized = enforceOutputLimits(output, limits);
      emit(normalized.status === "completed" ? "result" : normalized.status === "blocked" ? "failed" : normalized.status, normalized.outputText);
      return brokerResult(request, backend, adapter.isolation, executionId, startedAt, this.now(), normalized.status ?? "completed", normalized.outputText, normalized.errorCode, limits, events, normalized.memoryLimitEnforced === true, normalized.rows, normalized.chart, normalized.networkPolicyEnforced);
    } catch (error) {
      const timedOut = timeoutController.signal.aborted;
      const cancelled = controller.signal.aborted && !timedOut;
      const status: NotebookKernelStatus = timedOut ? "timed_out" : cancelled ? "cancelled" : "failed";
      emit(timedOut ? "timed_out" : cancelled ? "cancelled" : "failed", safeError(error));
      return brokerResult(request, backend, adapter.isolation, executionId, startedAt, this.now(), status, timedOut ? "Kernel execution exceeded its time limit." : cancelled ? "Kernel execution was cancelled." : safeError(error), timedOut ? "kernel_timeout" : cancelled ? "kernel_cancelled" : "kernel_failure", limits, events, false);
    } finally {
      clearTimeout(timeout);
      this.release();
    }
  }

  private acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(abortError());
    if (this.occupied < this.maxConcurrent) {
      this.occupied += 1;
      return Promise.resolve();
    }
    if (this.queue.filter((entry) => entry.active).length >= this.maxQueued) return Promise.reject(new Error("kernel_queue_full"));
    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = { active: true, resolve, reject };
      this.queue.push(entry);
      signal.addEventListener("abort", () => {
        if (!entry.active) return;
        entry.active = false;
        reject(abortError());
      }, { once: true });
    });
  }

  private release(): void {
    this.occupied = Math.max(0, this.occupied - 1);
    while (this.queue.length) {
      const entry = this.queue.shift();
      if (!entry?.active) continue;
      entry.active = false;
      this.occupied += 1;
      entry.resolve();
      break;
    }
  }
}

export function createSafeNotebookKernelAdapter(): NotebookKernelAdapter {
  return {
    backend: "safe",
    isolation: "in_process_bounded",
    available: true,
    supports: () => true,
    execute: async ({ request }) => {
      const result = executeNotebookKernel({ kind: request.kind, input: request.input, tables: request.tables }, { backend: "safe" });
      return {
        status: result.status,
        outputText: result.outputText,
        rows: result.rows,
        chart: result.chart,
        errorCode: result.errorCode,
        memoryLimitEnforced: true,
        networkPolicyEnforced: "deny",
      };
    },
  };
}

export function defaultNotebookKernelLimits(): NotebookKernelLimits {
  return { ...DEFAULT_LIMITS };
}

function validateRequest(request: NotebookKernelBrokerRequest, limits: NotebookKernelLimits): { code: string; message: string } | null {
  const input = request.input.trim();
  if (!input) return { code: "invalid_input", message: "No kernel input provided." };
  if (input.length > 100_000) return { code: "input_limit_exceeded", message: "Kernel input exceeds the configured limit." };
  if ((request.networkPolicy ?? "deny") !== "deny") return { code: "network_policy_blocked", message: "Notebook kernels deny network access by default." };
  const artifacts = request.artifacts ?? [];
  if (artifacts.length > limits.maxArtifacts) return { code: "artifact_count_limit", message: "Too many artifacts were mounted for one kernel execution." };
  const artifactBytes = artifacts.reduce((sum, artifact) => sum + byteLength(artifact.text), 0);
  if (artifactBytes > limits.maxArtifactBytes) return { code: "artifact_size_limit", message: "Mounted artifacts exceed the configured byte limit." };
  return null;
}

function enforceOutputLimits(output: NotebookKernelAdapterOutput, limits: NotebookKernelLimits): NotebookKernelAdapterOutput & { status: NotebookKernelStatus } {
  const rows = output.rows?.slice(0, limits.maxRows);
  const chart = output.chart ? { ...output.chart, points: output.chart.points.slice(0, limits.maxRows) } : undefined;
  const payload = { outputText: output.outputText, rows, chart };
  if (byteLength(JSON.stringify(payload)) > limits.maxOutputBytes) {
    return { status: "failed", outputText: "Kernel output exceeded the configured byte limit.", errorCode: "output_limit_exceeded", memoryLimitEnforced: output.memoryLimitEnforced, networkPolicyEnforced: output.networkPolicyEnforced };
  }
  return { ...output, status: output.status ?? "completed", rows, chart };
}

function brokerResult(
  request: NotebookKernelBrokerRequest,
  backend: NotebookKernelBackend,
  isolation: NonNullable<NotebookKernelResult["receipt"]["isolation"]>,
  executionId: string,
  startedAt: number,
  finishedAt: number,
  status: NotebookKernelStatus,
  outputText: string,
  errorCode: string | undefined,
  limits: NotebookKernelLimits,
  events: NotebookKernelExecutionEvent[],
  memoryLimitEnforced: boolean,
  rows?: Array<Record<string, NotebookKernelScalar>>,
  chart?: NotebookKernelChart,
  networkPolicyEnforced?: NotebookKernelNetworkPolicy,
): NotebookKernelResult {
  const input = request.input.trim();
  const outputPayload = { status, outputText, errorCode, rows, chart };
  return {
    schema: 1,
    kernelVersion: "noderoom-kernel-broker-v1",
    kind: request.kind,
    status,
    input,
    outputText,
    ...(rows ? { rows } : {}),
    ...(chart ? { chart } : {}),
    ...(errorCode ? { errorCode } : {}),
    receipt: {
      inputHash: stableHash({ kind: request.kind, input, backend, artifactIds: (request.artifacts ?? []).map((artifact) => artifact.id) }),
      outputHash: stableHash(outputPayload),
      backend,
      executedAt: finishedAt,
      rowCount: rows?.length ?? chart?.points.length ?? 0,
      executionId,
      durationMs: Math.max(0, finishedAt - startedAt),
      networkPolicy: request.networkPolicy ?? "deny",
      isolation,
      ...(request.traceId ? { traceId: request.traceId } : {}),
      artifactIds: (request.artifacts ?? []).map((artifact) => artifact.id),
      resourceLimits: limits,
      eventCount: events.length,
      memoryLimitEnforced,
      networkPolicyEnforced: networkPolicyEnforced === "deny",
      externalExecutionApproved: request.approval?.externalExecutionApproved === true,
      approvedBy: request.approval?.approvedBy,
    },
  };
}

function normalizeLimits(input: Partial<NotebookKernelLimits> | undefined): NotebookKernelLimits {
  return {
    timeoutMs: clampInteger(input?.timeoutMs ?? DEFAULT_LIMITS.timeoutMs, 100, 120_000),
    maxOutputBytes: clampInteger(input?.maxOutputBytes ?? DEFAULT_LIMITS.maxOutputBytes, 1_000, 1_000_000),
    maxRows: clampInteger(input?.maxRows ?? DEFAULT_LIMITS.maxRows, 1, 2_000),
    maxArtifacts: clampInteger(input?.maxArtifacts ?? DEFAULT_LIMITS.maxArtifacts, 0, 16),
    maxArtifactBytes: clampInteger(input?.maxArtifactBytes ?? DEFAULT_LIMITS.maxArtifactBytes, 0, 10_000_000),
    memoryMb: clampInteger(input?.memoryMb ?? DEFAULT_LIMITS.memoryMb, 32, 512),
  };
}

function clampInteger(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : min;
}

function createExecutionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `kernel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanExecutionId(value: string | undefined): string | undefined {
  const clean = value?.trim().replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 120);
  return clean || undefined;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function capText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function safeError(error: unknown): string {
  return capText(error instanceof Error ? error.message : String(error ?? "Kernel execution failed."), 500);
}

function abortError(): Error {
  const error = new Error("kernel_aborted");
  error.name = "AbortError";
  return error;
}

function stableHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
