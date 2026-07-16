import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const SOURCE_DIRECTORIES = ["src", "scripts", "convex"] as const;
const SOURCE_FILES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  ".env",
  ".env.local",
  ".env.production.local",
] as const;
const IGNORED_DIRECTORIES = new Set([".git", ".tmp", "__pycache__", "node_modules"]);
const IGNORED_FILE_SUFFIXES = [".pyc", ".pyo"];

export interface SpreadsheetBenchRunSourceFingerprint {
  sha256: string;
  fileCount: number;
}

export function fingerprintSpreadsheetBenchRunSource(
  workspaceRoot = process.cwd(),
): SpreadsheetBenchRunSourceFingerprint {
  const root = resolve(workspaceRoot);
  const files = [
    ...SOURCE_DIRECTORIES.flatMap((directory) => listFiles(resolve(root, directory))),
    ...SOURCE_FILES.map((file) => resolve(root, file)).filter(existsSync),
  ].sort((left, right) => left.localeCompare(right));
  const hash = createHash("sha256");

  for (const path of files) {
    const normalized = relative(root, path).replace(/\\/g, "/");
    const content = readFileSync(path);
    hash.update(`${normalized}\0${content.length}\0`, "utf8");
    hash.update(content);
    hash.update("\0", "utf8");
  }

  return { sha256: hash.digest("hex"), fileCount: files.length };
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(path));
      continue;
    }
    if (!entry.isFile() || IGNORED_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
    files.push(path);
  }
  return files;
}
