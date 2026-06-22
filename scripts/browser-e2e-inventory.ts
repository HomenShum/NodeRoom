import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type ScenarioStatus = "covered" | "partial" | "missing";
type ScenarioPriority = "release_floor" | "nightly";

type Scenario = {
  id: string;
  priority: ScenarioPriority;
  status: ScenarioStatus;
  suggestedSpec: string;
  steps: string[];
  assertions: string[];
};

type Flow = {
  id: string;
  name: string;
  owner: string;
  currentCoverage: string[];
  scenarios: Scenario[];
};

type Inventory = {
  schema: number;
  updatedAt: string;
  primaryPublicAgentInvocation: string;
  legacyAliases: string[];
  flows: Flow[];
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = join(root, "docs", "qa", "browser-e2e-flow-inventory.json");
const check = process.argv.includes("--check");
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as Inventory;
const errors: string[] = [];

function requireField(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${label} is required`);
}

if (inventory.schema !== 1) errors.push("schema must be 1");
if (inventory.primaryPublicAgentInvocation !== "@nodeagent") errors.push("primaryPublicAgentInvocation must stay @nodeagent");
for (const alias of ["/ask", "/free"]) {
  if (!inventory.legacyAliases.includes(alias)) errors.push(`legacy alias ${alias} must stay recorded`);
}
if (!Array.isArray(inventory.flows) || inventory.flows.length < 12) errors.push("expected at least 12 core browser E2E flows");

const scenarioIds = new Set<string>();
let releaseFloorCount = 0;
let coveredCount = 0;
let partialCount = 0;
let missingCount = 0;

for (const flow of inventory.flows) {
  requireField(flow.id, "flow.id");
  requireField(flow.name, `flow ${flow.id}.name`);
  requireField(flow.owner, `flow ${flow.id}.owner`);
  if (!Array.isArray(flow.currentCoverage)) errors.push(`flow ${flow.id}.currentCoverage must be an array`);
  if (!Array.isArray(flow.scenarios) || flow.scenarios.length === 0) errors.push(`flow ${flow.id} needs at least one scenario`);

  for (const file of flow.currentCoverage ?? []) {
    if (!existsSync(join(root, file))) errors.push(`flow ${flow.id} references missing coverage file ${file}`);
  }

  for (const scenario of flow.scenarios ?? []) {
    requireField(scenario.id, `scenario id in ${flow.id}`);
    if (scenarioIds.has(scenario.id)) errors.push(`duplicate scenario id ${scenario.id}`);
    scenarioIds.add(scenario.id);

    if (scenario.priority !== "release_floor" && scenario.priority !== "nightly") errors.push(`${scenario.id} has invalid priority`);
    if (!["covered", "partial", "missing"].includes(scenario.status)) errors.push(`${scenario.id} has invalid status`);
    if (scenario.priority === "release_floor") releaseFloorCount += 1;
    if (scenario.status === "covered") coveredCount += 1;
    if (scenario.status === "partial") partialCount += 1;
    if (scenario.status === "missing") missingCount += 1;
    requireField(scenario.suggestedSpec, `${scenario.id}.suggestedSpec`);
    if (!Array.isArray(scenario.steps) || scenario.steps.length < 2) errors.push(`${scenario.id} needs at least two concrete steps`);
    if (!Array.isArray(scenario.assertions) || scenario.assertions.length < 2) errors.push(`${scenario.id} needs at least two assertions`);
  }
}

if (releaseFloorCount < 18) errors.push("release floor needs at least 18 scenarios");
if (!scenarioIds.has("public-nodeagent.hidden-slash-aliases")) errors.push("inventory must track hidden /ask and /free compatibility aliases");
if (!scenarioIds.has("official-benchmark-ui.spreadsheetbench-workbook")) errors.push("inventory must track SpreadsheetBench fresh-room workbook UI coverage");
if (!scenarioIds.has("official-benchmark-ui.bankertoolbench-all-deliverables")) errors.push("inventory must track BankerToolBench all-deliverable fresh-room UI coverage");

const summary = {
  flows: inventory.flows.length,
  scenarios: scenarioIds.size,
  releaseFloor: releaseFloorCount,
  covered: coveredCount,
  partial: partialCount,
  missing: missingCount,
};

console.log(`Browser E2E inventory: ${summary.flows} flows, ${summary.scenarios} scenarios`);
console.log(`  release floor: ${summary.releaseFloor}`);
console.log(`  covered: ${summary.covered}`);
console.log(`  partial: ${summary.partial}`);
console.log(`  missing: ${summary.missing}`);

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  if (check) process.exit(1);
}
