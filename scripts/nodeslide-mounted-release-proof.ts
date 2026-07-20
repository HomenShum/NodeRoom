import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LOCK_SCHEMA = "noderoom.nodeslide-release-lock/v1" as const;
const MANIFEST_SCHEMA = "nodeslide.artifacts/v1" as const;

type ReleaseLock = {
  schemaVersion: typeof LOCK_SCHEMA;
  nodeSlideCommit: string;
  releaseVersion: string;
  manifestFile: string;
  manifestSha256: `sha256:${string}`;
  installUpgradeProofFile: string;
  installUpgradeProofSha256: `sha256:${string}`;
  baselineManifestSha256: `sha256:${string}`;
  runtimePackages: string[];
};

type ArtifactManifest = {
  schemaVersion: typeof MANIFEST_SCHEMA;
  releaseVersion: string;
  releaseId: string;
  registryVersion: string;
  packages: Array<{
    name: string;
    version: string;
    file: string;
    sha256: `sha256:${string}`;
    integrity: `sha512-${string}`;
  }>;
};

const args = process.argv.slice(2);
const lockArgument = argument("--lock");
if (!lockArgument) fail("--lock is required; bind the final merged NodeSlide release before running this gate");
const lockPath = resolve(lockArgument);
const jsonOut = argument("--json-out");

const lock = parseLock(await readJson(lockPath));
const artifactRoot = dirname(lockPath);
const manifestPath = resolve(artifactRoot, lock.manifestFile);
const manifestBytes = await readFile(manifestPath);
requireEqual(digest("sha256", manifestBytes), lock.manifestSha256, "manifest SHA-256");
const manifest = parseManifest(JSON.parse(manifestBytes.toString("utf8")));
requireEqual(manifest.releaseVersion, lock.releaseVersion, "release version");
requireEqual(manifest.registryVersion, lock.releaseVersion, "registry version");
requireEqual(manifest.releaseId, lock.nodeSlideCommit, "release commit");

const upgradeProofPath = resolve(artifactRoot, lock.installUpgradeProofFile);
const upgradeProofBytes = await readFile(upgradeProofPath);
requireEqual(digest("sha256", upgradeProofBytes), lock.installUpgradeProofSha256, "install-upgrade proof SHA-256");
const upgradeProof = parseUpgradeProof(JSON.parse(upgradeProofBytes.toString("utf8")));
requireEqual(upgradeProof.from.manifestSha256, lock.baselineManifestSha256, "baseline manifest SHA-256");
requireEqual(upgradeProof.to.manifestSha256, lock.manifestSha256, "candidate manifest SHA-256");
requireEqual(upgradeProof.to.releaseId, lock.nodeSlideCommit, "upgrade target commit");
requireEqual(upgradeProof.to.releaseVersion, lock.releaseVersion, "upgrade target version");

const byName = new Map(manifest.packages.map((entry) => [entry.name, entry]));
if (byName.size !== manifest.packages.length) fail("artifact manifest contains duplicate package names");
const verifiedArtifacts: Array<{ name: string; file: string; sha256: string; integrity: string }> = [];
for (const entry of manifest.packages) {
  requireEqual(entry.version, lock.releaseVersion, `${entry.name} version`);
  if (basename(entry.file) !== entry.file) fail(`${entry.name} artifact path must be a file name`);
  const bytes = await readFile(resolve(artifactRoot, entry.file));
  requireEqual(digest("sha256", bytes), entry.sha256, `${entry.name} SHA-256`);
  requireEqual(digest("sha512", bytes), entry.integrity, `${entry.name} npm integrity`);
  verifiedArtifacts.push({ name: entry.name, file: entry.file, sha256: entry.sha256, integrity: entry.integrity });
}

const runtimeEntries = lock.runtimePackages.map((name) => {
  const entry = byName.get(name);
  if (!entry) fail(`runtime package ${name} is absent from the artifact manifest`);
  return entry;
});

const nodeRoomPackageLock = record(await readJson(resolve("package-lock.json")), "NodeRoom package lock");
const packageRows = record(nodeRoomPackageLock.packages, "NodeRoom package lock packages");
const rootPackage = record(packageRows[""], "NodeRoom package lock root");
const rootDependencies = record(rootPackage.dependencies, "NodeRoom package lock dependencies");
for (const entry of runtimeEntries) {
  const expectedSpec = `file:${relative(process.cwd(), resolve(artifactRoot, entry.file)).split(sep).join("/")}`;
  requireEqual(rootDependencies[entry.name], expectedSpec, `${entry.name} root dependency pin`);
  const installed = record(packageRows[`node_modules/${entry.name}`], `${entry.name} package-lock row`);
  requireEqual(installed.version, lock.releaseVersion, `${entry.name} package-lock version`);
  requireEqual(installed.resolved, expectedSpec, `${entry.name} package-lock artifact`);
  requireEqual(installed.integrity, entry.integrity, `${entry.name} package-lock integrity`);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "noderoom-nodeslide-release-"));
let installedPackages: Array<{ name: string; version: string }> = [];
try {
  await writeFile(join(temporaryRoot, "package.json"), JSON.stringify({ private: true, type: "module" }));
  const npmCliCandidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const npmCli = npmCliCandidates.find((candidate) => existsSync(candidate));
  if (!npmCli) fail("npm-cli.js was not found; run this proof through npm");
  await execFileAsync(process.execPath, [npmCli,
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-save",
    "--package-lock=false",
    ...runtimeEntries.map((entry) => resolve(artifactRoot, entry.file)),
  ], { cwd: temporaryRoot, maxBuffer: 16 * 1024 * 1024 });

  installedPackages = await Promise.all(lock.runtimePackages.map(async (name) => {
    const packagePath = join(temporaryRoot, "node_modules", ...name.split("/"), "package.json");
    const identity = await readJson(packagePath) as { name?: unknown; version?: unknown };
    requireEqual(identity.name, name, `${name} installed identity`);
    requireEqual(identity.version, lock.releaseVersion, `${name} installed version`);
    return { name, version: lock.releaseVersion };
  }));

  const reactEntry = join(temporaryRoot, "node_modules", "@nodeslide", "react", "dist", "index.js");
  const convexEntry = join(temporaryRoot, "node_modules", "@nodeslide", "convex", "dist", "index.js");
  const componentEntry = join(temporaryRoot, "node_modules", "@nodeslide", "convex", "dist", "component.js");
  const reactPackage = await import(pathToFileURL(reactEntry).href);
  const convexPackage = await import(pathToFileURL(convexEntry).href);
  const componentPackage = await import(pathToFileURL(componentEntry).href);
  if (typeof reactPackage.NodeSlideStudioShell !== "function") fail("@nodeslide/react does not export NodeSlideStudioShell");
  if (convexPackage.NODESLIDE_CONVEX_COMPONENT_GOVERNANCE?.version !== "nodeslide.governance/v1") {
    fail("@nodeslide/convex governance declaration is missing");
  }
  if (componentPackage.NODESLIDE_COMPONENT_GRANT_VERSION !== "nodeslide.component-grant/v1") {
    fail("@nodeslide/convex component grant protocol is missing");
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

const nodeRoomCommit = await gitCommit(process.cwd());
const nodeRoomDirty = (await execFileAsync("git", ["status", "--porcelain"], { cwd: process.cwd() })).stdout.trim().length > 0;
const nodeSlideRoot = process.env.NODESLIDE_ROOT ? resolve(process.env.NODESLIDE_ROOT) : null;
const checkedNodeSlideCommit = nodeSlideRoot ? await gitCommit(nodeSlideRoot) : null;
if (checkedNodeSlideCommit) requireEqual(checkedNodeSlideCommit, lock.nodeSlideCommit, "checked-out NodeSlide commit");
if (process.env.NODESLIDE_COMMIT) requireEqual(process.env.NODESLIDE_COMMIT, lock.nodeSlideCommit, "NODESLIDE_COMMIT");

const receipt = {
  schemaVersion: "noderoom.nodeslide-mounted-release-proof/v1",
  nodeRoomCommit,
  nodeRoomDirty,
  nodeSlideCommit: lock.nodeSlideCommit,
  checkedNodeSlideCommit,
  releaseVersion: lock.releaseVersion,
  releaseId: manifest.releaseId,
  manifestSha256: lock.manifestSha256,
  installUpgradeProofSha256: lock.installUpgradeProofSha256,
  baselineManifestSha256: lock.baselineManifestSha256,
  packages: verifiedArtifacts,
  runtimePackages: installedPackages,
  proof: {
    manifestDigestVerified: true,
    everyArtifactDigestVerified: true,
    lockstepVersionVerified: true,
    freshInstallWithScriptsDisabled: true,
    controlledReactExportVerified: true,
    convexGovernanceExportVerified: true,
    componentGrantProtocolVerified: true,
    nodeRoomPackageLockPinsVerified: true,
    producerInstallUpgradeReceiptVerified: true,
    producerTamperRejectionVerified: upgradeProof.tamperedArtifactRejected,
    producerMixedReleaseRejectionVerified: upgradeProof.mixedReleaseRejected,
    exactNodeSlideCheckoutVerified: checkedNodeSlideCommit !== null,
    exactNodeRoomCommitRecorded: nodeRoomCommit !== null,
  },
};

const output = `${JSON.stringify(receipt, null, 2)}\n`;
if (jsonOut) await writeFile(resolve(jsonOut), output);
process.stdout.write(output);

function argument(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseLock(value: unknown): ReleaseLock {
  const lock = record(value, "release lock");
  requireEqual(lock.schemaVersion, LOCK_SCHEMA, "release lock schema");
  requireString(lock.nodeSlideCommit, "nodeSlideCommit", /^[0-9a-f]{40}$/u);
  requireString(lock.releaseVersion, "releaseVersion", /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u);
  requireString(lock.manifestFile, "manifestFile", /^[0-9A-Za-z._-]+\.json$/u);
  requireString(lock.manifestSha256, "manifestSha256", /^sha256:[0-9a-f]{64}$/u);
  requireString(lock.installUpgradeProofFile, "installUpgradeProofFile", /^[0-9A-Za-z._-]+\.json$/u);
  requireString(lock.installUpgradeProofSha256, "installUpgradeProofSha256", /^sha256:[0-9a-f]{64}$/u);
  requireString(lock.baselineManifestSha256, "baselineManifestSha256", /^sha256:[0-9a-f]{64}$/u);
  if (!Array.isArray(lock.runtimePackages) || lock.runtimePackages.length < 1 ||
    lock.runtimePackages.some((name) => typeof name !== "string") ||
    new Set(lock.runtimePackages).size !== lock.runtimePackages.length) {
    fail("runtimePackages must be a non-empty unique string array");
  }
  return lock as ReleaseLock;
}

function parseUpgradeProof(value: unknown): {
  from: { manifestSha256: string };
  to: { manifestSha256: string; releaseId: string; releaseVersion: string };
  tamperedArtifactRejected: true;
  mixedReleaseRejected: true;
} {
  const proof = record(value, "install-upgrade proof");
  requireEqual(proof.schemaVersion, "nodeslide.immutable-install-upgrade-proof/v1", "install-upgrade proof schema");
  const from = record(proof.from, "install-upgrade from");
  const to = record(proof.to, "install-upgrade to");
  requireString(from.manifestSha256, "upgrade baseline manifest SHA-256", /^sha256:[0-9a-f]{64}$/u);
  requireString(to.manifestSha256, "upgrade candidate manifest SHA-256", /^sha256:[0-9a-f]{64}$/u);
  requireString(to.releaseId, "upgrade candidate release ID", /^[0-9a-f]{40}$/u);
  requireString(to.releaseVersion, "upgrade candidate release version");
  for (const claim of [
    "cleanConsumer",
    "candidateCliController",
    "exactVersionPins",
    "lockfileIntegrityPins",
    "upgradeReceiptAdvanced",
    "tamperedArtifactRejected",
    "mixedReleaseRejected",
  ] as const) {
    requireEqual(proof[claim], true, `install-upgrade ${claim}`);
  }
  return {
    from: { manifestSha256: from.manifestSha256 },
    to: {
      manifestSha256: to.manifestSha256,
      releaseId: to.releaseId,
      releaseVersion: to.releaseVersion,
    },
    tamperedArtifactRejected: true,
    mixedReleaseRejected: true,
  };
}

function parseManifest(value: unknown): ArtifactManifest {
  const manifest = record(value, "artifact manifest");
  requireEqual(manifest.schemaVersion, MANIFEST_SCHEMA, "artifact manifest schema");
  requireString(manifest.releaseVersion, "releaseVersion");
  requireString(manifest.releaseId, "releaseId");
  requireString(manifest.registryVersion, "registryVersion");
  if (!Array.isArray(manifest.packages) || manifest.packages.length < 1) fail("artifact manifest packages are missing");
  for (const candidate of manifest.packages) {
    const entry = record(candidate, "artifact entry");
    requireString(entry.name, "package name", /^@nodeslide\/[a-z0-9-]+$/u);
    requireString(entry.version, "package version");
    requireString(entry.file, "package file", /^nodeslide-[a-z0-9-]+-[0-9A-Za-z.+-]+\.tgz$/u);
    requireString(entry.sha256, "package sha256", /^sha256:[0-9a-f]{64}$/u);
    requireString(entry.integrity, "package integrity", /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
  }
  return manifest as ArtifactManifest;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string, pattern?: RegExp): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || (pattern && !pattern.test(value))) fail(`${label} is invalid`);
}

function requireEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) fail(`${label} mismatch: expected ${String(expected)}, received ${String(actual)}`);
}

function digest(algorithm: "sha256" | "sha512", bytes: Buffer): string {
  return algorithm === "sha256"
    ? `sha256:${createHash(algorithm).update(bytes).digest("hex")}`
    : `sha512-${createHash(algorithm).update(bytes).digest("base64")}`;
}

async function gitCommit(cwd: string): Promise<string | null> {
  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
    const value = result.stdout.trim();
    return /^[0-9a-f]{40}$/u.test(value) ? value : null;
  } catch {
    return null;
  }
}

function fail(message: string): never {
  throw new Error(`NodeSlide mounted release proof failed: ${message}`);
}
