export type ProofloopOrchestratorMcpManifest = {
  schema: "proofloop-orchestrator-mcp-manifest-v1";
  tools: Array<{
    name: string;
    description: string;
    writes: string[];
  }>;
  resources: Array<{
    uri: string;
    description: string;
  }>;
  prompts: Array<{
    name: string;
    description: string;
  }>;
};

export const proofloopOrchestratorMcpManifest: ProofloopOrchestratorMcpManifest = {
  schema: "proofloop-orchestrator-mcp-manifest-v1",
  tools: [
    {
      name: "proofloop.orchestrator.start",
      description: "Start or resume the durable ProofLoop Orchestrator for a repo goal.",
      writes: [".proofloop/orchestrator/", ".proofloop/codegraph/"],
    },
    {
      name: "proofloop.codegraph.index",
      description: "Build the local-first repo code graph used for repair routing.",
      writes: [".proofloop/codegraph/"],
    },
    {
      name: "proofloop.worker.dispatch",
      description: "Write a worker repair packet for a failed, blocked, or approval-gated proof task.",
      writes: [".proofloop/orchestrator/runs/<run-id>/worker-dispatch.json"],
    },
  ],
  resources: [
    {
      uri: "proofloop://orchestrator/latest-state",
      description: "Latest orchestrator state, queue, task statuses, and terminal reason.",
    },
    {
      uri: "proofloop://codegraph/latest",
      description: "Latest local repo graph manifest, nodes, and edges.",
    },
  ],
  prompts: [
    {
      name: "proofloop_repair_task",
      description: "Repair one Proof Loop task using the orchestrator code graph and proof constraints.",
    },
  ],
};
