import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export type ProofloopPackageTargetId = "public-core" | "private-hosted";

export type ProofloopPackageTargetSpec = {
  id: ProofloopPackageTargetId;
  repoName: string;
  visibility: "public" | "private";
  purpose: string;
  includeFiles: string[];
  includeDirectories: string[];
  includePrefixes: string[];
  excludePrefixes: string[];
  requiredMissingComponents: string[];
};

export type ProofloopPackageManifest = {
  schema: "proofloop-multi-repo-package-v1";
  generatedAt: string;
  target: ProofloopPackageTargetId;
  repoName: string;
  visibility: "public" | "private";
  purpose: string;
  files: string[];
  fileCount: number;
  totalBytes: number;
  excludedPrefixes: string[];
  requiredMissingComponents: string[];
  publishCommands: string[];
};

export type ProofloopPackageWriteResult = {
  manifestPath: string;
  packageRoot: string;
  copiedFiles: string[];
};

type PackageOptions = {
  root?: string;
  now?: () => Date;
};

export const PROOFLOOP_PACKAGE_TARGETS: Record<ProofloopPackageTargetId, ProofloopPackageTargetSpec> = {
  "public-core": {
    id: "public-core",
    repoName: "proofloop",
    visibility: "public",
    purpose: "Open local Proof Loop Core: CLI, adapters, live browser proof, NodeTrace/NodeEval, cockpit, docs, and tests.",
    includeFiles: [
      ".github/workflows/proofloop.yml",
      ".gitignore",
      "AGENTS.md",
      "CLAUDE.md",
      "NODE-LOOPS.md",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "vite.config.ts",
      "vitest.config.ts",
      "docs/PROOFLOOP_MULTI_REPO_PACKAGING.md",
      "docs/PROOFLOOP_BUYER_VALIDATION.md",
      "docs/eval/PROOFLOOP_BENCHMARK_BOARD.md",
      "docs/eval/proofloop-benchmark-board.json",
      "docs/eval/bankertoolbench-official-contract.json",
      "docs/eval/official-benchmark-task-coverage.json",
      "docs/eval/OFFICIAL_BENCHMARK_TASK_COVERAGE.md",
      "docs/eval/official-benchmark-readiness.json",
      "docs/eval/OFFICIAL_BENCHMARK_READINESS.md",
      "scripts/bankertoolbench-manifest-lock.ts",
      "scripts/bankertoolbench-official-contract.ts",
      "scripts/commit-message.ts",
      "scripts/live-proofloop-runner.ts",
      "scripts/nodeagent-frame-smoke.ts",
      "scripts/official-benchmark-readiness.ts",
      "scripts/official-benchmark-task-coverage.ts",
      "scripts/official-benchmark-ui-coverage.ts",
      "scripts/omnigent-nodeagent-smoke.ts",
      "scripts/proofloop-adapter-blockers.ts",
      "scripts/proofloop-benchmark-board.ts",
      "scripts/proofloop-buyer-validation.ts",
      "scripts/proofloop-cli.ts",
      "scripts/proofloop-live-playwright.ts",
      "scripts/proofloop-memory.mjs",
      "scripts/proofloop-package.ts",
      "scripts/proofloop-runner.ts",
      "scripts/proofloop.mjs",
      "src/eval/bankerToolBenchAdapter.ts",
      "src/eval/bankerToolBenchManifestLock.ts",
      "src/eval/bankerToolBenchOfficialContract.ts",
      "src/eval/officialBenchmarkReadiness.ts",
      "src/eval/officialBenchmarkTaskCoverage.ts",
      "src/eval/officialBenchmarkUiCoverage.ts",
      "src/eval/proofloopAdapterBlockers.ts",
      "src/eval/proofloopAgentFriendlyCli.ts",
      "src/eval/proofloopAgentFriendlyProject.ts",
      "src/eval/proofloopArtifacts.ts",
      "src/eval/proofloopBenchmarkAdapters.ts",
      "src/eval/proofloopBenchmarkBoard.ts",
      "src/eval/proofloopBuyerValidation.ts",
      "src/eval/proofloopGoalSupervisor.ts",
      "src/eval/proofloopLoopArtifacts.ts",
      "src/eval/proofloopMultiRepoPackaging.ts",
      "tests/bankerToolBenchOfficialContract.test.ts",
      "tests/proofloopAdapterBlockers.test.ts",
      "tests/proofloopAgentFriendlyCli.test.ts",
      "tests/proofloopArtifacts.test.ts",
      "tests/proofloopBenchmarkBoard.test.ts",
      "tests/proofloopBuyerValidation.test.ts",
      "tests/proofloopGoalSupervisor.test.ts",
      "tests/proofloopLoopArtifacts.test.ts",
      "tests/proofloopPipeline.test.ts",
    ],
    includeDirectories: [
      "proofloop/accounting",
      "proofloop/adapters",
      "proofloop/benchmarks",
      "proofloop/cockpit",
      "proofloop/notion",
      "proofloop/rubrics",
      "proofloop/scenarios",
      "proofloop/storybook",
      "proofloop/suites",
    ],
    includePrefixes: [
      "proofloop/live-browser-proof.spec.ts",
      "src/nodeagent/core/",
      "src/nodeagent/traces/",
      "src/nodemem/",
    ],
    excludePrefixes: [
      ".proofloop/",
      ".tmp/",
      "docs/eval/fresh-room/",
      "docs/eval/gemini-media-judges/",
      "docs/eval/finance-model-runs/",
      "node_modules/",
      "test-results/",
    ],
    requiredMissingComponents: [],
  },
  "private-hosted": {
    id: "private-hosted",
    repoName: "proofloop-hosted",
    visibility: "private",
    purpose: "Hosted verification service lane: private benchmark packs, managed judges, storage, workers, tenant isolation, billing, and customer adapters.",
    includeFiles: [
      "docs/eval/official-benchmark-readiness.json",
      "docs/eval/OFFICIAL_BENCHMARK_READINESS.md",
      "docs/eval/official-benchmark-task-coverage.json",
      "docs/eval/OFFICIAL_BENCHMARK_TASK_COVERAGE.md",
      "docs/eval/bankertoolbench-official-contract.json",
      "docs/PROOFLOOP_MULTI_REPO_PACKAGING.md",
      "src/eval/bankerToolBenchAdapter.ts",
      "src/eval/bankerToolBenchManifestLock.ts",
      "src/eval/bankerToolBenchOfficialContract.ts",
      "src/eval/officialBenchmarkReadiness.ts",
      "src/eval/officialBenchmarkTaskCoverage.ts",
      "src/eval/proofloopAdapterBlockers.ts",
      "src/eval/proofloopBenchmarkAdapters.ts",
      "src/eval/proofloopBenchmarkBoard.ts",
      "src/eval/proofloopMultiRepoPackaging.ts",
      "tests/bankerToolBenchOfficialContract.test.ts",
      "tests/proofloopAdapterBlockers.test.ts",
      "tests/proofloopBenchmarkBoard.test.ts",
    ],
    includeDirectories: [
      "docs/eval/proofloop-adapter-blockers",
      "proofloop/benchmarks",
      "proofloop/rubrics",
    ],
    includePrefixes: [],
    excludePrefixes: [
      ".proofloop/",
      ".tmp/",
      "node_modules/",
      "test-results/",
    ],
    requiredMissingComponents: [
      "tenant-isolated Postgres schema",
      "object storage adapter for screenshots/videos/traces",
      "managed browser worker queue",
      "private benchmark pack loader",
      "managed judge fleet API",
      "billing/RBAC/audit-log service",
      "customer-owned storage adapter",
    ],
  },
};

export function buildProofloopPackageManifest(
  target: ProofloopPackageTargetId,
  options: PackageOptions = {},
): ProofloopPackageManifest {
  const root = resolve(options.root ?? process.cwd());
  const spec = PROOFLOOP_PACKAGE_TARGETS[target];
  const files = collectPackageFiles(root, spec);
  return {
    schema: "proofloop-multi-repo-package-v1",
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    target,
    repoName: spec.repoName,
    visibility: spec.visibility,
    purpose: spec.purpose,
    files,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + statSync(join(root, file)).size, 0),
    excludedPrefixes: spec.excludePrefixes,
    requiredMissingComponents: spec.requiredMissingComponents,
    publishCommands: publishCommandsFor(spec),
  };
}

export function writeProofloopPackage(
  manifest: ProofloopPackageManifest,
  options: { root?: string; outDir?: string; copyFiles?: boolean } = {},
): ProofloopPackageWriteResult {
  const root = resolve(options.root ?? process.cwd());
  const packageRoot = resolve(root, options.outDir ?? join(".proofloop", "packages", manifest.target));
  const manifestPath = join(packageRoot, "manifest.json");
  writeJson(manifestPath, manifest);

  const copiedFiles: string[] = [];
  if (options.copyFiles) {
    const repoRoot = join(packageRoot, "repo");
    rmSync(repoRoot, { recursive: true, force: true });
    for (const file of manifest.files) {
      const source = join(root, file);
      const destination = join(repoRoot, file);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      copiedFiles.push(relativePath(root, destination));
    }
  }

  return {
    manifestPath: relativePath(root, manifestPath),
    packageRoot: relativePath(root, packageRoot),
    copiedFiles,
  };
}

function collectPackageFiles(root: string, spec: ProofloopPackageTargetSpec): string[] {
  const files = new Set<string>();
  for (const file of spec.includeFiles) {
    if (existsSync(join(root, file)) && !isExcluded(file, spec)) files.add(file);
  }
  for (const directory of spec.includeDirectories) {
    for (const file of collectFilesUnder(root, directory)) {
      if (!isExcluded(file, spec)) files.add(file);
    }
  }
  for (const prefix of spec.includePrefixes) {
    if (existsSync(join(root, prefix)) && statSync(join(root, prefix)).isFile()) {
      if (!isExcluded(prefix, spec)) files.add(prefix);
    } else {
      for (const file of collectFilesUnder(root, prefix)) {
        if (!isExcluded(file, spec)) files.add(file);
      }
    }
  }
  return [...files].sort((a, b) => a.localeCompare(b));
}

function collectFilesUnder(root: string, relativePathPrefix: string): string[] {
  const absolute = join(root, relativePathPrefix);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [relativePathPrefix.replace(/\\/g, "/")];
  const out: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = `${relativePathPrefix.replace(/\\/g, "/")}/${entry.name}`;
    if (entry.isDirectory()) out.push(...collectFilesUnder(root, child));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

function isExcluded(file: string, spec: ProofloopPackageTargetSpec): boolean {
  const normalized = file.replace(/\\/g, "/");
  return spec.excludePrefixes.some((prefix) => normalized.startsWith(prefix));
}

function publishCommandsFor(spec: ProofloopPackageTargetSpec): string[] {
  const visibilityFlag = spec.visibility === "public" ? "--public" : "--private";
  const repoDir = `.proofloop/packages/${spec.id}/repo`;
  return [
    `npm run proofloop:package -- ${spec.id} --copy`,
    `git -C ${repoDir} init -b main`,
    `git -C ${repoDir} add .`,
    `git -C ${repoDir} commit -m "chore: publish Proof Loop ${spec.id} package"`,
    `gh repo create HomenShum/${spec.repoName} ${visibilityFlag} --source ${repoDir} --remote origin --push`,
  ];
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function relativePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, "/");
}

export function readProofloopPackageManifest(path: string): ProofloopPackageManifest {
  return JSON.parse(readFileSync(path, "utf8")) as ProofloopPackageManifest;
}
