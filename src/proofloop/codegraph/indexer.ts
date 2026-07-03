import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  ProofloopCodeGraph,
  ProofloopCodeGraphEdge,
  ProofloopCodeGraphIndexOptions,
  ProofloopCodeGraphNode,
  ProofloopCodeGraphPaths,
  ProofloopCodeGraphQueryHit,
} from "./types";

const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".yaml",
  ".yml",
  ".css",
]);
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
  ".vercel",
  ".vite",
  ".tmp",
  ".tmp-qa",
  ".playwright-mcp",
]);

export function proofloopCodeGraphPaths(root: string): ProofloopCodeGraphPaths {
  const dir = join(root, ".proofloop", "codegraph");
  return {
    dir,
    manifestPath: join(dir, "graph-manifest.json"),
    nodesPath: join(dir, "nodes.json"),
    edgesPath: join(dir, "edges.json"),
    eventsPath: join(dir, "index-events.jsonl"),
  };
}

export function writeProofloopCodeGraph(options: ProofloopCodeGraphIndexOptions): ProofloopCodeGraph {
  const root = resolve(options.root);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const files = collectFiles(root, options.maxFiles ?? DEFAULT_MAX_FILES);
  const fileSet = new Set(files);
  const nodes: ProofloopCodeGraphNode[] = [];
  const edges: ProofloopCodeGraphEdge[] = [];

  for (const file of files) {
    const content = readIndexableFile(root, file, options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
    const nodeId = fileNodeId(file);
    nodes.push({
      id: nodeId,
      kind: proofArtifactPath(file) ? "proof_artifact" : "file",
      label: file,
      path: file,
      metadata: {
        extension: extensionOf(file),
        searchText: buildSearchText(file, content),
        lineCount: content ? content.split(/\r?\n/).length : 0,
      },
    });

    if (!content) continue;
    for (const imported of extractImports(file, content, fileSet)) {
      edges.push({ from: nodeId, to: fileNodeId(imported), kind: "imports" });
    }
    for (const symbol of extractSymbols(content)) {
      const symbolId = `symbol:${file}#${symbol}`;
      nodes.push({
        id: symbolId,
        kind: "symbol",
        label: symbol,
        path: file,
        metadata: { file, searchText: `${symbol} ${file}` },
      });
      edges.push({ from: nodeId, to: symbolId, kind: "declares" });
    }
    for (const selector of extractSelectors(content)) {
      const selectorId = `selector:${selector}`;
      if (!nodes.some((node) => node.id === selectorId)) {
        nodes.push({
          id: selectorId,
          kind: "selector",
          label: selector,
          metadata: { searchText: selector },
        });
      }
      edges.push({ from: nodeId, to: selectorId, kind: "exposes_selector" });
    }
  }

  const packageJson = files.find((file) => file === "package.json");
  if (packageJson) {
    for (const script of extractPackageScripts(root)) {
      const scriptId = `script:${script.name}`;
      nodes.push({
        id: scriptId,
        kind: "script",
        label: script.name,
        path: "package.json",
        metadata: { command: script.command, searchText: `${script.name} ${script.command}` },
      });
      edges.push({ from: fileNodeId("package.json"), to: scriptId, kind: "runs_script" });
    }
  }

  const graph: ProofloopCodeGraph = {
    schema: "proofloop-codegraph-v1",
    root,
    generatedAt,
    nodes: dedupeNodes(nodes),
    edges: dedupeEdges(edges),
    summary: {
      fileCount: nodes.filter((node) => node.kind === "file").length,
      scriptCount: nodes.filter((node) => node.kind === "script").length,
      symbolCount: nodes.filter((node) => node.kind === "symbol").length,
      selectorCount: nodes.filter((node) => node.kind === "selector").length,
      proofArtifactCount: nodes.filter((node) => node.kind === "proof_artifact").length,
    },
  };

  const paths = proofloopCodeGraphPaths(root);
  mkdirSync(paths.dir, { recursive: true });
  writeJson(paths.manifestPath, {
    schema: graph.schema,
    root: graph.root,
    generatedAt: graph.generatedAt,
    summary: graph.summary,
    files: {
      nodes: relativePath(root, paths.nodesPath),
      edges: relativePath(root, paths.edgesPath),
      events: relativePath(root, paths.eventsPath),
    },
  });
  writeJson(paths.nodesPath, graph.nodes);
  writeJson(paths.edgesPath, graph.edges);
  writeFileSync(
    paths.eventsPath,
    `${JSON.stringify({
      ts: generatedAt,
      type: "codegraph_indexed",
      fileCount: graph.summary.fileCount,
      scriptCount: graph.summary.scriptCount,
      symbolCount: graph.summary.symbolCount,
    })}\n`,
    "utf8",
  );

  return graph;
}

export function queryProofloopCodeGraph(
  graph: ProofloopCodeGraph,
  query: string,
  limit = 12,
): ProofloopCodeGraphQueryHit[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const hits = graph.nodes
    .map((node) => scoreNode(node, tokens))
    .filter((hit): hit is ProofloopCodeGraphQueryHit => Boolean(hit))
    .sort((a, b) => b.score - a.score || (a.path ?? a.label).localeCompare(b.path ?? b.label));
  return hits.slice(0, limit);
}

function collectFiles(root: string, maxFiles: number): string[] {
  const rg = spawnSync("rg", ["--files"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const raw = rg.status === 0 && rg.stdout ? rg.stdout.split(/\r?\n/) : walkFiles(root);
  return raw
    .map(normalizeSlash)
    .filter(Boolean)
    .filter((file) => shouldIndexFile(file))
    .slice(0, maxFiles)
    .sort((a, b) => a.localeCompare(b));
}

function walkFiles(root: string, prefix = ""): string[] {
  const dir = join(root, prefix);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walkFiles(root, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

function shouldIndexFile(file: string): boolean {
  const parts = file.split("/");
  if (parts.some((part) => SKIP_DIRS.has(part))) return false;
  if (file.startsWith(".proofloop/") && !file.startsWith(".proofloop/lanes/")) return false;
  if (file === "package.json" || file === ".gitignore" || file.endsWith("AGENTS.md")) return true;
  return SOURCE_EXTENSIONS.has(extensionOf(file));
}

function readIndexableFile(root: string, file: string, maxBytes: number): string {
  const path = join(root, file);
  try {
    const stat = statSync(path);
    if (stat.size > maxBytes) return "";
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function extractPackageScripts(root: string): Array<{ name: string; command: string }> {
  try {
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    return Object.entries(parsed.scripts ?? {})
      .map(([name, command]) => ({ name, command }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function extractImports(file: string, content: string, fileSet: Set<string>): string[] {
  const imports = new Set<string>();
  const patterns = [
    /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
    /require\(["']([^"']+)["']\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const resolved = resolveImport(file, match[1], fileSet);
      if (resolved) imports.add(resolved);
    }
  }
  return [...imports].sort();
}

function resolveImport(file: string, specifier: string, fileSet: Set<string>): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = normalizeSlash(join(dirname(file), specifier));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}.json`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
  ];
  return candidates.find((candidate) => fileSet.has(normalizeSlash(candidate)));
}

function extractSymbols(content: string): string[] {
  const symbols = new Set<string>();
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g,
    /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) symbols.add(match[1]);
  }
  return [...symbols].sort();
}

function extractSelectors(content: string): string[] {
  const selectors = new Set<string>();
  for (const match of content.matchAll(/data-(?:testid|proofloop|qa)=["']([^"']+)["']/g)) {
    selectors.add(match[1]);
  }
  return [...selectors].sort();
}

function buildSearchText(file: string, content: string): string {
  const keywords = new Set(tokenize(file));
  for (const token of tokenize(content).slice(0, 600)) keywords.add(token);
  return [...keywords].join(" ");
}

function scoreNode(node: ProofloopCodeGraphNode, tokens: string[]): ProofloopCodeGraphQueryHit | undefined {
  const path = node.path ?? "";
  const metadataText = String(node.metadata.searchText ?? "");
  let score = 0;
  const reasons: string[] = [];
  for (const token of tokens) {
    if (path.toLowerCase().includes(token)) {
      score += 4;
      reasons.push(`path:${token}`);
    }
    if (node.label.toLowerCase().includes(token)) {
      score += 3;
      reasons.push(`label:${token}`);
    }
    if (metadataText.toLowerCase().includes(token)) {
      score += 1;
    }
  }
  if (node.kind === "script" && tokens.some((token) => token.includes("benchmark") || token.includes("proofloop"))) {
    score += 3;
    reasons.push("script");
  }
  if (node.kind === "proof_artifact") {
    score += 1;
    reasons.push("proof-artifact");
  }
  if (score <= 0) return undefined;
  return { nodeId: node.id, kind: node.kind, label: node.label, path: node.path, score, reasons: [...new Set(reasons)] };
}

function proofArtifactPath(file: string): boolean {
  return file.startsWith(".proofloop/lanes/") || file.startsWith("docs/eval/") || file.startsWith("proofloop/");
}

function fileNodeId(file: string): string {
  return `file:${normalizeSlash(file)}`;
}

function dedupeNodes(nodes: ProofloopCodeGraphNode[]): ProofloopCodeGraphNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()];
}

function dedupeEdges(edges: ProofloopCodeGraphEdge[]): ProofloopCodeGraphEdge[] {
  return [...new Map(edges.map((edge) => [`${edge.from}|${edge.kind}|${edge.to}`, edge])).values()];
}

function tokenize(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    ),
  ];
}

function extensionOf(file: string): string {
  const dot = file.lastIndexOf(".");
  return dot >= 0 ? file.slice(dot).toLowerCase() : "";
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function relativePath(root: string, path: string): string {
  const normalizedRoot = normalizeSlash(resolve(root));
  const normalizedPath = normalizeSlash(resolve(path));
  return normalizedPath.startsWith(normalizedRoot)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}
