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
      description: "Start or resume the durable long-running ProofLoop Orchestrator for a repo goal.",
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
    {
      name: "proofloop.orchestrator.mineSession",
      description: "Publish session-mined rules from unfinished ProofLoop tasks into the durable run memory artifact.",
      writes: [".proofloop/orchestrator/runs/<run-id>/session-memory.json"],
    },
  ],
  resources: [
    {
      uri: "proofloop://orchestrator/latest-state",
      description: "Latest orchestrator state, queue, task statuses, and terminal reason.",
    },
    {
      uri: "proofloop://orchestrator/latest-dashboard",
      description: "Latest long-running control dashboard with goal contract, evaluator verdict, verifier stack, and not-done tasks.",
    },
    {
      uri: "proofloop://orchestrator/latest-evaluator",
      description: "Latest detached evaluator receipt produced from durable state rather than the executor transcript.",
    },
    {
      uri: "proofloop://orchestrator/session-memory",
      description: "Latest session-mined rules that turn previous blocked or failed work into future run constraints.",
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
