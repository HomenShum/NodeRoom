import "./benchmark/loadEnv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  InMemoryRoomTools,
  MANAGED_LOCK_SYSTEM_PROMPT,
  PRODUCTION_ROOM_TOOLS,
  model as realModel,
  runAgent,
} from "../src/nodeagent/index";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { RoomEngine } from "../src/engine/roomEngine";
import {
  buildHaloLivePathCalibrationReport,
  metricFromAgentResult,
  type HaloSelfImprovementRunMetric,
} from "../src/eval/haloSelfImprovement";

const DEFAULT_JSON_OUT = "docs/eval/halo-live-path-calibration.json";
const TARGETS = { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" };

const route = optionValue("--real") ?? optionValue("--route") ?? "deepseek/deepseek-v4-flash";
const repeats = Number(optionValue("--repeats") ?? "5");
const jsonOut = optionValue("--json-out") ?? DEFAULT_JSON_OUT;
const fromJson = optionValue("--from-json");
const strict = process.argv.includes("--strict");

const prior = fromJson ? readPriorReport(fromJson) : undefined;
const metrics: HaloSelfImprovementRunMetric[] = prior?.metrics ?? [];
if (!prior) {
  for (let runIndex = 0; runIndex < repeats; runIndex++) {
    metrics.push(await runLiveManagedPath(runIndex));
  }
}

const report = buildHaloLivePathCalibrationReport({
  providerRoute: prior?.providerRoute ?? route,
  caseId: "live-managed-write-path-n5",
  metrics,
  thresholds: {
    minRuns: 5,
    maxUniqueFingerprints: Number(optionValue("--max-unique-fingerprints") ?? "3"),
    maxP95ToolCalls: Number(optionValue("--max-p95-tools") ?? "8"),
  },
});

mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);

console.log(`HALO live path calibration: ${report.status} pass=${report.pass} route=${route}`);
console.log(`runs=${report.summary.runs} fingerprints=${report.summary.uniqueFingerprintCount} p95Tools=${report.summary.p95ToolCalls} p95Models=${report.summary.p95ModelCalls}`);
for (const fingerprint of report.summary.fingerprints) console.log(`fingerprint: ${fingerprint}`);
console.log(`wrote ${jsonOut}`);

if (strict && !report.pass) process.exit(1);

async function runLiveManagedPath(runIndex: number): Promise<HaloSelfImprovementRunMetric> {
  const engine = new RoomEngine();
  const demo = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, demo.roomId, demo.sheetId, demo.agents.room, demo.sessions.room);
  const result = await runAgent({
    rt,
    goal: "Set r_rev__variance to +24% and r_cogs__variance to +27.5%. Use runtime-managed writes and stop when both cells are written.",
    model: realModel(route, { operatorSelected: true }),
    tools: PRODUCTION_ROOM_TOOLS,
    systemPrompt: MANAGED_LOCK_SYSTEM_PROMPT,
    maxSteps: 10,
    deadlineAt: Date.now() + 180_000,
    reserveMs: 10_000,
  });
  assertCells(engine, demo.sheetId, TARGETS);
  return metricFromAgentResult({
    caseId: "live-managed-write-path-n5",
    runIndex,
    modelName: result.messages.findLast((message) => message.role === "assistant") ? route : route,
    result,
  });
}

function assertCells(engine: RoomEngine, artifactId: string, targets: Record<string, string>): void {
  const artifact = engine.getArtifact(artifactId);
  for (const [elementId, expected] of Object.entries(targets)) {
    const actual = artifact?.elements[elementId]?.value;
    if (actual !== expected) throw new Error(`${elementId} expected ${expected}, got ${String(actual)}`);
    if (engine.lockFor(artifactId, elementId)) throw new Error(`${elementId} still locked after run`);
  }
}

function optionValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0) return process.argv[idx + 1];
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function readPriorReport(path: string): { providerRoute: string; metrics: HaloSelfImprovementRunMetric[] } {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    providerRoute?: unknown;
    metrics?: unknown;
  };
  if (typeof parsed.providerRoute !== "string") throw new Error(`${path} missing providerRoute`);
  if (!Array.isArray(parsed.metrics)) throw new Error(`${path} missing metrics[]`);
  return { providerRoute: parsed.providerRoute, metrics: parsed.metrics as HaloSelfImprovementRunMetric[] };
}
