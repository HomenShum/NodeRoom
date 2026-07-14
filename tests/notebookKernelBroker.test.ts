import { describe, expect, it, vi } from "vitest";
import { NotebookKernelBroker, createSafeNotebookKernelAdapter, type NotebookKernelAdapter } from "../src/notebook/kernelBroker";
import { createPyodideNotebookKernelAdapter, type NotebookKernelWorker } from "../src/notebook/pyodideKernelAdapter";
import { createRemoteNotebookKernelAdapter } from "../src/notebook/remoteKernelAdapter";

function waitingAdapter(): NotebookKernelAdapter {
  return {
    backend: "container",
    isolation: "remote_container",
    available: true,
    supports: () => true,
    execute: ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }),
  };
}

describe("notebook kernel broker", () => {
  it("keeps calculation, dataframe, and chart work on the safe default lane", async () => {
    const broker = new NotebookKernelBroker({ adapters: [createSafeNotebookKernelAdapter()] });
    const tables = {
      diligence: {
        name: "Diligence",
        columns: ["Company", "Revenue"],
        rows: [{ Company: "CardioNova", Revenue: 12 }, { Company: "Mercury", Revenue: 21 }],
      },
    };
    const calculation = await broker.start({ kind: "calculation", input: "Runway = 12 + 8 * 2" }).result;
    const dataframe = await broker.start({ kind: "sql", input: "SELECT Company, Revenue FROM diligence ORDER BY Revenue DESC", tables }).result;
    const chart = await broker.start({ kind: "chart", input: "bar chart Revenue by Company from diligence", tables }).result;

    expect(calculation).toMatchObject({ status: "completed", outputText: "28", receipt: { backend: "safe", networkPolicy: "deny", memoryLimitEnforced: true } });
    expect(dataframe.rows).toEqual([{ Company: "Mercury", Revenue: 21 }, { Company: "CardioNova", Revenue: 12 }]);
    expect(chart.chart).toMatchObject({ type: "bar", x: "Company", y: "Revenue" });
    expect(await broker.start({ kind: "python", input: "1 + 1" }).result).toMatchObject({ status: "blocked", errorCode: "python_requires_isolated_backend" });
  });

  it("records streamed output and converts adapter exceptions into failed receipts", async () => {
    const adapter: NotebookKernelAdapter = {
      backend: "container",
      isolation: "remote_container",
      available: true,
      supports: () => true,
      execute: async ({ emit }) => {
        emit("stdout", "starting");
        throw new Error("kernel exploded");
      },
    };
    const events: string[] = [];
    const result = await new NotebookKernelBroker({ adapters: [adapter] }).start(
      { backend: "container", kind: "python", input: "raise RuntimeError()", approval: { externalExecutionApproved: true } },
      { onEvent: (event) => events.push(event.kind) },
    ).result;

    expect(result).toMatchObject({ status: "failed", errorCode: "kernel_failure", outputText: "kernel exploded" });
    expect(events).toEqual(["queued", "started", "stdout", "failed"]);
  });

  it("enforces timeout and cancellation independently", async () => {
    const timeoutBroker = new NotebookKernelBroker({ adapters: [waitingAdapter()] });
    const timedOut = await timeoutBroker.start({ backend: "container", kind: "python", input: "while True: pass", limits: { timeoutMs: 100 }, approval: { externalExecutionApproved: true } }).result;
    expect(timedOut).toMatchObject({ status: "timed_out", errorCode: "kernel_timeout" });

    const cancelBroker = new NotebookKernelBroker({ adapters: [waitingAdapter()] });
    const handle = cancelBroker.start({ executionId: "cancel-me", backend: "container", kind: "python", input: "while True: pass", approval: { externalExecutionApproved: true } });
    expect(cancelBroker.cancel(handle.executionId)).toBe(true);
    expect(await handle.result).toMatchObject({ status: "cancelled", errorCode: "kernel_cancelled" });
  });

  it("queues simultaneous users without exceeding configured concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const adapter: NotebookKernelAdapter = {
      backend: "container",
      isolation: "remote_container",
      available: true,
      supports: () => true,
      execute: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 25));
        active -= 1;
        return { outputText: "done", networkPolicyEnforced: "deny", memoryLimitEnforced: true };
      },
    };
    const broker = new NotebookKernelBroker({ adapters: [adapter], maxConcurrent: 2 });
    const runs = [1, 2, 3, 4].map((id) => broker.start({ executionId: `run-${id}`, backend: "container", kind: "python", input: String(id), approval: { externalExecutionApproved: true } }).result);
    const results = await Promise.all(runs);

    expect(maxActive).toBe(2);
    expect(results.every((result) => result.status === "completed")).toBe(true);
  });

  it("caps read-only artifact mounts before adapter execution", async () => {
    const execute = vi.fn(async () => ({ outputText: "should not run" }));
    const adapter: NotebookKernelAdapter = { backend: "container", isolation: "remote_container", available: true, supports: () => true, execute };
    const result = await new NotebookKernelBroker({ adapters: [adapter] }).start({
      backend: "container",
      kind: "python",
      input: "1",
      artifacts: [{ id: "a1", name: "large.txt", mimeType: "text/plain", text: "x".repeat(2_000) }],
      limits: { maxArtifactBytes: 1_000 },
      approval: { externalExecutionApproved: true },
    }).result;
    expect(result).toMatchObject({ status: "blocked", errorCode: "artifact_size_limit" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires approval and policy attestation for remote Jupyter", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      outputText: "2",
      networkPolicyEnforced: "deny",
      memoryLimitEnforced: true,
      events: [{ channel: "stdout", text: "2" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    const adapter = createRemoteNotebookKernelAdapter({ backend: "jupyter", endpoint: "https://kernel.example/run", token: "secret", fetchImpl });
    const broker = new NotebookKernelBroker({ adapters: [adapter] });

    expect(await broker.start({ backend: "jupyter", kind: "python", input: "1 + 1" }).result).toMatchObject({ status: "blocked", errorCode: "external_kernel_approval_required" });
    const approved = await broker.start({ backend: "jupyter", kind: "python", input: "1 + 1", approval: { externalExecutionApproved: true, approvedBy: "u1" } }).result;
    expect(approved).toMatchObject({ status: "completed", outputText: "2", receipt: { networkPolicyEnforced: true, memoryLimitEnforced: true, approvedBy: "u1" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses a disposable Pyodide worker and terminates it after the result", async () => {
    let terminated = false;
    const worker: NotebookKernelWorker = {
      onmessage: null,
      onerror: null,
      postMessage(message) {
        const executionId = (message as { executionId: string }).executionId;
        queueMicrotask(() => {
          worker.onmessage?.({ data: { type: "stream", executionId, channel: "stdout", text: "running" } } as MessageEvent);
          worker.onmessage?.({ data: { type: "result", executionId, output: { outputText: "2", networkPolicyEnforced: "deny" } } } as MessageEvent);
        });
      },
      terminate() { terminated = true; },
    };
    const adapter = createPyodideNotebookKernelAdapter({ workerFactory: () => worker });
    const result = await new NotebookKernelBroker({ adapters: [adapter] }).start({ backend: "pyodide", kind: "python", input: "1 + 1" }).result;
    expect(result).toMatchObject({ status: "completed", outputText: "2", receipt: { isolation: "web_worker", networkPolicyEnforced: true, memoryLimitEnforced: false } });
    expect(terminated).toBe(true);
  });
});
