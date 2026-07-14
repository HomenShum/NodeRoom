import type { NotebookKernelAdapter, NotebookKernelAdapterOutput, NotebookKernelBackend } from "./kernelBroker";

export type RemoteNotebookKernelAdapterOptions = {
  backend: Extract<NotebookKernelBackend, "jupyter" | "container">;
  endpoint?: string;
  token?: string;
  fetchImpl?: typeof fetch;
};

type RemoteKernelResponse = NotebookKernelAdapterOutput & {
  networkPolicyEnforced?: "deny";
  memoryLimitEnforced?: boolean;
  events?: Array<{ channel: "stdout" | "stderr"; text: string }>;
};

export function createRemoteNotebookKernelAdapter(options: RemoteNotebookKernelAdapterOptions): NotebookKernelAdapter {
  const endpoint = options.endpoint?.trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    backend: options.backend,
    isolation: options.backend === "jupyter" ? "remote_jupyter" : "remote_container",
    available: Boolean(endpoint),
    supports: () => true,
    execute: async ({ executionId, request, limits, signal, emit }) => {
      if (!endpoint) return blocked("kernel_backend_unavailable", `${options.backend} kernel endpoint is not configured.`);
      if (request.approval?.externalExecutionApproved !== true) return blocked("external_kernel_approval_required", `Approve ${options.backend} execution before room data leaves NodeRoom.`);
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        body: JSON.stringify({
          schema: 1,
          executionId,
          backend: options.backend,
          kind: request.kind,
          input: request.input,
          tables: request.tables ?? {},
          artifacts: request.artifacts ?? [],
          networkPolicy: "deny",
          limits,
          traceId: request.traceId,
          approval: {
            approved: true,
            approvedBy: request.approval.approvedBy,
            approvedAt: request.approval.approvedAt,
          },
        }),
        signal,
      });
      if (!response.ok) throw new Error(`${options.backend} kernel request failed ${response.status}`);
      const result = await response.json() as RemoteKernelResponse;
      for (const event of result.events ?? []) emit(event.channel, event.text);
      if (result.networkPolicyEnforced !== "deny") return blocked("external_kernel_policy_unverified", `${options.backend} kernel did not attest network denial.`);
      return {
        ...result,
        networkPolicyEnforced: "deny",
        memoryLimitEnforced: result.memoryLimitEnforced === true,
      };
    },
  };
}

function blocked(errorCode: string, outputText: string): NotebookKernelAdapterOutput {
  return { status: "blocked", outputText, errorCode, networkPolicyEnforced: "deny", memoryLimitEnforced: false };
}
