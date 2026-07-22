#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = process.cwd();
const candidatePath = resolve(requiredOption("--tarball"));
const producerPackagePath = resolve(requiredOption("--producer-package-json"));
const jsonOut = optionValue("--json-out");
const vendorRoot = resolve(root, "vendor", "nodekit-gym-core");
const producerManifest = object(readJson(producerPackagePath), "producer package.json");

assert(producerManifest.name === "@nodekit/gym-core", "candidate package name is invalid");
assert(
  typeof producerManifest.version === "string" && /^\d+\.\d+\.\d+$/u.test(producerManifest.version),
  "candidate package version is invalid",
);
assert(producerManifest.dependencies === undefined, "candidate must remain dependency-free");
assert(producerManifest.peerDependencies === undefined, "candidate must remain peer-free");
assert(existsSync(candidatePath), "candidate tarball does not exist");

const candidateBytes = readFileSync(candidatePath);
const sha256Digest = sha256(candidateBytes);
const npmIntegrity = integrity(candidateBytes);
const installed = inspectPackedCandidate(candidatePath);
assert(installed.manifest.name === producerManifest.name, "packed package name mismatch");
assert(installed.manifest.version === producerManifest.version, "packed package version mismatch");
assert(installed.manifest.dependencies === undefined, "packed candidate has runtime dependencies");
assert(installed.manifest.peerDependencies === undefined, "packed candidate has peer dependencies");

mkdirSync(vendorRoot, { recursive: true });
const artifactFile = `nodekit-gym-core-${producerManifest.version}.tgz`;
assert(/^nodekit-gym-core-\d+\.\d+\.\d+\.tgz$/u.test(artifactFile), "artifact filename is invalid");
const vendoredPath = resolve(vendorRoot, artifactFile);
assert(vendoredPath.startsWith(`${vendorRoot}${sep}`), "vendored artifact escaped its root");
copyFileSync(candidatePath, vendoredPath);
for (const entry of readdirSync(vendorRoot)) {
  if (/^nodekit-gym-core-\d+\.\d+\.\d+\.tgz$/u.test(entry) && entry !== artifactFile) {
    const obsolete = resolve(vendorRoot, entry);
    assert(obsolete.startsWith(`${vendorRoot}${sep}`), "obsolete artifact escaped its root");
    rmSync(obsolete);
  }
}

const dependencySpec = `file:vendor/nodekit-gym-core/${artifactFile}`;
const rootPackagePath = resolve(root, "package.json");
const rootPackage = object(readJson(rootPackagePath), "package.json");
const rootDependencies = object(rootPackage.dependencies, "package.json dependencies");
rootDependencies["@nodekit/gym-core"] = dependencySpec;
writeJson(rootPackagePath, rootPackage);

const packageLockPath = resolve(root, "package-lock.json");
const packageLock = object(readJson(packageLockPath), "package-lock.json");
assert(packageLock.lockfileVersion === 3, "package-lock must use lockfileVersion 3");
const packageRows = object(packageLock.packages, "package-lock packages");
const rootLock = object(packageRows[""], "package-lock root");
const lockDependencies = object(rootLock.dependencies, "package-lock root dependencies");
lockDependencies["@nodekit/gym-core"] = dependencySpec;
packageRows["node_modules/@nodekit/gym-core"] = {
  version: producerManifest.version,
  resolved: dependencySpec,
  integrity: npmIntegrity,
  license: typeof installed.manifest.license === "string" ? installed.manifest.license : "UNLICENSED",
};
writeJson(packageLockPath, packageLock);

const releaseLock = {
  schemaVersion: "noderoom.nodekit-gym-core-lock/v1",
  immutable: true,
  package: {
    name: "@nodekit/gym-core",
    version: producerManifest.version,
    artifactFile,
    sha256: sha256Digest,
    integrity: npmIntegrity,
    dependencySpec,
  },
  producer: {
    repository: "NodeSlide",
    packagePath: "packages/gym-core",
    packageJsonSha256: installed.packageJsonSha256,
    artifactIsAuthority: true,
  },
  governance: {
    mutableTagAllowed: false,
    workspaceLinkAllowed: false,
    autoApply: false,
  },
};
writeJson(resolve(vendorRoot, "release-lock.json"), releaseLock);

const receipt = {
  schemaVersion: "noderoom.node-gym-candidate-stage/v1",
  status: "prepared",
  package: releaseLock.package,
  producerPackageJson: {
    path: relative(root, producerPackagePath).replace(/\\/gu, "/"),
    packedDigest: installed.packageJsonSha256,
  },
  checks: {
    packedIdentityVerified: true,
    packedEntrypointsVerified: true,
    dependencyFree: true,
    peerFree: true,
    tarballCopiedByteForByte: sha256(readFileSync(vendoredPath)) === sha256Digest,
    releaseLockPrepared: true,
    packageJsonExactFilePinPrepared: true,
    packageLockExactIntegrityPrepared: true,
    npmCiVerificationRequired: true,
    directConsumerProofRequired: true,
  },
};

if (jsonOut) {
  const outputPath = resolve(root, jsonOut);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeJson(outputPath, receipt);
  console.log(`NodeRoom NodeGym candidate stage: PREPARED ${rel(outputPath)}`);
} else {
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

function inspectPackedCandidate(artifactPath) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "noderoom-nodegym-stage-"));
  const safeTemporaryPrefix = `${resolve(tmpdir())}${sep}`;
  assert(temporaryRoot.startsWith(safeTemporaryPrefix), "temporary install escaped the OS temp root");
  try {
    writeJson(resolve(temporaryRoot, "package.json"), { private: true, type: "module" });
    const npm = resolveNpmInvocation();
    execFileSync(
      npm.executable,
      [
        ...npm.prefixArgs,
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
    const installedRoot = resolve(temporaryRoot, "node_modules", "@nodekit", "gym-core");
    const packageJsonBytes = readFileSync(resolve(installedRoot, "package.json"));
    assert(existsSync(resolve(installedRoot, "dist", "index.js")), "packed JS entrypoint is missing");
    assert(existsSync(resolve(installedRoot, "dist", "index.d.ts")), "packed type entrypoint is missing");
    return {
      manifest: object(JSON.parse(packageJsonBytes.toString("utf8")), "packed package.json"),
      packageJsonSha256: sha256(packageJsonBytes),
    };
  } finally {
    assert(temporaryRoot.startsWith(safeTemporaryPrefix), "refusing to remove outside OS temp");
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function requiredOption(name) {
  const value = optionValue(name);
  if (!value) throw new Error(`NodeRoom NodeGym candidate stage failed: missing ${name}.`);
  return value;
}

function optionValue(name) {
  const prefix = `${name}=`;
  const equalArg = process.argv.find((arg) => arg.startsWith(prefix));
  if (equalArg) return equalArg.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveNpmInvocation() {
  if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
    return { executable: process.execPath, prefixArgs: [process.env.npm_execpath] };
  }
  return { executable: process.platform === "win32" ? "npm.cmd" : "npm", prefixArgs: [] };
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function integrity(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function object(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(`NodeRoom NodeGym candidate stage failed: ${message}.`);
}

function rel(filePath) {
  return relative(root, filePath).replace(/\\/gu, "/");
}
