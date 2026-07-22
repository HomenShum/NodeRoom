import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CODE_ROOTS = ["src", "convex", "tests", "scripts", "e2e"];
const LEGACY_IMPORT_RE = /from\s+"[^\"]*(\.\.\/agent\/|\.\/agent\/|\/src\/agent\/|\.\.\/shared\/formulaEngine|\.\/shared\/formulaEngine|\/src\/shared\/formulaEngine|\.\.\/engine\/semanticRebase|\.\/engine\/semanticRebase|\/src\/engine\/semanticRebase)/;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("nodeagent import guards", () => {
  it("removes the legacy source-of-truth files", () => {
    expect(existsSync(join(ROOT, "src", "agent", "index.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "src", "shared", "formulaEngine.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "src", "engine", "semanticRebase.ts"))).toBe(false);
  });

  it("keeps the live repo import graph off legacy agent paths", () => {
    const offenders: string[] = [];
    for (const root of CODE_ROOTS) {
      for (const file of walk(join(ROOT, root))) {
        const content = readFileSync(file, "utf8");
        if (LEGACY_IMPORT_RE.test(content)) offenders.push(file.replace(`${ROOT}\\`, ""));
      }
    }
    expect(offenders).toEqual([]);
  }, 30_000);
});
