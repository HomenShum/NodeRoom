import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { buildNodeRoomGymConsumerProof } from "../src/integrations/nodegym/nodeRoomGymConsumer";

interface NodeGymReleaseLock {
  schemaVersion: "noderoom.nodekit-gym-core-lock/v1";
  immutable: true;
  package: {
    name: "@nodekit/gym-core";
    version: string;
    artifactFile: string;
    sha256: string;
    integrity: string;
    dependencySpec: string;
  };
  producer: {
    repository: "NodeSlide";
    packagePath: "packages/gym-core";
    packageJsonSha256: string;
    artifactIsAuthority: true;
  };
  governance: {
    mutableTagAllowed: false;
    workspaceLinkAllowed: false;
    autoApply: false;
  };
}

const args = process.argv.slice(2);
const jsonOut = optionValue("--json-out");
const root = process.cwd();
const vendorRoot = resolve(root, "vendor", "nodekit-gym-core");
const lockPath = resolve(vendorRoot, "release-lock.json");
const lock = parseLock(readJson(lockPath));
const artifactPath = resolve(vendorRoot, lock.package.artifactFile);
assert(
  artifactPath.startsWith(`${vendorRoot}${sep}`),
  "artifact path escaped vendor/nodekit-gym-core",
);
const artifactBytes = readFileSync(artifactPath);
assertEqual(sha256(artifactBytes), lock.package.sha256, "tarball SHA-256");
assertEqual(integrity(artifactBytes), lock.package.integrity, "tarball npm integrity");

const rootPackage = record(readJson(resolve(root, "package.json")), "package.json");
const dependencies = record(rootPackage.dependencies, "package.json dependencies");
assertEqual(dependencies[lock.package.name], lock.package.dependencySpec, "exact dependency pin");

const packageLock = record(readJson(resolve(root, "package-lock.json")), "package-lock.json");
const packageRows = record(packageLock.packages, "package-lock packages");
const lockRoot = record(packageRows[""], "package-lock root");
const lockDependencies = record(lockRoot.dependencies, "package-lock root dependencies");
assertEqual(
  lockDependencies[lock.package.name],
  lock.package.dependencySpec,
  "package-lock dependency pin",
);
const installedRow = record(
  packageRows[`node_modules/${lock.package.name}`],
  "package-lock @nodekit/gym-core row",
);
assertEqual(installedRow.version, lock.package.version, "package-lock version");
assertEqual(installedRow.resolved, lock.package.dependencySpec, "package-lock tarball");
assertEqual(installedRow.integrity, lock.package.integrity, "package-lock integrity");

const freshInstall = verifyFreshInstall(artifactPath, lock);
const domainProof = buildNodeRoomGymConsumerProof();
assertEqual(domainProof.package.version, lock.package.version, "runtime package version");

const receipt = {
  schemaVersion: "noderoom.node-gym-packed-consumer-proof/v1",
  package: {
    name: lock.package.name,
    version: lock.package.version,
    artifactFile: relative(root, artifactPath).replace(/\\/gu, "/"),
    sha256: lock.package.sha256,
    integrity: lock.package.integrity,
    dependencySpec: lock.package.dependencySpec,
  },
  immutableInstall: {
    lockMetadataVerified: true,
    artifactDigestVerified: true,
    packageJsonExactFilePinVerified: true,
    packageLockVersionVerified: true,
    packageLockIntegrityVerified: true,
    freshInstallWithScriptsDisabled: true,
    freshInstallDependencyFree: freshInstall.dependencyFree,
    freshInstallExportsVerified: freshInstall.exportsVerified,
    packedPackageJsonDigestVerified: freshInstall.packageJsonDigestVerified,
    mutableTagUsed: false,
    workspaceLinkUsed: false,
  },
  nodeRoomJourney: domainProof,
};

const output = `${JSON.stringify(receipt, null, 2)}\n`;
if (jsonOut) {
  const outputPath = resolve(root, jsonOut);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output);
  console.log(`NodeRoom NodeGym consumer proof: PASS wrote ${rel(outputPath)}`);
} else {
  process.stdout.write(output);
}

function verifyFreshInstall(artifactPath: string, lock: NodeGymReleaseLock) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "noderoom-nodegym-consumer-"));
  try {
    writeFileSync(
      join(temporaryRoot, "package.json"),
      `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
    );
    execFileSync(
      process.execPath,
      [
        resolveNpmCli(),
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-save",
        "--package-lock=false",
        "--offline",
        artifactPath,
      ],
      { cwd: temporaryRoot, stdio: "pipe" },
    );
    const installedRoot = join(
      temporaryRoot,
      "node_modules",
      ...lock.package.name.split("/"),
    );
    const packageJsonPath = join(installedRoot, "package.json");
    const packageJsonBytes = readFileSync(packageJsonPath);
    assertEqual(
      sha256(packageJsonBytes),
      lock.producer.packageJsonSha256,
      "packed package.json SHA-256",
    );
    const identity = record(JSON.parse(packageJsonBytes.toString("utf8")), "fresh package identity");
    assertEqual(identity.name, lock.package.name, "fresh package name");
    assertEqual(identity.version, lock.package.version, "fresh package version");
    const dependencies = identity.dependencies;
    assert(
      dependencies === undefined || Object.keys(record(dependencies, "fresh dependencies")).length === 0,
      "fresh package unexpectedly has runtime dependencies",
    );
    const entryUrl = pathToFileURL(join(installedRoot, "dist", "index.js")).href;
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        [
          `const core = await import(${JSON.stringify(entryUrl)});`,
          `if (core.NODE_GYM_CORE_PACKAGE_VERSION !== ${JSON.stringify(lock.package.version)}) process.exit(2);`,
          "if (typeof core.buildNodeGymMatrix !== 'function') process.exit(3);",
          "if (typeof core.adaptNodeGymRunnerReceipt !== 'function') process.exit(4);",
          "if (typeof core.assertPairedHarnessRuns !== 'function') process.exit(5);",
          "if (typeof core.proposeNodeGymPromotion !== 'function') process.exit(6);",
          "if (typeof core.buildNodeGymTrainingPair !== 'function') process.exit(7);",
          "if (typeof core.runNodeGymCheckpointReplay !== 'function') process.exit(8);",
          "if (typeof core.selectNodeGymGovernedRoute !== 'function') process.exit(9);",
          "if (typeof core.nodeGymEscalationDecision !== 'function') process.exit(10);",
        ].join("\n"),
      ],
      { cwd: temporaryRoot, stdio: "pipe" },
    );
    return { dependencyFree: true, exportsVerified: true, packageJsonDigestVerified: true };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function parseLock(value: unknown): NodeGymReleaseLock {
  const lock = record(value, "NodeGym release lock");
  assertEqual(lock.schemaVersion, "noderoom.nodekit-gym-core-lock/v1", "lock schema");
  assertEqual(lock.immutable, true, "immutable flag");
  const packageEntry = record(lock.package, "lock package");
  assertEqual(packageEntry.name, "@nodekit/gym-core", "package name");
  assert(typeof packageEntry.version === "string" && /^\d+\.\d+\.\d+$/u.test(packageEntry.version), "package version is invalid");
  assert(typeof packageEntry.artifactFile === "string" && /^nodekit-gym-core-\d+\.\d+\.\d+\.tgz$/u.test(packageEntry.artifactFile), "artifact file is invalid");
  assert(typeof packageEntry.sha256 === "string" && /^sha256:[0-9a-f]{64}$/u.test(packageEntry.sha256), "artifact SHA-256 is invalid");
  assert(typeof packageEntry.integrity === "string" && /^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(packageEntry.integrity), "artifact integrity is invalid");
  assertEqual(
    packageEntry.dependencySpec,
    `file:vendor/nodekit-gym-core/${String(packageEntry.artifactFile)}`,
    "dependency spec",
  );
  const producer = record(lock.producer, "lock producer");
  assertEqual(producer.repository, "NodeSlide", "producer repository");
  assertEqual(producer.packagePath, "packages/gym-core", "producer package path");
  assert(typeof producer.packageJsonSha256 === "string" && /^sha256:[0-9a-f]{64}$/u.test(producer.packageJsonSha256), "producer package.json SHA-256 is invalid");
  assertEqual(producer.artifactIsAuthority, true, "artifact authority");
  const governance = record(lock.governance, "lock governance");
  assertEqual(governance.mutableTagAllowed, false, "mutable-tag policy");
  assertEqual(governance.workspaceLinkAllowed, false, "workspace-link policy");
  assertEqual(governance.autoApply, false, "auto-apply policy");
  return lock as unknown as NodeGymReleaseLock;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function record(value: unknown, label: string): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`NodeRoom NodeGym consumer proof failed: ${message}.`);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  assert(actual === expected, `${label} mismatch; expected ${String(expected)}, received ${String(actual)}`);
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function integrity(bytes: Buffer): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function resolveNpmCli(): string {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const npmCli = candidates.find((candidate) => existsSync(candidate));
  assert(npmCli, "npm-cli.js was not found; run this proof through npm");
  return npmCli;
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const equalArg = args.find((arg) => arg.startsWith(prefix));
  if (equalArg) return equalArg.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function rel(path: string): string {
  return relative(root, path).replace(/\\/gu, "/");
}
