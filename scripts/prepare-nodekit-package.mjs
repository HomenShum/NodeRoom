import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodekitRoot = path.resolve(
  process.argv[2] ?? path.join(root, "..", "..", "node-platform"),
);
const vendorDirectory = path.join(root, "vendor");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function digest(buffer, algorithm = "sha256") {
  return createHash(algorithm).update(buffer).digest("hex");
}

function run(command, args, cwd) {
  const packageManagerCli = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    command === "npx" ? "npx-cli.js" : "npm-cli.js",
  );
  const executable =
    command === "npm" || command === "npx" ? process.execPath : command;
  const executableArgs =
    command === "npm" || command === "npx"
      ? [packageManagerCli, ...args]
      : args;
  const result = spawnSync(executable, executableArgs, {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
}

await mkdir(vendorDirectory, { recursive: true });
run("npm", ["run", "build:component"], nodekitRoot);
const packageJson = JSON.parse(
  await readFile(path.join(nodekitRoot, "package.json"), "utf8"),
);
const sourceHashModule = await import(
  pathToFileURL(path.join(nodekitRoot, "src/lib/source-hash.mjs")).href
);
const sourceHashBeforePack = await sourceHashModule.computeNodeKitSourceHash(
  nodekitRoot,
);
const sourceCommitBeforePack = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: nodekitRoot,
  encoding: "utf8",
}).trim();
const sourceStatusBeforePack = execFileSync(
  "git",
  ["status", "--porcelain=v1", "-z"],
  { cwd: nodekitRoot, encoding: "buffer" },
);
const expectedFilename = `${packageJson.name
  .replace("@", "")
  .replace("/", "-")}-${packageJson.version}.tgz`;
const packagePath = path.join(vendorDirectory, expectedFilename);
await rm(packagePath, { force: true });
const packOutput = JSON.parse(
  run(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", vendorDirectory],
    nodekitRoot,
  ),
);
if (!Array.isArray(packOutput) || packOutput.length !== 1) {
  throw new Error("npm pack must produce exactly one package result");
}
const packed = packOutput[0];
if (packed.filename !== expectedFilename) {
  throw new Error(`unexpected package filename: ${packed.filename}`);
}

const packageBytes = await readFile(packagePath);
const sourceHash = await sourceHashModule.computeNodeKitSourceHash(nodekitRoot);
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: nodekitRoot,
  encoding: "utf8",
}).trim();
const sourceStatus = execFileSync(
  "git",
  ["status", "--porcelain=v1", "-z"],
  { cwd: nodekitRoot, encoding: "buffer" },
);
if (
  sourceCommit !== sourceCommitBeforePack ||
  sourceHash !== sourceHashBeforePack ||
  !sourceStatus.equals(sourceStatusBeforePack)
) {
  throw new Error(
    "NodeKit source or git status changed while npm pack was reading it; discard the archive and retry from a stable worktree",
  );
}
const packageStats = await stat(packagePath);
const manifestBody = {
  generatedAt: new Date().toISOString(),
  package: {
    bytes: packageStats.size,
    filename: expectedFilename,
    integrity: packed.integrity,
    name: packed.name,
    sha1: digest(packageBytes, "sha1"),
    sha256: digest(packageBytes),
    shasum: packed.shasum,
    version: packed.version,
  },
  schemaVersion: "noderoom.nodekit-package-candidate/v1",
  source: {
    commit: sourceCommit,
    distributableSourceHash: sourceHash,
    workingTreeClean: sourceStatus.length === 0,
  },
};
const manifest = { ...manifestBody, manifestHash: contentHash(manifestBody) };
await writeFile(
  path.join(vendorDirectory, "nodekit-package-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
