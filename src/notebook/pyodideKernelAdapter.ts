import type { NotebookKernelAdapter, NotebookKernelAdapterOutput, NotebookKernelExecutionEvent } from "./kernelBroker";

type WorkerMessage =
  | { type: "stream"; executionId: string; channel: "stdout" | "stderr"; text: string }
  | { type: "result"; executionId: string; output: NotebookKernelAdapterOutput }
  | { type: "error"; executionId: string; status?: "blocked" | "failed"; errorCode: string; message: string };

export type NotebookKernelWorker = {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
};

export type PyodideKernelAdapterOptions = {
  workerFactory?: () => NotebookKernelWorker;
};

export function createPyodideNotebookKernelAdapter(options: PyodideKernelAdapterOptions = {}): NotebookKernelAdapter {
  const workerFactory = options.workerFactory ?? (() => new Worker(
    new URL("./pyodideKernel.worker.ts", import.meta.url),
    { type: "module", name: "noderoom-pyodide-kernel" },
  ) as unknown as NotebookKernelWorker);

  return {
    backend: "pyodide",
    isolation: "web_worker",
    available: typeof Worker !== "undefined" || options.workerFactory !== undefined,
    supports: (kind) => kind === "python",
    execute: ({ executionId, request, limits, signal, emit }) => new Promise<NotebookKernelAdapterOutput>((resolve, reject) => {
      const worker = workerFactory();
      let settled = false;
      const cleanup = () => {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      signal.addEventListener("abort", () => finish(() => reject(abortError())), { once: true });
      worker.onerror = (event) => finish(() => reject(new Error(event.message || "Pyodide worker failed.")));
      worker.onmessage = (event) => {
        const message = event.data;
        if (!message || message.executionId !== executionId) return;
        if (message.type === "stream") {
          emit(message.channel as Extract<NotebookKernelExecutionEvent["kind"], "stdout" | "stderr">, message.text);
          return;
        }
        if (message.type === "error") {
          finish(() => resolve({
            status: message.status ?? "failed",
            outputText: message.message,
            errorCode: message.errorCode,
            networkPolicyEnforced: "deny",
            memoryLimitEnforced: false,
          }));
          return;
        }
        finish(() => resolve({ ...message.output, networkPolicyEnforced: "deny", memoryLimitEnforced: false }));
      };
      worker.postMessage({
        type: "run",
        executionId,
        code: request.input,
        context: {
          tables: request.tables ?? {},
          artifacts: (request.artifacts ?? []).map((artifact) => ({ id: artifact.id, name: artifact.name, mimeType: artifact.mimeType, text: artifact.text })),
        },
        limits: {
          maxOutputBytes: limits.maxOutputBytes,
          maxRows: limits.maxRows,
          memoryMb: limits.memoryMb,
        },
        networkPolicy: "deny",
      });
    }),
  };
}

function abortError(): Error {
  const error = new Error("Pyodide worker execution aborted.");
  error.name = "AbortError";
  return error;
}
