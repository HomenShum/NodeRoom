import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type ProofLoopSetupResult = {
  status: "ready" | "needs_setup" | "blocked";
  evidence: string[];
  command?: string;
  message: string;
};

export type ProofLoopStartResult = {
  status: "ready" | "blocked";
  command: string;
  baseUrl: string;
  message: string;
};

export type ProofWorkflow = {
  id: string;
  title: string;
  configPath: string;
  command: string;
  expectedEvidence: string[];
};

export type ProofLoopAppAdapter = {
  id: string;
  detect(): Promise<boolean>;
  setup(): Promise<ProofLoopSetupResult>;
  start(): Promise<ProofLoopStartResult>;
  getBaseUrl(): Promise<string>;
  workflows(): ProofWorkflow[];
};

export function createNodeRoomProofLoopAdapter(options: { root?: string; baseUrl?: string } = {}): ProofLoopAppAdapter {
  const root = resolve(options.root ?? process.cwd());
  const baseUrl = options.baseUrl ?? "http://127.0.0.1:5173";
  return {
    id: "noderoom",
    async detect() {
      const packagePath = join(root, "package.json");
      if (!existsSync(packagePath)) return false;
      const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: string };
      return pkg.name === "noderoom" && existsSync(join(root, "proofloop", "live-browser-proof.spec.ts"));
    },
    async setup() {
      const selectorPath = join(root, "proofloop", "adapters", "noderoom", "selectors.ts");
      const configPaths = workflows(root).map((workflow) => workflow.configPath);
      const missing = [selectorPath, ...configPaths.map((path) => join(root, path))].filter((path) => !existsSync(path));
      return {
        status: missing.length ? "needs_setup" : "ready",
        evidence: [relative(root, selectorPath), ...configPaths],
        command: "npm run proofloop -- setup bankertoolbench --doctor",
        message: missing.length
          ? `NodeRoom adapter missing ${missing.length} required file(s).`
          : "NodeRoom reference adapter is ready.",
      };
    },
    async start() {
      return {
        status: "ready",
        command: "npm run dev",
        baseUrl,
        message: "Start NodeRoom with Vite, then run a Proof Loop workflow command.",
      };
    },
    async getBaseUrl() {
      return baseUrl;
    },
    workflows() {
      return workflows(root);
    },
  };
}

function workflows(_root: string): ProofWorkflow[] {
  return [
    {
      id: "accounting-live",
      title: "Accounting live browser proof",
      configPath: "proofloop/accounting/live.accounting.config.json",
      command: "PROOFLOOP_LIVE_BROWSER=1 PROOFLOOP_TASKS_JSON=proofloop/accounting/live.accounting.config.json npx playwright test --config playwright.proofloop.config.ts proofloop/live-browser-proof.spec.ts",
      expectedEvidence: [
        "live-user-contract.json",
        "node-trace-v2.json",
        "node-eval.json",
        "official-scorer-receipt.json",
      ],
    },
    {
      id: "notion-live",
      title: "Notion SDR/BDR live browser proof",
      configPath: "proofloop/notion/live.notion.config.json",
      command: "PROOFLOOP_LIVE_BROWSER=1 PROOFLOOP_TASKS_JSON=proofloop/notion/live.notion.config.json npx playwright test --config playwright.proofloop.config.ts proofloop/live-browser-proof.spec.ts",
      expectedEvidence: [
        "live-user-contract.json",
        "node-trace-v2.json",
        "node-eval.json",
        "official-scorer-receipt.json",
      ],
    },
  ];
}

function relative(root: string, path: string): string {
  return path.startsWith(root) ? path.slice(root.length + 1).replace(/\\/g, "/") : path.replace(/\\/g, "/");
}
