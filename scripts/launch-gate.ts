import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { launchPolicy, launchPolicyDigest, type LaunchArtifactKind, type LaunchGateProfile } from "../src/launch/policy";

type CommandReceipt = {
  schema: "noderoom-launch-command-receipt-v1";
  id: string;
  kind: LaunchArtifactKind;
  status: "passed" | "failed";
  program: "npm" | "npx";
  args: string[];
  gitCommit: string;
  policyDigest: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal?: string;
  stdoutTail: string;
  stderrTail: string;
  outputRedacted: true;
};

const root = process.cwd();
const args = process.argv.slice(2);
const profile = parseProfile(option("--profile") ?? args[0] ?? "ci");
const out = resolve(root, option("--out") ?? `.launch/generated/${profile}`);
const policy = launchPolicy(profile);
const policyDigest = launchPolicyDigest(policy);
const gitCommit = git(["rev-parse", "HEAD"]);
const backendRevision = git(["rev-parse", "HEAD:convex"]);
const dirty = git(["status", "--porcelain"]).trim().length > 0;

if (!gitCommit || !backendRevision) {
  console.error("launch gate: unable to resolve app or Convex revision");
  process.exit(2);
}
if (dirty) {
  console.error("launch gate: worktree is dirty; commit the exact candidate before generating trusted proof");
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const commandReceipts: Array<{ path: string; receipt: CommandReceipt }> = [];
let failed = false;

for (const command of policy.commands) {
  const started = new Date();
  const program = process.platform === "win32" ? `${command.program}.cmd` : command.program;
  console.log(`launch gate [${profile}] ${command.id}: ${command.program} ${command.args.join(" ")}`);
  const result = spawnSync(program, command.args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: command.timeoutMs,
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  const finished = new Date();
  const receipt: CommandReceipt = {
    schema: "noderoom-launch-command-receipt-v1",
    id: command.id,
    kind: command.kind,
    status: result.status === 0 ? "passed" : "failed",
    program: command.program,
    args: command.args,
    gitCommit,
    policyDigest,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    exitCode: result.status,
    ...(result.signal ? { signal: result.signal } : {}),
    stdoutTail: redact(tail(result.stdout ?? "")),
    stderrTail: redact(tail(result.stderr ?? result.error?.message ?? "")),
    outputRedacted: true,
  };
  const path = `receipts/${command.kind}/${command.id}.json`;
  writeJson(join(out, path), receipt);
  commandReceipts.push({ path, receipt });
  if (receipt.status !== "passed") {
    failed = true;
    console.error(`launch gate [${profile}] ${command.id}: FAILED exit=${String(result.status)}`);
    break;
  }
}

const generatedAt = new Date().toISOString();
const metadataPath = "metadata.json";
writeJson(join(out, metadataPath), {
  schema: "noderoom-launch-bundle-metadata-v1",
  generatedAt,
  generatedBy: "scripts/launch-gate.ts",
  profile,
  claimBoundary: policy.claimBoundary,
  gitCommit,
  backendRevision,
  policyDigest,
  workingTreeDirty: false,
  status: failed ? "blocked" : "passed",
});

const fileRecords = [metadataPath, ...commandReceipts.map((entry) => entry.path)].map((path) => {
  const bytes = readFileSync(join(out, path));
  const kind = path === metadataPath
    ? "metadata"
    : commandReceipts.find((entry) => entry.path === path)?.receipt.kind ?? "metadata";
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
    kind,
  };
});

const manifest = {
  schema: "noderoom-launch-proof-bundle-v1",
  appCommit: gitCommit,
  backendRevision,
  generatedAt,
  generatedBy: "scripts/launch-gate.ts",
  profile,
  policyDigest,
  claimBoundary: policy.claimBoundary,
  status: failed ? "blocked" : "passed",
  requiredKinds: policy.requiredKinds,
  files: fileRecords,
  claims: commandReceipts.map(({ path, receipt }) => ({
    id: `command:${receipt.id}`,
    claim: `${receipt.id} ${receipt.status} for ${gitCommit}.`,
    evidence: [path],
  })),
};
writeJson(join(out, "manifest.json"), manifest);

console.log(`launch gate [${profile}]: ${manifest.status.toUpperCase()} bundle=${relative(root, out)} policy=${policyDigest}`);
if (failed) process.exitCode = 1;

function parseProfile(value: string): LaunchGateProfile {
  if (value === "ci" || value === "pilot") return value;
  throw new Error(`Unsupported launch gate profile '${value}'.`);
}

function git(gitArgs: string[]): string {
  const result = spawnSync("git", gitArgs, { cwd: root, encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : "";
}

function option(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function tail(value: string, max = 12_000): string {
  return value.length > max ? value.slice(-max) : value;
}

function redact(value: string): string {
  return value
    .replace(/(authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[REDACTED]")
    .replace(/\b(bearer)\s+[a-z0-9._~+\/-]+=*/gi, "$1 [REDACTED]");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
