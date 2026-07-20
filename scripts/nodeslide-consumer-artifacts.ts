import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const NODESLIDE_TESTING_ARTIFACT = /^nodeslide-testing-([0-9A-Za-z.+-]+)\.tgz$/u;
const NODESLIDE_CLOSURE_ARTIFACT =
  /^nodeslide-(contracts|engine|backend|testing)-([0-9A-Za-z.+-]+)\.tgz$/u;
const NODESLIDE_RELEASE_ARTIFACT =
  /^nodeslide-(agent|contracts|engine|backend|client-http|convex|testing|react-headless|react|registry|cli)-([0-9A-Za-z.+-]+)\.tgz$/u;
const CLOSURE_ORDER = ["contracts", "engine", "backend", "testing"] as const;

type NodeSlideClosurePackage = (typeof CLOSURE_ORDER)[number];

export interface NodeSlidePackedArtifactSet {
  testingArtifact: string;
  installArtifacts: readonly string[];
}

/**
 * Resolve one publish-shaped @nodeslide/testing artifact and, for directory
 * input, its complete private dependency closure. Nothing is installed here.
 */
export async function resolveNodeSlidePackedArtifacts(
  input: string,
): Promise<NodeSlidePackedArtifactSet> {
  const candidate = resolve(input);
  const candidateStat = await stat(candidate);
  if (candidateStat.isFile()) {
    requireTestingArtifactName(candidate);
    return { testingArtifact: candidate, installArtifacts: [candidate] };
  }
  if (!candidateStat.isDirectory()) {
    throw new Error(`${candidate} is neither a file nor directory.`);
  }

  const packageArtifacts = new Map<
    NodeSlideClosurePackage,
    Array<{ path: string; version: string }>
  >();
  for (const entry of (await readdir(candidate)).sort()) {
    if (!entry.endsWith(".tgz")) continue;
    const releaseMatch = NODESLIDE_RELEASE_ARTIFACT.exec(entry);
    if (!releaseMatch) {
      throw new Error(
        `${candidate} contains unexpected tarball ${entry}; expected a versioned @nodeslide release artifact.`,
      );
    }
    const match = NODESLIDE_CLOSURE_ARTIFACT.exec(entry);
    // A complete immutable release directory may contain the larger package
    // family. The consumer proof installs only its exact testing closure.
    if (!match) continue;
    const packageName = match[1] as NodeSlideClosurePackage;
    const version = match[2];
    if (!version) throw new Error(`${entry} has no package version.`);
    const artifactPath = join(candidate, entry);
    if (!(await stat(artifactPath)).isFile()) {
      throw new Error(`${artifactPath} is not a package artifact file.`);
    }
    const entries = packageArtifacts.get(packageName) ?? [];
    entries.push({ path: artifactPath, version });
    packageArtifacts.set(packageName, entries);
  }

  const testing = packageArtifacts.get("testing") ?? [];
  if (testing.length !== 1) {
    throw new Error(
      `${candidate} must contain exactly one nodeslide-testing-*.tgz; found ${testing.length}.`,
    );
  }
  for (const packageName of CLOSURE_ORDER) {
    const artifacts = packageArtifacts.get(packageName) ?? [];
    if (artifacts.length !== 1) {
      throw new Error(
        `${candidate} must contain exactly one nodeslide-${packageName}-*.tgz; found ${artifacts.length}.`,
      );
    }
  }

  const testingVersion = testing[0]?.version;
  const mismatched = CLOSURE_ORDER.filter(
    (packageName) => packageArtifacts.get(packageName)?.[0]?.version !== testingVersion,
  );
  if (mismatched.length > 0) {
    throw new Error(
      `${candidate} mixes NodeSlide package versions; testing is ${testingVersion}, mismatched: ${mismatched.join(", ")}.`,
    );
  }

  const installArtifacts = CLOSURE_ORDER.map((packageName) => {
    const artifact = packageArtifacts.get(packageName)?.[0];
    if (!artifact) throw new Error(`Missing resolved @nodeslide/${packageName} artifact.`);
    return artifact.path;
  });
  return {
    testingArtifact: testing[0]?.path ?? join(candidate, `nodeslide-testing-${testingVersion}.tgz`),
    installArtifacts,
  };
}

function requireTestingArtifactName(candidate: string): void {
  if (!NODESLIDE_TESTING_ARTIFACT.test(basename(candidate))) {
    throw new Error(
      `${candidate} is not a nodeslide-testing-*.tgz artifact; pass the testing tarball or its closure directory.`,
    );
  }
}
