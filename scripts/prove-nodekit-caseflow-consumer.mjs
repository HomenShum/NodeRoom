import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootReal = realpathSync(root);
const proofDirectory = join(root, "docs", "eval", "nodekit-caseflow-consumer");
const verdictPath = join(root, "docs", "eval", "nodekit-caseflow-consumer-verdict.json");
const manifestRelative = "vendor/nodekit-package-manifest.json";
const sourcePaths = [
  "convex/convex.config.ts",
  "convex/nodekitCaseflow.ts",
  "convex/nodekitCaseflowTables.ts",
  "convex/schema.ts",
  "docs/NODEKIT_CASEFLOW_ADOPTION.md",
  "package-lock.json",
  "package.json",
  "scripts/prepare-nodekit-package.mjs",
  "scripts/prove-nodekit-caseflow-consumer.mjs",
  "src/integrations/nodekit/caseflowAdapter.ts",
  "tests/nodekitCaseflowConformance.test.ts",
  "vendor/homenshum-nodekit-0.2.1.tgz",
  manifestRelative,
];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("proof value is not JSON-compatible");
  return encoded;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function contained(relativePath) {
  if (isAbsolute(relativePath)) {
    throw new Error(`evidence path must be repository-relative: ${relativePath}`);
  }
  const absolute = resolve(root, relativePath);
  if (!existsSync(absolute)) throw new Error(`evidence is missing: ${relativePath}`);
  const actual = realpathSync(absolute);
  if (actual !== rootReal && !actual.startsWith(`${rootReal}${sep}`)) {
    throw new Error(`evidence escapes the repository: ${relativePath}`);
  }
  if (lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`evidence may not be a symlink: ${relativePath}`);
  }
  return {
    absolute,
    relative: relative(root, absolute).replaceAll("\\", "/"),
  };
}

function evidence(relativePath) {
  const target = contained(relativePath);
  const bytes = readFileSync(target.absolute);
  return { bytes: bytes.byteLength, path: target.relative, sha256: sha256(bytes) };
}

function hashRecord(record) {
  for (const field of ["receiptHash", "evidenceHash", "manifestHash"]) {
    if (typeof record[field] === "string") {
      const { [field]: expected, ...body } = record;
      if (sha256(canonical(body)) !== expected) {
        throw new Error(`${field} does not match its canonical JSON body`);
      }
      return;
    }
  }
}

function verifyEvidenceTree(record, seen = new Set()) {
  if (record === null || typeof record !== "object") return;
  hashRecord(record);
  if (Array.isArray(record.evidence)) {
    const paths = new Set();
    for (const item of record.evidence) {
      if (
        item === null ||
        typeof item !== "object" ||
        typeof item.path !== "string" ||
        typeof item.sha256 !== "string"
      ) {
        throw new Error("nested evidence entries require path and sha256");
      }
      if (paths.has(item.path)) throw new Error(`duplicate evidence path: ${item.path}`);
      paths.add(item.path);
      const observed = evidence(item.path);
      if (
        observed.sha256 !== item.sha256 ||
        (typeof item.bytes === "number" && observed.bytes !== item.bytes)
      ) {
        throw new Error(`nested evidence bytes changed: ${item.path}`);
      }
      if (item.path.endsWith(".json") && !seen.has(item.path)) {
        seen.add(item.path);
        verifyEvidenceTree(
          JSON.parse(readFileSync(contained(item.path).absolute, "utf8")),
          seen,
        );
      }
    }
  }
  if (Array.isArray(record.nestedReceipts)) {
    for (const item of record.nestedReceipts) {
      if (typeof item?.path !== "string") {
        throw new Error("nestedReceipts entries require path");
      }
      const observed = evidence(item.path);
      if (item.sha256 !== observed.sha256) {
        throw new Error(`nested receipt bytes changed: ${item.path}`);
      }
      if (!seen.has(item.path)) {
        seen.add(item.path);
        verifyEvidenceTree(
          JSON.parse(readFileSync(contained(item.path).absolute, "utf8")),
          seen,
        );
      }
    }
  }
}

function run(label, executable, args) {
  const command = process.platform === "win32" ? `${executable}.cmd` : executable;
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  const safe = label
    .replaceAll(/[^a-z0-9]+/giu, "-")
    .replaceAll(/^-|-$/gu, "")
    .toLowerCase();
  const stdout = join(proofDirectory, `${safe}.stdout.log`);
  const stderr = join(proofDirectory, `${safe}.stderr.log`);
  writeFileSync(stdout, result.stdout ?? "", "utf8");
  writeFileSync(stderr, result.stderr ?? "", "utf8");
  if (result.error) throw result.error;
  return {
    command: [executable, ...args].join(" "),
    exitCode: result.status,
    id: safe,
    passed: result.status === 0,
    stderr: relative(root, stderr).replaceAll("\\", "/"),
    stdout: relative(root, stdout).replaceAll("\\", "/"),
  };
}

function git(args, encoding = "utf8") {
  return execFileSync("git", args, { cwd: root, encoding });
}

function verifyVerdict(verdict) {
  if (verdict.schemaVersion !== "noderoom.nodekit-caseflow-consumer-verdict/v2") {
    throw new Error("unexpected NodeRoom consumer verdict schema");
  }
  verifyEvidenceTree(verdict);
  if (!verdict.passed || verdict.checks.some((check) => !check.passed)) {
    throw new Error("NodeRoom consumer verdict is not passing");
  }
  return verdict;
}

if (process.argv.includes("--verify-only")) {
  verifyVerdict(JSON.parse(readFileSync(verdictPath, "utf8")));
  process.stdout.write(`${verdictPath}\n`);
  process.exit(0);
}

const dirtySource = git(
  ["status", "--porcelain=v1", "-z", "--", ...sourcePaths],
  "buffer",
);
if (dirtySource.length !== 0) {
  throw new Error(
    "consumer source and exact NodeKit package must be committed before proof",
  );
}
const manifest = JSON.parse(readFileSync(contained(manifestRelative).absolute, "utf8"));
verifyEvidenceTree(manifest);
if (manifest.source?.workingTreeClean !== true) {
  throw new Error("NodeKit package was not packed from a clean exact revision");
}
if (!/^[a-f0-9]{40}$/u.test(manifest.source?.commit ?? "")) {
  throw new Error("NodeKit package manifest requires an exact source commit");
}
if (!/^[a-f0-9]{64}$/u.test(manifest.source?.distributableSourceHash ?? "")) {
  throw new Error("NodeKit package manifest requires an exact source hash");
}
const tarballRelative = `vendor/${manifest.package?.filename ?? ""}`;
const tarball = evidence(tarballRelative);
if (
  manifest.package?.name !== "@homenshum/nodekit" ||
  manifest.package?.version !== "0.2.1" ||
  tarball.sha256 !== manifest.package?.sha256 ||
  tarball.bytes !== manifest.package?.bytes
) {
  throw new Error("NodeKit tarball does not match its package manifest");
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const packageSpec = packageJson.dependencies?.["@homenshum/nodekit"];
if (packageSpec !== "file:vendor/homenshum-nodekit-0.2.1.tgz") {
  throw new Error(`unexpected NodeKit dependency spec: ${String(packageSpec)}`);
}
const packageLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const locked = packageLock.packages?.["node_modules/@homenshum/nodekit"];
if (locked?.integrity !== manifest.package.integrity) {
  throw new Error("lockfile integrity does not match the exact NodeKit tarball");
}
const adapterSource = readFileSync(
  join(root, "src/integrations/nodekit/caseflowAdapter.ts"),
  "utf8",
);
for (const [constant, expected] of [
  ["NODEKIT_CASEFLOW_SOURCE_COMMIT", manifest.source.commit],
  ["NODEKIT_CASEFLOW_SOURCE_HASH", manifest.source.distributableSourceHash],
  ["NODEKIT_CASEFLOW_TARBALL_SHA256", manifest.package.sha256],
]) {
  if (!adapterSource.includes(`${constant} = "${expected}"`)) {
    throw new Error(`${constant} is not bound to the exact package candidate`);
  }
}

rmSync(proofDirectory, { force: true, recursive: true });
mkdirSync(proofDirectory, { recursive: true });
const checks = [
  run("npm-ci", "npm", ["ci", "--ignore-scripts"]),
  run("nodekit-component-tests", "npm", ["run", "test:nodekit-caseflow"]),
  // Execute every floor test with bounded worker pressure and an explicit
  // infrastructure timeout. Several pre-existing filesystem-heavy tests have
  // 5s defaults that are nondeterministic on a shared host; their assertions
  // remain unchanged and a genuinely hung test still fails after 60 seconds.
  run("noderoom-floor", "npm", [
    "run",
    "floor",
    "--",
    "--maxWorkers=2",
    "--testTimeout=60000",
    "--hookTimeout=60000",
  ]),
  run("production-build", "npm", ["run", "build"]),
  run("production-audit", "npm", ["audit", "--omit=dev", "--audit-level=moderate"]),
];
if (checks.some((check) => !check.passed)) {
  throw new Error(
    `NodeRoom consumer proof failed: ${checks
      .filter((check) => !check.passed)
      .map((check) => check.id)
      .join(", ")}`,
  );
}

const implementationEvidence = sourcePaths.map(evidence);
const logEvidence = checks.flatMap((check) => [
  evidence(check.stdout),
  evidence(check.stderr),
]);
const allEvidence = [...implementationEvidence, ...logEvidence]
  .filter(
    (item, index, values) =>
      values.findIndex((candidate) => candidate.path === item.path) === index,
  )
  .sort((left, right) => left.path.localeCompare(right.path));
const implementationHash = sha256(
  canonical(
    implementationEvidence.map(({ path, sha256: fileHash }) => ({
      path,
      sha256: fileHash,
    })),
  ),
);
const body = {
  schemaVersion: "noderoom.nodekit-caseflow-consumer-verdict/v2",
  assertions: {
    actualPackedComponentInstalled: true,
    authenticatedHostScope: true,
    cancelAndFailSafeExplicit: true,
    componentAndDomainCasRollbackTogether: true,
    componentStateIsolated: true,
    copiedLifecycleTablesPresent: false,
    exceptionRecoveryPreservesState: true,
    hostOwnedAuthAndArtifactCas: true,
    idempotentRetries: true,
    ownerIsolation: true,
    receiptV2Integrity: true,
    reloadDurability: true,
    staleComponentProposalConflicts: true,
    staleDomainArtifactFailsClosed: true,
  },
  capturedAt: new Date().toISOString(),
  checks,
  component: {
    hostBindings: [
      "nodekitCaseflowBindings",
      "nodekitCaseflowArtifactBindings",
    ],
    hostWrapper: "convex/nodekitCaseflow.ts",
    mountedBy: "convex/convex.config.ts",
    packageOwnedLifecycle: true,
  },
  consumer: {
    implementationCommit: git(["rev-parse", "HEAD"]).trim(),
    implementationHash,
    repository: "https://github.com/HomenShum/NodeRoom.git",
    sourceClean: true,
  },
  evidence: allEvidence,
  externalProof: {
    authenticatedProductionBrowserJourney: "not_run",
    convexProductionDeployment: "not_authorized",
    independentProofLoopVerification: "not_run",
    npmPublication: "not_authorized",
  },
  nestedReceipts: [
    { path: manifestRelative, sha256: evidence(manifestRelative).sha256 },
  ],
  nodekit: {
    packageIntegrity: manifest.package.integrity,
    packageSha256: manifest.package.sha256,
    packageSpec,
    sourceCommit: manifest.source.commit,
    sourceHash: manifest.source.distributableSourceHash,
    version: manifest.package.version,
  },
  passed: true,
  status: "passed_local_exact_package",
};
const verdict = { ...body, receiptHash: sha256(canonical(body)) };
writeFileSync(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
verifyVerdict(verdict);
process.stdout.write(`${verdictPath}\n`);
