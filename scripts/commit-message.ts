import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type GitChange = {
  status: string;
  path: string;
  oldPath?: string;
};

export type ChangedArea = {
  area: string;
  paths: string[];
  aliases: string[];
};

const AREA_ALIASES: Record<string, string[]> = {
  ".github": ["ci", "workflow", "workflows", "github actions", ".github"],
  convex: ["convex", "backend", "schema", "database"],
  docs: ["docs", "documentation", "readme"],
  e2e: ["e2e", "playwright", "browser", "browser tests"],
  evals: ["eval", "evals", "ladder"],
  package: ["package", "npm", "dependencies", "scripts"],
  README: ["readme", "docs", "documentation"],
  scripts: ["scripts", "script", "tooling", "cli"],
  src: ["src", "app", "frontend", "ui", "runtime"],
  tests: ["tests", "test", "vitest"],
};

const PACKAGE_FILES = new Set(["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);

export function parseNameStatus(input: string): GitChange[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const status = parts[0] ?? "";
      if ((status.startsWith("R") || status.startsWith("C")) && parts.length >= 3) {
        return { status, oldPath: parts[1], path: parts[2] };
      }
      return { status, path: parts[1] ?? "" };
    })
    .filter((change) => change.path.length > 0);
}

export function renderChangeList(changes: GitChange[]): string {
  if (changes.length === 0) return "Change list:\n- No staged changes.";
  const lines = ["Changed areas:"];
  for (const area of changedAreas(changes)) {
    lines.push(`- ${area.area} - `);
  }
  lines.push("", "Changed files (reference):");
  for (const change of changes) {
    const prefix = change.oldPath ? `${change.status} ${change.oldPath} -> ${change.path}` : `${change.status} ${change.path}`;
    lines.push(`- ${prefix} - `);
  }
  return lines.join("\n");
}

export function areaForPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const [head] = normalized.split("/");
  if (!head) return normalized;
  if (normalized.includes("/")) return head;
  if (/^readme(\..+)?$/i.test(head)) return "README";
  if (PACKAGE_FILES.has(head)) return "package";
  const withoutExtension = head.replace(/\.[^.]+$/, "");
  return withoutExtension || head;
}

export function changedAreas(changes: GitChange[]): ChangedArea[] {
  const byArea = new Map<string, Set<string>>();
  for (const change of changes) {
    for (const path of [change.oldPath, change.path].filter(Boolean) as string[]) {
      const area = areaForPath(path);
      const paths = byArea.get(area) ?? new Set<string>();
      paths.add(path);
      byArea.set(area, paths);
    }
  }
  return Array.from(byArea.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([area, paths]) => ({
      area,
      paths: Array.from(paths).sort(),
      aliases: Array.from(new Set([area, ...(AREA_ALIASES[area] ?? [])])),
    }));
}

function messageMentionsAlias(message: string, alias: string): boolean {
  const haystack = message.toLowerCase();
  const needle = alias.toLowerCase();
  if (needle.startsWith(".") || needle.includes(" ") || needle.includes(".")) return haystack.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_-])${escaped}($|[^a-z0-9_-])`, "i").test(message);
}

export function missingMentionedAreas(message: string, changes: GitChange[]): ChangedArea[] {
  return changedAreas(changes).filter((area) => !area.aliases.some((alias) => messageMentionsAlias(message, alias)));
}

export function missingMentionedPaths(message: string, changes: GitChange[]): GitChange[] {
  return changes.filter((change) => {
    if (message.includes(change.path)) return false;
    if (change.oldPath && message.includes(change.oldPath)) return false;
    return true;
  });
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

function stagedChanges(): GitChange[] {
  return parseNameStatus(git(["diff", "--cached", "--name-status"]));
}

function commitChanges(ref: string): GitChange[] {
  return parseNameStatus(git(["show", "--format=", "--name-status", ref]));
}

function commitMessage(ref: string): string {
  return git(["show", "-s", "--format=%B", ref]);
}

function isMergeCommit(ref: string): boolean {
  const parents = git(["show", "-s", "--format=%P", ref]).trim().split(/\s+/).filter(Boolean);
  return parents.length > 1;
}

function printSummary(): void {
  const changes = stagedChanges();
  console.log(renderChangeList(changes));
  console.log("");
  console.log("Verification:");
  console.log("- ");
  console.log("");
  console.log("Known limits:");
  console.log("- ");
}

function checkCommit(ref: string): boolean {
  if (isMergeCommit(ref)) {
    console.log(`${ref}: merge commit detected; skipping changed-area commit message check`);
    return true;
  }
  const changes = commitChanges(ref);
  const message = commitMessage(ref);
  const missing = missingMentionedAreas(message, changes);
  if (missing.length === 0) {
    console.log(`${ref}: commit message covers ${changedAreas(changes).length} changed area(s)`);
    return true;
  }
  console.error(`${ref}: commit message is missing changed area(s):`);
  for (const area of missing) {
    console.error(`- ${area.area} (${area.paths.join(", ")})`);
  }
  return false;
}

function checkLast(): void {
  if (!checkCommit("HEAD")) process.exit(1);
}

function checkRange(range: string): void {
  let refs: string[];
  try {
    refs = git(revListArgsForRange(range)).trim().split(/\s+/).filter(Boolean);
  } catch {
    console.warn(`${range}: revision range unavailable; falling back to HEAD`);
    if (!checkCommit("HEAD")) process.exit(1);
    return;
  }
  if (refs.length === 0) {
    console.log(`${range}: no commits to check`);
    return;
  }
  const ok = refs.map((ref) => checkCommit(ref)).every(Boolean);
  if (!ok) process.exit(1);
}

export function revListArgsForRange(range: string): string[] {
  return ["rev-list", "--reverse", "--first-parent", range];
}

function main(): void {
  const args = process.argv.slice(2);
  const flags = new Set(args);
  if (flags.has("--check-last")) {
    checkLast();
    return;
  }
  const rangeIndex = args.indexOf("--check-range");
  if (rangeIndex >= 0) {
    checkRange(args[rangeIndex + 1] ?? "HEAD");
    return;
  }
  printSummary();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
