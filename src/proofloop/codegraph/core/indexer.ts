/**
 * Code-graph indexer — TypeScript Compiler API extraction.
 *
 * Syntax-level parse only (ts.createSourceFile per file). Deliberately NOT a
 * type-checking ts.createProgram: exact-enough for imports/exports/JSX/data-testid
 * and fast enough to run inside the Proof Loop (docs/architecture/CODE_GRAPH_SUBSTRATE.md).
 *
 * Extracted per file:
 *   (a) import declarations (and `export ... from` re-exports) with deterministic
 *       relative + tsconfig-paths resolution; bare package imports are skipped.
 *   (b) exported symbol names (functions, consts, classes, types, default).
 *   (c) capitalized JSX tags → renders edges (linked to the imported source when the
 *       tag matches an import; otherwise an unresolved symbol node).
 *   (d) data-testid string literals → selector nodes + has_selector edges.
 *   (e) best-effort route detection: `<Route path="...">` JSX props (jsx-route-path)
 *       and route-table `path: "/..."` literals (route-table-path-literal). The
 *       matched pattern is recorded on the node's detail field — heuristic, honest.
 *
 * Known v0 limitation (documented in the design doc): barrel re-exports resolve one
 * hop at a time, so a component imported through a barrel links to the barrel file.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import {
  componentNodeId,
  edgeId,
  fileNodeId,
  normalizeGraphPath,
  routeNodeId,
  selectorNodeId,
  symbolNodeId,
  unresolvedSymbolNodeId,
  type CodeGraphEdge,
  type CodeGraphEdgeKind,
  type CodeGraphNode,
  type CodeGraphProvenance,
  type CodeGraphSource,
} from "./types";

export interface IndexSourceTreeOptions {
  /** Absolute path to the repo root the index is relative to. */
  root: string;
  /** Include globs relative to root. Defaults to the repo surfaces ProofLoop repairs touch. */
  include?: string[];
  indexRunId: string;
  commit: string;
  /** Ingestion timestamp for this run; defaults to now. */
  indexedAt?: string;
}

export interface IndexSourceTreeResult {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  fileCount: number;
}

const DEFAULT_INCLUDE = [
  "*.ts",
  "*.tsx",
  "src/**/*.ts",
  "src/**/*.tsx",
  "scripts/**/*.ts",
  "tests/**/*.ts",
  "tests/**/*.tsx",
  "evals/**/*.ts",
  "e2e/**/*.ts",
  "packages/**/*.ts",
  "packages/**/*.tsx",
  "convex/**/*.ts",
  "noderl/**/*.ts",
];
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".proofloop",
  "coverage",
  "playwright-report",
  "test-results",
  ".vercel",
  ".vite",
]);
const RESOLUTION_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"];
const ROUTE_TABLE_PATTERN = /\bpath\s*:\s*["'`](\/[^"'`]*)["'`]/g;

export function indexSourceTree(options: IndexSourceTreeOptions): IndexSourceTreeResult {
  const root = resolve(options.root);
  const include = options.include ?? DEFAULT_INCLUDE;
  const indexedAt = options.indexedAt ?? new Date().toISOString();
  const matchers = include.map(globToRegExp);
  const files = walkFiles(root, matchers).sort();
  const pathAliases = readTsconfigPathAliases(root);

  const nodes = new Map<string, CodeGraphNode>();
  const edges = new Map<string, CodeGraphEdge>();
  const provenanceFor = (source: CodeGraphSource): CodeGraphProvenance => ({
    indexRunId: options.indexRunId,
    commit: options.commit,
    source,
  });
  const addNode = (node: CodeGraphNode): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (kind: CodeGraphEdgeKind, from: string, to: string, source: CodeGraphSource): void => {
    const id = edgeId(kind, from, to);
    if (edges.has(id)) return;
    edges.set(id, {
      id,
      kind,
      from,
      to,
      validFromCommit: options.commit,
      invalidatedAtCommit: null,
      firstIndexedAt: indexedAt,
      lastIndexedAt: indexedAt,
      provenance: provenanceFor(source),
    });
  };

  for (const relPath of files) {
    const absPath = join(root, relPath);
    const text = readFileSync(absPath, "utf-8");
    indexOneFile({ root, relPath, absPath, text, pathAliases, addNode, addEdge, provenanceFor });
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    fileCount: files.length,
  };
}

// ─── Per-file extraction ────────────────────────────────────────────────────

type ImportBinding = { resolvedFile?: string; external: boolean };

function indexOneFile(args: {
  root: string;
  relPath: string;
  absPath: string;
  text: string;
  pathAliases: PathAlias[];
  addNode: (node: CodeGraphNode) => void;
  addEdge: (kind: CodeGraphEdgeKind, from: string, to: string, source: CodeGraphSource) => void;
  provenanceFor: (source: CodeGraphSource) => CodeGraphProvenance;
}): void {
  const { root, relPath, absPath, text, pathAliases, addNode, addEdge, provenanceFor } = args;
  const fileId = fileNodeId(relPath);
  addNode({
    id: fileId,
    kind: "file",
    label: relPath.split("/").pop() ?? relPath,
    filePath: relPath,
    provenance: provenanceFor("static_parse"),
  });

  const scriptKind = absPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, scriptKind);
  const importsByLocalName = new Map<string, ImportBinding>();
  const importedFiles = new Set<string>();

  const recordModuleSpecifier = (specifier: string): ImportBinding => {
    const resolved = resolveModuleSpecifier({ specifier, fromDir: dirname(absPath), root, pathAliases });
    if (resolved === "external") return { external: true };
    if (!resolved) return { external: false };
    if (!importedFiles.has(resolved)) {
      importedFiles.add(resolved);
      addNode({
        id: fileNodeId(resolved),
        kind: "file",
        label: resolved.split("/").pop() ?? resolved,
        filePath: resolved,
        provenance: provenanceFor("static_parse"),
      });
      addEdge("imports", fileId, fileNodeId(resolved), "static_parse");
    }
    return { external: false, resolvedFile: resolved };
  };

  const addExport = (name: string): void => {
    const id = symbolNodeId(relPath, name);
    addNode({ id, kind: "symbol", label: name, filePath: relPath, provenance: provenanceFor("static_parse") });
    addEdge("exports", fileId, id, "static_parse");
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const binding = recordModuleSpecifier(node.moduleSpecifier.text);
      const clause = node.importClause;
      if (clause?.name) importsByLocalName.set(clause.name.text, binding);
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          importsByLocalName.set(clause.namedBindings.name.text, binding);
        } else {
          for (const element of clause.namedBindings.elements) {
            importsByLocalName.set(element.name.text, binding);
          }
        }
      }
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        recordModuleSpecifier(node.moduleSpecifier.text);
      }
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) addExport(element.name.text);
      }
      // `export * from "./x"` re-exports resolve one hop at a time in v0 (design doc risk note).
    } else if (ts.isExportAssignment(node) && !node.isExportEquals) {
      addExport("default");
    } else if (hasExportModifier(node)) {
      if (
        (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
        hasDefaultModifier(node)
      ) {
        addExport("default");
      } else if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        node.name
      ) {
        addExport(node.name.text);
      } else if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) addExport(declaration.name.text);
        }
      }
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      indexJsxElement({ element: node, relPath, fileId, importsByLocalName, addNode, addEdge, provenanceFor });
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Route-table literals: grep-level, best-effort (pattern recorded on the node).
  for (const match of text.matchAll(ROUTE_TABLE_PATTERN)) {
    const routePath = match[1];
    const routeId = routeNodeId(routePath);
    addNode({
      id: routeId,
      kind: "route",
      label: routePath,
      filePath: "",
      detail: "route-table-path-literal",
      provenance: provenanceFor("heuristic_scan"),
    });
    addEdge("route_renders", routeId, fileId, "heuristic_scan");
  }
}

function indexJsxElement(args: {
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement;
  relPath: string;
  fileId: string;
  importsByLocalName: Map<string, ImportBinding>;
  addNode: (node: CodeGraphNode) => void;
  addEdge: (kind: CodeGraphEdgeKind, from: string, to: string, source: CodeGraphSource) => void;
  provenanceFor: (source: CodeGraphSource) => CodeGraphProvenance;
}): void {
  const { element, relPath, fileId, importsByLocalName, addNode, addEdge, provenanceFor } = args;
  const tagName = element.tagName;

  // Component render edges: capitalized identifier tags only (Foo.Bar tags are skipped in v0).
  if (ts.isIdentifier(tagName) && /^[A-Z]/.test(tagName.text)) {
    const name = tagName.text;
    const binding = importsByLocalName.get(name);
    if (binding?.resolvedFile) {
      const componentId = componentNodeId(binding.resolvedFile, name);
      addNode({
        id: componentId,
        kind: "component",
        label: name,
        filePath: binding.resolvedFile,
        provenance: provenanceFor("static_parse"),
      });
      addEdge("renders", fileId, componentId, "static_parse");
    } else if (!binding?.external) {
      // Not imported (or import unresolvable): record honestly as an unresolved symbol.
      const unresolvedId = unresolvedSymbolNodeId(name);
      addNode({
        id: unresolvedId,
        kind: "symbol",
        label: name,
        filePath: "",
        provenance: provenanceFor("unresolved_reference"),
      });
      addEdge("renders", fileId, unresolvedId, "unresolved_reference");
    }
    // External package components (e.g. react-router-dom's <Route>) are skipped.
  }

  for (const attribute of element.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    const attrName = ts.isIdentifier(attribute.name) ? attribute.name.text : attribute.name.getText();
    const literal = jsxAttributeStringValue(attribute);
    if (attrName === "data-testid" && literal) {
      const selectorId = selectorNodeId(literal);
      addNode({
        id: selectorId,
        kind: "selector",
        label: literal,
        filePath: "",
        provenance: provenanceFor("static_parse"),
      });
      addEdge("has_selector", fileId, selectorId, "static_parse");
    }
    if (attrName === "path" && literal && ts.isIdentifier(tagName) && tagName.text === "Route") {
      const routeId = routeNodeId(literal);
      addNode({
        id: routeId,
        kind: "route",
        label: literal,
        filePath: "",
        detail: "jsx-route-path",
        provenance: provenanceFor("heuristic_scan"),
      });
      addEdge("route_renders", routeId, fileNodeId(relPath), "heuristic_scan");
    }
  }
}

function jsxAttributeStringValue(attribute: ts.JsxAttribute): string | undefined {
  const initializer = attribute.initializer;
  if (!initializer) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer) && initializer.expression) {
    if (ts.isStringLiteral(initializer.expression)) return initializer.expression.text;
    if (ts.isNoSubstitutionTemplateLiteral(initializer.expression)) return initializer.expression.text;
  }
  return undefined;
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function hasDefaultModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
}

// ─── Module resolution ──────────────────────────────────────────────────────

type PathAlias = { prefix: string; suffix: string; targets: string[] };

/**
 * Resolve an import specifier to a repo-relative forward-slash file path.
 * Returns "external" for bare package imports, undefined when unresolvable.
 */
function resolveModuleSpecifier(args: {
  specifier: string;
  fromDir: string;
  root: string;
  pathAliases: PathAlias[];
}): string | "external" | undefined {
  const { specifier, fromDir, root, pathAliases } = args;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return resolveCandidateFile(resolve(fromDir, specifier), root);
  }
  for (const alias of pathAliases) {
    if (!specifier.startsWith(alias.prefix)) continue;
    if (alias.suffix && !specifier.endsWith(alias.suffix)) continue;
    const wildcard = specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length);
    for (const target of alias.targets) {
      const candidate = resolveCandidateFile(resolve(root, target.replace("*", wildcard)), root);
      if (candidate) return candidate;
    }
    return undefined; // alias matched but no target file found
  }
  if (specifier.startsWith("node:")) return "external";
  return "external"; // bare package import
}

/** Standard extension/index resolution order: exact .ts/.tsx, then .ts, .tsx, /index.ts, /index.tsx. */
function resolveCandidateFile(absCandidate: string, root: string): string | undefined {
  if (/\.(ts|tsx)$/.test(absCandidate) && existsSync(absCandidate)) {
    return normalizeGraphPath(relative(root, absCandidate));
  }
  for (const suffix of RESOLUTION_SUFFIXES) {
    const withSuffix = `${absCandidate}${suffix}`;
    if (existsSync(withSuffix)) return normalizeGraphPath(relative(root, withSuffix));
  }
  return undefined;
}

/** Read compilerOptions.paths (+ baseUrl) from <root>/tsconfig.json via the TS JSONC reader. */
function readTsconfigPathAliases(root: string): PathAlias[] {
  const tsconfigPath = join(root, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return [];
  try {
    const parsed = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    const compilerOptions = (parsed.config?.compilerOptions ?? {}) as {
      baseUrl?: string;
      paths?: Record<string, string[]>;
    };
    const baseUrl = compilerOptions.baseUrl ?? ".";
    const aliases: PathAlias[] = [];
    for (const [pattern, targets] of Object.entries(compilerOptions.paths ?? {})) {
      const starIndex = pattern.indexOf("*");
      const prefix = starIndex === -1 ? pattern : pattern.slice(0, starIndex);
      const suffix = starIndex === -1 ? "" : pattern.slice(starIndex + 1);
      aliases.push({
        prefix,
        suffix,
        targets: targets.map((target) => normalizeGraphPath(join(baseUrl, target))),
      });
    }
    // Longest prefix first so "@nodeagent/core/*" wins over "@nodeagent/*".
    return aliases.sort((a, b) => b.prefix.length - a.prefix.length);
  } catch {
    return [];
  }
}

// ─── File walking + minimal glob support ────────────────────────────────────

function walkFiles(root: string, matchers: RegExp[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(absPath);
        continue;
      }
      if (!entry.isFile() || entry.name.endsWith(".d.ts")) continue;
      const relPath = normalizeGraphPath(relative(root, absPath));
      if (matchers.some((matcher) => matcher.test(relPath))) {
        try {
          if (statSync(absPath).isFile()) out.push(relPath);
        } catch {
          // race: file removed between readdir and stat
        }
      }
    }
  };
  walk(root);
  return out;
}

/** Minimal glob -> RegExp: supports **, *, and {a,b} alternation over forward-slash paths. */
function globToRegExp(pattern: string): RegExp {
  const glob = normalizeGraphPath(pattern);
  let out = "";
  let index = 0;
  while (index < glob.length) {
    const char = glob[index];
    if (char === "*") {
      if (glob.startsWith("**/", index)) {
        out += "(?:[^/]+/)*";
        index += 3;
      } else if (glob.startsWith("**", index)) {
        out += ".*";
        index += 2;
      } else {
        out += "[^/]*";
        index += 1;
      }
    } else if (char === "{") {
      const end = glob.indexOf("}", index);
      if (end === -1) {
        out += "\\{";
        index += 1;
      } else {
        const alternatives = glob.slice(index + 1, end).split(",").map(escapeRegExpText);
        out += `(?:${alternatives.join("|")})`;
        index = end + 1;
      }
    } else {
      out += escapeRegExpText(char);
      index += 1;
    }
  }
  return new RegExp(`^${out}$`);
}

function escapeRegExpText(value: string): string {
  return value.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
}
