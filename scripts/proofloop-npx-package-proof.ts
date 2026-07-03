import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

type StepReceipt = {
  id: string;
  title: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  ok: boolean;
  stdoutTail: string;
  stderrTail: string;
};

type ProofloopNpxPackageProofReceipt = {
  schema: "proofloop-npx-package-proof-v1";
  generatedAt: string;
  packageSpec: string;
  npmView: {
    ok: boolean;
    metadata?: Record<string, unknown>;
    zeroDependencies: boolean;
  };
  tempRoot: string;
  npmCache: string;
  claims: Record<string, boolean>;
  steps: StepReceipt[];
  summary: {
    passed: boolean;
    total: number;
    passedChecks: number;
    failedChecks: number;
  };
};

const args = process.argv.slice(2);
const packageSpec = optionValue("--package") ?? "proofloop@0.1.0";
const jsonOut = optionValue("--json-out") ?? "docs/eval/proofloop-npx-package-proof.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/PROOFLOOP_NPX_PACKAGE_PROOF.md";
const strict = args.includes("--strict");
const generatedAt = new Date().toISOString();
const tempRoot = mkTemp("proofloop-npx-package-proof-");
const npmCache = mkTemp("proofloop-npm-cache-");
const cleanDir = join(tempRoot, "clean-dir");
const repoDir = join(tempRoot, "stranger-vite-repo");
mkdirSync(cleanDir, { recursive: true });
mkdirSync(repoDir, { recursive: true });

const steps: StepReceipt[] = [];
const npmViewStep = runStep("npm-view", "Registry metadata is live", cmd("npm"), [
  "view",
  packageSpec,
  "name",
  "version",
  "license",
  "dependencies",
  "author",
  "dist.tarball",
  "--json",
], cleanDir);
steps.push(npmViewStep);
const metadata = parseJson<Record<string, unknown>>(npmViewStep.stdoutTail);
const zeroDependencies = !metadata?.dependencies || Object.keys(metadata.dependencies as Record<string, unknown>).length === 0;

steps.push(runStep("clean-doctor", "Published npx doctor runs from a clean directory", cmd("npx"), ["--yes", packageSpec, "doctor"], cleanDir));
steps.push(runStep("clean-help", "Published npx help runs from a clean directory", cmd("npx"), ["--yes", packageSpec, "--help"], cleanDir));

writeStrangerRepo(repoDir, false);
steps.push(runStep("git-init", "Stranger repo is independent git state", cmd("git"), ["init"], repoDir));
const initStep = runStep("vite-init", "Published npx init detects Vite", cmd("npx"), ["--yes", packageSpec, "init"], repoDir);
steps.push({
  ...initStep,
  ok: initStep.exitCode === 0 && readJson(join(repoDir, "proofloop.config.json"))?.app === "Vite",
});
const gatePassStep = runStep("gate-npm-test-fallback", "Published npx gate passes through npm-test fallback", cmd("npx"), ["--yes", packageSpec, "gate"], repoDir);
steps.push({
  ...gatePassStep,
  ok: gatePassStep.exitCode === 0 && readJson(join(repoDir, ".proofloop", "gate-state.json"))?.source === "npm-test-fallback",
});
steps.push(runStep("hooks-install", "Published npx installs Stop and tool-use hooks", cmd("npx"), ["--yes", packageSpec, "hooks", "install"], repoDir));
steps.push(runStep("hooks-status", "Published npx reports installed hook status", cmd("npx"), ["--yes", packageSpec, "hooks", "status"], repoDir));

writeStrangerRepo(repoDir, true);
const failingGate = runStep("failing-gate", "Published npx gate records a failing npm-test fallback", cmd("npx"), ["--yes", packageSpec, "gate"], repoDir);
steps.push({ ...failingGate, ok: failingGate.exitCode === 1 });
const stopHook = runStep(
  "stop-hook-blocks-failing-gate",
  "Generated Stop hook blocks fake done while gate is failing",
  process.execPath,
  [join(repoDir, ".proofloop", "hooks", "stop-gate.mjs")],
  repoDir,
  JSON.stringify({ session_id: "published-npx-stop-proof" }),
);
steps.push({
  ...stopHook,
  ok: stopHook.exitCode === 0 && stopHook.stdoutTail.includes('"decision":"block"'),
});
const forgeryGuard = runStep(
  "forgery-guard-blocks-gate-state",
  "Generated PreToolUse guard blocks forged proof-state writes",
  process.execPath,
  [join(repoDir, ".proofloop", "hooks", "pretooluse-guard.mjs")],
  repoDir,
  JSON.stringify({
    session_id: "published-npx-forgery-proof",
    tool_name: "Write",
    tool_input: {
      file_path: ".proofloop/gate-state.json",
      content: '{"schema":"proofloop-gate-v1","status":"passed"}',
    },
  }),
);
steps.push({
  ...forgeryGuard,
  ok: forgeryGuard.exitCode === 2 && forgeryGuard.stderrTail.includes("BLOCKED edit to protected proof state"),
});

steps.push(runStep("tooluse-init", "Published npx writes expected-tool-use contract", cmd("npx"), ["--yes", packageSpec, "tooluse", "init"], repoDir));
const emptyLog = runStep("tooluse-empty-log-fails-closed", "Tool-use verifier fails closed when the log is absent", cmd("npx"), [
  "--yes",
  packageSpec,
  "tooluse",
  "verify",
  "--contract",
  "tooluse-contract.json",
], repoDir);
steps.push({ ...emptyLog, ok: emptyLog.exitCode === 2 });
const logPath = join(repoDir, ".proofloop", "tooluse", "log.jsonl");
if (existsSync(logPath)) rmSync(logPath, { force: true });
const postTool = runStep(
  "posttooluse-records-forbidden-call",
  "PostToolUse logger records a redacted forbidden call",
  process.execPath,
  [join(repoDir, ".proofloop", "hooks", "posttooluse-log.mjs")],
  repoDir,
  JSON.stringify({
    session_id: "published-npx-tooluse-proof",
    tool_name: "GITHUB_CREATE_ISSUE",
    tool_input: { repo: "owner/repo", title: "should be denied", token: "secret-token" },
  }),
);
steps.push({
  ...postTool,
  ok: postTool.exitCode === 0 && existsSync(logPath) && readFileSync(logPath, "utf8").includes('"token":"[redacted]"'),
});
const denyList = runStep("tooluse-deny-list-fails", "Tool-use verifier fails on forbidden tools and missing required tools", cmd("npx"), [
  "--yes",
  packageSpec,
  "tooluse",
  "verify",
  "--contract",
  "tooluse-contract.json",
], repoDir);
steps.push({
  ...denyList,
  ok: denyList.exitCode === 1 && denyList.stdoutTail.includes("forbidden_called"),
});

const claims = {
  registryLive: npmViewStep.exitCode === 0 && metadata?.name === "proofloop" && metadata?.version === "0.1.0",
  mitLicensed: metadata?.license === "MIT",
  zeroDependencies,
  cleanDoctorWorks: stepOk("clean-doctor"),
  cleanHelpWorks: stepOk("clean-help"),
  viteInitWorks: stepOk("vite-init"),
  gateNpmTestFallbackPasses: stepOk("gate-npm-test-fallback"),
  hooksInstallAndStatusWork: stepOk("hooks-install") && stepOk("hooks-status"),
  stopHookBlocksFailingGate: stepOk("stop-hook-blocks-failing-gate"),
  forgeryGuardBlocksProofState: stepOk("forgery-guard-blocks-gate-state"),
  tooluseEmptyLogFailsClosed: stepOk("tooluse-empty-log-fails-closed"),
  tooluseDenyListFails: stepOk("tooluse-deny-list-fails"),
};
const passedChecks = steps.filter((step) => step.ok).length;
const receipt: ProofloopNpxPackageProofReceipt = {
  schema: "proofloop-npx-package-proof-v1",
  generatedAt,
  packageSpec,
  npmView: {
    ok: Boolean(claims.registryLive && claims.mitLicensed),
    metadata,
    zeroDependencies,
  },
  tempRoot: `<temp>/${basename(tempRoot)}`,
  npmCache: `<temp>/${basename(npmCache)}`,
  claims,
  steps,
  summary: {
    passed: Object.values(claims).every(Boolean) && passedChecks === steps.length,
    total: steps.length,
    passedChecks,
    failedChecks: steps.length - passedChecks,
  },
};

writeJson(jsonOut, receipt);
writeText(mdOut, renderMarkdown(receipt));
console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);
console.log(
  `proofloop npx package proof: passed=${receipt.summary.passed}, ` +
  `checks=${receipt.summary.passedChecks}/${receipt.summary.total}, ` +
  `package=${String(metadata?.name ?? "unknown")}@${String(metadata?.version ?? "unknown")}`,
);
if (strict && !receipt.summary.passed) process.exitCode = 1;

function stepOk(id: string): boolean {
  return steps.find((step) => step.id === id)?.ok === true;
}

function runStep(id: string, title: string, command: string, commandArgs: string[], cwd: string, input?: string): StepReceipt {
  const commandLine = [command, ...commandArgs].map(shellQuote).join(" ");
  const result = spawnSync(commandLine, {
    cwd,
    shell: true,
    env: { ...process.env, npm_config_cache: npmCache },
    input,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    id,
    title,
    command: redactTempPaths(commandLine),
    cwd: redactTempPaths(cwd),
    exitCode: result.status,
    ok: result.status === 0,
    stdoutTail: redactTempPaths(tail(result.stdout ?? "")),
    stderrTail: redactTempPaths(tail(result.stderr ?? (result.error ? String(result.error) : ""))),
  };
}

function writeStrangerRepo(root: string, failing: boolean): void {
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "stranger-vite-proofloop-e2e",
      private: true,
      version: "0.0.0",
      scripts: {
        test: `node -e "process.exit(${failing ? 1 : 0})"`,
      },
      devDependencies: {
        "@vitejs/plugin-react": "latest",
        vite: "latest",
      },
    }, null, 2) + "\n",
    "utf8",
  );
  writeFileSync(join(root, "vite.config.js"), "import { defineConfig } from 'vite';\nexport default defineConfig({});\n", "utf8");
}

function renderMarkdown(receipt: ProofloopNpxPackageProofReceipt): string {
  const lines = [
    "# ProofLoop npx Package Proof",
    "",
    `Generated: ${receipt.generatedAt}`,
    `Package: \`${receipt.packageSpec}\``,
    `Registry tarball: ${String(receipt.npmView.metadata?.["dist.tarball"] ?? "unknown")}`,
    `Summary: ${receipt.summary.passed ? "passed" : "failed"} (${receipt.summary.passedChecks}/${receipt.summary.total})`,
    "",
    "## Claims",
    "",
    "| Claim | Status |",
    "|---|---|",
    ...Object.entries(receipt.claims).map(([claim, ok]) => `| \`${claim}\` | ${ok ? "pass" : "fail"} |`),
    "",
    "## Steps",
    "",
    "| Status | Step | Exit | Command |",
    "|---|---|---:|---|",
    ...receipt.steps.map((step) => `| ${step.ok ? "pass" : "fail"} | \`${step.id}\` - ${escapePipes(step.title)} | ${step.exitCode ?? "null"} | \`${escapePipes(step.command)}\` |`),
    "",
    "## Notes",
    "",
    "- The package is executed through `npx` with a temp npm cache path, not from this repository.",
    "- The stranger repo is generated under a temp directory and initialized as a separate git repository.",
    "- Empty tool-use logs are unusable and fail closed with exit 2; deny-list violations fail with exit 1.",
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, content: string): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function mkTemp(prefix: string): string {
  const path = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(path, { recursive: true });
  return path;
}

function cmd(name: string): string {
  return name;
}

function tail(value: string, max = 6000): string {
  return value.length > max ? value.slice(-max) : value;
}

function redactTempPaths(value: string): string {
  const tempRootSlash = tempRoot.replace(/\\/g, "/");
  const npmCacheSlash = npmCache.replace(/\\/g, "/");
  return value
    .replaceAll(tempRoot, `<temp>/${basename(tempRoot)}`)
    .replaceAll(tempRootSlash, `<temp>/${basename(tempRoot)}`)
    .replaceAll(npmCache, `<temp>/${basename(npmCache)}`)
    .replaceAll(npmCacheSlash, `<temp>/${basename(npmCache)}`);
}

function shellQuote(value: string): string {
  if (!/[^\w@%+=:,./\\-]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
