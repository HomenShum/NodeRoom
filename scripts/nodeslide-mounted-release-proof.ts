import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { convexTest } from "convex-test";
import { componentsGeneric } from "convex/server";

const execFileAsync = promisify(execFile);
const LOCK_SCHEMA = "noderoom.nodeslide-release-lock/v1" as const;
const MANIFEST_SCHEMA = "nodeslide.artifacts/v1" as const;

type ReleaseLock = {
  schemaVersion: typeof LOCK_SCHEMA;
  releaseTag: string;
  releaseTagObject: string;
  nodeSlideCommit: string;
  releaseVersion: string;
  immutable: true;
  publicProofRunId: number;
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
const testingEntry = byName.get("@nodeslide/testing");
if (!testingEntry) fail("@nodeslide/testing is absent from the artifact manifest");

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
let isolatedComponentProof: Awaited<ReturnType<typeof runFreshIsolatedComponentProof>> | null = null;
const npmCli = resolveNpmCli();
try {
  await writeFile(join(temporaryRoot, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await execFileAsync(process.execPath, [npmCli,
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-save",
    "--package-lock=false",
    ...runtimeEntries.map((entry) => resolve(artifactRoot, entry.file)),
    resolve(artifactRoot, testingEntry.file),
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
  isolatedComponentProof = await runFreshIsolatedComponentProof(temporaryRoot);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
if (!isolatedComponentProof) fail("fresh isolated component proof did not complete");

const nodeRoomJourneyProof = await runNodeRoomJourneyTests(npmCli);

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
  releaseTag: lock.releaseTag,
  releaseTagObject: lock.releaseTagObject,
  immutable: lock.immutable,
  publicProofRunId: lock.publicProofRunId,
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
    isolatedComponent: isolatedComponentProof,
    nodeRoomJourney: nodeRoomJourneyProof,
    nodeRoomPackageLockPinsVerified: true,
    producerInstallUpgradeReceiptVerified: true,
    producerTamperRejectionVerified: upgradeProof.tamperedArtifactRejected,
    producerMixedReleaseRejectionVerified: upgradeProof.mixedReleaseRejected,
    producerCandidateRebuildMatchesPublicAssets:
      upgradeProof.candidateRebuildMatchesPublicAssets,
    exactNodeSlideCheckoutVerified: checkedNodeSlideCommit !== null,
    exactNodeRoomCommitRecorded: nodeRoomCommit !== null,
  },
};

const output = `${JSON.stringify(receipt, null, 2)}\n`;
if (jsonOut) await writeFile(resolve(jsonOut), output);
process.stdout.write(output);

async function runFreshIsolatedComponentProof(temporaryRoot: string) {
  const packageRoot = join(temporaryRoot, "node_modules", "@nodeslide");
  const componentRoot = join(packageRoot, "convex", "dist", "component");
  const testing = await import(
    pathToFileURL(join(packageRoot, "testing", "dist", "index.js")).href
  ) as {
    createNodeSlideTestSnapshot(deckId: string): {
      deck: { id: string; updatedAt: number; version: number };
      elements: Array<{ content?: unknown }>;
    };
    createNodeSlideTextPatch(
      snapshot: unknown,
      text: string,
      id?: string,
    ): { id: string; deckId: string; summary: string };
  };
  const componentProtocol = await import(
    pathToFileURL(join(packageRoot, "convex", "dist", "component.js")).href
  ) as {
    nodeSlideComponentPatchDigest(patch: unknown): Promise<string>;
  };
  const componentSchemaModule = await import(
    pathToFileURL(join(packageRoot, "convex", "dist", "componentSchema.js")).href
  ) as { default: Parameters<ReturnType<typeof convexTest>["registerComponent"]>[1] };

  const mounted = convexTest({
    modules: { "./_generated/server.js": async () => ({}) },
  });
  mounted.registerComponent("nodeslide", componentSchemaModule.default, {
    "./_generated/server.js": () => import(
      pathToFileURL(join(componentRoot, "_generated", "server.js")).href
    ),
    "./repository.js": () => import(
      pathToFileURL(join(componentRoot, "repository.js")).href
    ),
  });
  const repository = componentsGeneric().nodeslide.repository;
  const snapshot = testing.createNodeSlideTestSnapshot(
    "deck:noderoom:fresh-mounted-release",
  );
  const grant = (
    id: string,
    action: "deck.initialize" | "deck.read" | "patch.apply",
    resourceKind: "deck" | "patch",
    resourceId: string,
    authorizedAt: number,
    requestDigest?: string,
  ) => ({
    schemaVersion: "nodeslide.component-grant/v1" as const,
    id: `grant:noderoom:release:${id}`,
    principalId: "user:noderoom:release-proof",
    deckId: snapshot.deck.id,
    action,
    resource: { kind: resourceKind, id: resourceId },
    ...(requestDigest ? { requestDigest } : {}),
    authorizedAt,
    evidence: {
      issuer: "noderoom",
      policyId: "noderoom.nodeslide.artifact-authority",
      policyVersion: "1",
      evidenceId: `evidence:${id}`,
    },
  });

  await mounted.mutation(repository.initializeDeck, {
    snapshot,
    grant: grant(
      "initialize",
      "deck.initialize",
      "deck",
      snapshot.deck.id,
      snapshot.deck.updatedAt,
    ),
  });
  const patch = testing.createNodeSlideTextPatch(
    snapshot,
    "Fresh installed component accepted exact command",
    "patch:noderoom:fresh-mounted-release",
  );
  const patchDigest = await componentProtocol.nodeSlideComponentPatchDigest(patch);
  if (!/^sha256:[0-9a-f]{64}$/u.test(patchDigest)) {
    fail("fresh component returned a non-canonical patch digest");
  }
  const boundGrant = grant(
    "exact-patch",
    "patch.apply",
    "patch",
    patch.id,
    snapshot.deck.updatedAt + 1,
    patchDigest,
  );
  await requireRejected(
    () => mounted.mutation(repository.applyPatch, {
      deckId: snapshot.deck.id,
      patch: { ...patch, summary: "Substituted after authorization" },
      grant: boundGrant,
    }),
    /not bound/u,
    "substituted component command",
  );
  const applied = record(await mounted.mutation(repository.applyPatch, {
    deckId: snapshot.deck.id,
    patch,
    grant: boundGrant,
  }), "fresh component apply result");
  await requireRejected(
    () => mounted.mutation(repository.applyPatch, {
      deckId: snapshot.deck.id,
      patch,
      grant: boundGrant,
    }),
    /already consumed/u,
    "replayed component grant",
  );
  const reread = record(await mounted.query(repository.getDeck, {
    deckId: snapshot.deck.id,
    grant: grant(
      "read",
      "deck.read",
      "deck",
      snapshot.deck.id,
      snapshot.deck.updatedAt + 2,
    ),
  }), "fresh component reread");
  const rereadElements = reread.elements;
  if (
    !Array.isArray(rereadElements) ||
    !rereadElements.some((element) =>
      element && typeof element === "object" &&
      (element as Record<string, unknown>).content ===
        "Fresh installed component accepted exact command")
  ) {
    fail("fresh component exact command did not survive reread");
  }
  const componentReceipt = record(applied.receipt, "fresh component receipt");
  if (/requestDigest|requester|token|actorProof/iu.test(JSON.stringify(componentReceipt))) {
    fail("fresh component receipt leaked a grant digest or NodeRoom credential field");
  }

  return {
    mountedFromFreshInstall: true,
    initialized: true,
    patchDigestVerified: true,
    substitutedCommandRejectedBeforeConsumption: true,
    exactCommandAccepted: true,
    grantReplayRejected: true,
    rereadPreservedAcceptedEdit: true,
    receiptExcludedRequestDigest: true,
    actorProofNeverEnteredComponent: true,
  };
}

async function runNodeRoomJourneyTests(npmCli: string) {
  const testFiles = [
    "tests/nodeSlideMountedMemoryJourney.test.ts",
    "tests/nodeSlideMountedConvexJourney.test.ts",
    "tests/nodeSlideMountedIsolatedComponentJourney.test.ts",
    "tests/nodeSlideStudioMount.test.tsx",
  ];
  await execFileAsync(process.execPath, [
    npmCli,
    "test",
    "--",
    "--run",
    ...testFiles,
  ], {
    cwd: process.cwd(),
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    passed: true,
    testFiles,
    actorProofAndMembershipAuthorization: true,
    createAndManualEdit: true,
    existingNodeAgentReviewStayedUnappliedUntilAccept: true,
    activityAndCredentialFreeReceipts: true,
    reloadAndVersionHistory: true,
    presenterPptxReopenAndRevalidation: true,
    memoryAndConvexSemanticParity: true,
  };
}

async function requireRejected(
  operation: () => Promise<unknown>,
  expected: RegExp,
  label: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (expected.test(message)) return;
    fail(`${label} rejected for the wrong reason: ${message}`);
  }
  fail(`${label} did not reject`);
}

function resolveNpmCli(): string {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const npmCli = candidates.find((candidate) => existsSync(candidate));
  if (!npmCli) fail("npm-cli.js was not found; run this proof through npm");
  return npmCli;
}

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
  requireString(lock.releaseTag, "releaseTag", /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u);
  requireString(lock.releaseTagObject, "releaseTagObject", /^[0-9a-f]{40}$/u);
  requireString(lock.nodeSlideCommit, "nodeSlideCommit", /^[0-9a-f]{40}$/u);
  requireString(lock.releaseVersion, "releaseVersion", /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u);
  requireEqual(lock.releaseTag, `v${lock.releaseVersion}`, "release tag/version binding");
  requireEqual(lock.immutable, true, "immutable release flag");
  if (!Number.isSafeInteger(lock.publicProofRunId) || Number(lock.publicProofRunId) < 1) {
    fail("publicProofRunId is invalid");
  }
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
  candidateRebuildMatchesPublicAssets: true;
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
    "candidateRebuildMatchesPublicAssets",
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
    candidateRebuildMatchesPublicAssets: true,
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
