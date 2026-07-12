import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildLaunchDoctorReceipt,
  evaluateLaunchGate,
  verifyLaunchProofBundle,
  type LaunchGateName,
} from "../src/launch/controlPlane";

const root = process.cwd();
const args = process.argv.slice(2);
const command = args[0] ?? "doctor";
const generatedAt = new Date().toISOString();

if (command === "doctor") {
  const receipt = buildLaunchDoctorReceipt(root, generatedAt);
  const receiptOut = option("--receipt-out");
  if (receiptOut) writeJson(receiptOut, receipt);
  printStatus("launch doctor", receipt.status, receipt.blockers);
  if (receipt.status !== "passed") process.exitCode = 1;
} else if (command === "gate:pilot") {
  runGate("pilot");
} else if (command === "gate:product-hunt") {
  runGate("product-hunt");
} else if (command === "gate:public-repos") {
  runGate("public-repos");
} else if (command === "proof:prod") {
  runGate("production");
} else if (command === "proof:verify") {
  const bundle = option("--bundle") ?? ".launch/generated/ci";
  const expectedCommit = option("--expect-commit") ?? gitHead();
  const maxAgeHours = Number(option("--max-age-hours") ?? 24);
  const receipt = verifyLaunchProofBundle(root, bundle, generatedAt, { expectedCommit, maxAgeHours });
  writeJson(".launch/receipts/ci/launch-proof-verification.json", receipt);
  printStatus("launch proof verify", receipt.status, receipt.blockers);
  if (receipt.status !== "passed") process.exitCode = 1;
} else if (command === "distribution:preview") {
  writeDistributionPreview();
} else if (command === "distribution:execute") {
  if (args.includes("--dry-run")) {
    writeDistributionPreview();
  } else {
    const gate = evaluateLaunchGate(root, "distribution", generatedAt);
    const receipt = {
      schema: "noderoom-launch-distribution-execution-v1",
      generatedAt,
      status: "blocked",
      sent: 0,
      gate,
      blocker: gate.status === "passed"
        ? "No audited NodeReach channel adapter is installed in this repository. Publication remains disabled."
        : "Distribution approval and evidence gate did not pass.",
      resumeCommand: "npm run launch:distribution:execute",
    } as const;
    writeJson(".launch/receipts/distribution/execution.json", receipt);
    printStatus("launch distribution execute", receipt.status, [receipt.blocker]);
    process.exitCode = 1;
  }
} else if (command === "monitor") {
  await runMonitor();
} else {
  console.error(`Unknown launch command '${command}'.`);
  console.error("Commands: doctor, gate:pilot, gate:product-hunt, gate:public-repos, proof:prod, proof:verify, distribution:preview, distribution:execute, monitor");
  process.exitCode = 1;
}

function runGate(gate: LaunchGateName): void {
  const receipt = evaluateLaunchGate(root, gate, generatedAt);
  writeJson(`.launch/receipts/ci/${gate}-gate.json`, receipt);
  printStatus(`launch ${gate} gate`, receipt.status, receipt.blockers);
  if (receipt.status !== "passed") process.exitCode = 1;
}

function writeDistributionPreview(): void {
  const manifestPath = resolve(root, ".launch/distribution-manifest.yaml");
  const manifest = readFileSync(manifestPath, "utf8");
  const manifestHash = createHash("sha256").update(manifest).digest("hex");
  const previewPath = ".launch/outbox/previews/distribution-preview.md";
  const preview = [
    "# NodeRoom Distribution Preview",
    "",
    `Generated: ${generatedAt}`,
    `Manifest SHA-256: \`${manifestHash}\``,
    "",
    "> Preview only. No channel, email, Product Hunt, or repository action was executed.",
    "",
    "```yaml",
    manifest.trimEnd(),
    "```",
    "",
  ].join("\n");
  writeText(previewPath, preview);
  writeJson(".launch/receipts/distribution/preview.json", {
    schema: "noderoom-launch-distribution-preview-v1",
    generatedAt,
    status: "previewed",
    manifestPath: ".launch/distribution-manifest.yaml",
    manifestHash,
    previewPath,
    sent: 0,
  });
  console.log(`launch distribution preview: wrote ${previewPath}; sent=0`);
}

async function runMonitor(): Promise<void> {
  const deployment = readJson<{ productionUrl?: string; previewUrl?: string }>(".launch/deployment-manifest.json");
  const url = (option("--url") ?? deployment?.previewUrl ?? deployment?.productionUrl ?? "https://noderoom.live").replace(/\/$/, "");
  const startedAt = Date.now();
  let receipt: Record<string, unknown>;
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const allowedHeaders = ["content-security-policy", "strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy"];
    receipt = {
      schema: "noderoom-launch-monitor-v1",
      generatedAt,
      url,
      status: response.ok ? "healthy" : "unhealthy",
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      headers: Object.fromEntries(allowedHeaders.map((name) => [name, response.headers.get(name)])),
      sensitiveHeadersRecorded: false,
    };
  } catch (error) {
    receipt = {
      schema: "noderoom-launch-monitor-v1",
      generatedAt,
      url,
      status: "unhealthy",
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      sensitiveHeadersRecorded: false,
    };
  }
  writeJson(".launch/receipts/monitoring/latest.json", receipt);
  console.log(`launch monitor: ${String(receipt.status)} ${url} (${String(receipt.latencyMs)}ms)`);
  if (receipt.status !== "healthy") process.exitCode = 1;
}

function printStatus(label: string, status: string, blockers: string[]): void {
  console.log(`${label}: ${status.toUpperCase()} blockers=${blockers.length}`);
  for (const blocker of blockers.slice(0, 20)) console.log(`- ${blocker}`);
  if (blockers.length > 20) console.log(`- ... ${blockers.length - 20} more blocker(s)`);
}

function option(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function gitHead(): string | undefined {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(resolve(root, path), "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, value: string): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}
