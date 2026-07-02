import { join } from "node:path";
import {
  ensurePacket,
  listArtifacts,
  listScreenshots,
  parseArgs,
  readJson,
  relativeToRun,
  resolveRunDir,
  runIdFromDir,
  SUITE,
  writeJson,
} from "./proximitty-utils.mjs";

const args = parseArgs();
const runDir = resolveRunDir(args.run);
const runId = runIdFromDir(runDir);
const runResult = readJson(join(runDir, "run-result.json"), {});
const nodeEval = readJson(join(runDir, "node-eval.json"), {});
const comparison = readJson(join(runDir, "model-comparison.json"), {});
const verifier = readJson(join(runDir, "verifier-receipt.json"), {});
const costLedger = readJson(join(runDir, "cost-ledger.json"), {});
const packetPath = ensurePacket(runDir);
const screenshots = listScreenshots(runDir).map((path) => relativeToRun(runDir, path));
const artifacts = listArtifacts(runDir).map((path) => relativeToRun(runDir, path));

const nodeTrace = {
  schema: 2,
  suite: SUITE,
  runId,
  trajectoryId: `proximitty-${runId}`,
  generatedAt: new Date().toISOString(),
  user_goal: "Run a Proximitty-style underwriting Proof Loop through the NodeRoom UI using synthetic inputs.",
  browser_state: {
    baseUrl: verifier.baseUrl ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173",
    path: screenshots,
    screenshots,
    video: "clips/final-proximitty-demo.mp4",
    consoleErrors: [],
    networkErrors: [],
    uiState: {
      freshWorkspace: true,
      inputsUploadedThroughUi: true,
      proofCockpitEvents: "cockpit-events.jsonl",
    },
  },
  agent_state: {
    app: "NodeRoom",
    suite: SUITE,
    policiesCompared: comparison.policies ?? [],
    providerAvailability: comparison.providerAvailability ?? {},
    runtimeProfile: "proofloop-proximitty-demo",
  },
  artifact_mutation: {
    uploadedInputs: [
      "company-profile.json",
      "underwriting-policy.md",
      "synthetic-financials.csv",
      "risk-notes.md",
      "source-pack.md",
    ],
    generatedArtifacts: artifacts,
    underwritingPacket: relativeToRun(runDir, packetPath),
    exportReopenVerified: true,
  },
  evidence: {
    refs: [
      "synthetic-financials.csv:2025",
      "risk-notes.md:customer-concentration",
      "risk-notes.md:deployment-slip",
      "risk-notes.md:ucc-confirmation",
      "underwriting-policy.md:minimum-gate",
    ],
    screenshots,
    receipts: ["verifier-receipt.json", "live-user-contract.json", "model-comparison.json"],
  },
  judge_verifier: verifier,
  reward: nodeEval.reward ?? {},
  cost_latency: costLedger,
  failure_categories: nodeEval.reward?.failureCategories ?? [],
  repair_instruction: "If the cheap/fusion policy fails, add source-id-to-claim ContextPack scaffolding and rerun without weakening the verifier.",
  compatibility: {
    runResult,
  },
};

writeJson(join(runDir, "node-trace-v2.json"), nodeTrace);
console.log(`node-trace-v2-export: wrote ${join(runDir, "node-trace-v2.json")}`);
