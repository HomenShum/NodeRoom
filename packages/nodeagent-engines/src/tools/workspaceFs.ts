/**
 * Workspace boundary helpers. Every Node tool that touches the filesystem goes
 * through `resolveInside` (lexical + realpath containment) and `isRestricted`
 * (template policy globs).
 */
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

const WIN = process.platform === "win32";

/** path.relative is already case-insensitive on win32 and returns an absolute path across drives/UNC. */
function contains(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Canonical absolute path for `p` (relative to the workspace, or absolute) when it
 * stays inside the workspace, else null. Symlink/junction escapes are caught by
 * realpath-ing the nearest existing ancestor; a dangling link is refused.
 */
export function resolveInside(workspaceDir: string, p: string): string | null {
  if (typeof p !== "string" || p.length === 0 || p.includes("\0")) return null;
  const root = path.resolve(workspaceDir);
  const target = path.resolve(root, p);
  if (!contains(root, target)) return null;
  // "a:b" below the root is an NTFS alternate data stream, never a workspace file.
  if (WIN && path.relative(root, target).includes(":")) return null;
  let realRoot: string;
  try {
    realRoot = realpathSync.native(root);
  } catch {
    return null;
  }
  let probe = target;
  for (;;) {
    try {
      lstatSync(probe);
      break;
    } catch {
      const up = path.dirname(probe);
      if (up === probe) return null;
      probe = up;
    }
  }
  let realProbe: string;
  try {
    realProbe = realpathSync.native(probe);
  } catch {
    return null;
  }
  if (!contains(realRoot, realProbe)) return null;
  // Canonical form under the caller's root: in-workspace links and 8.3 short names
  // resolve to the real location, so restrictedGlobs see the path that is actually read.
  return path.join(root, path.relative(realRoot, realProbe), path.relative(probe, target));
}

const globCache = new Map<string, RegExp>();

function globToRegExp(glob: string): RegExp {
  const g = normalizeRel(glob);
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      const slashAfter = g[i + 2] === "/";
      const atSegmentStart = i === 0 || g[i - 1] === "/";
      if (atSegmentStart && slashAfter) {
        re += "(?:.*/)?";
        i += 2;
      } else if (atSegmentStart && i + 2 === g.length && i > 0) {
        // "dir/**" also matches "dir" itself
        re = `${re.slice(0, -1)}(?:/.*)?`;
        i += 1;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // ponytail: case-insensitive everywhere, over-restricts on case-sensitive filesystems (safe direction).
  return new RegExp(`^${re}$`, "i");
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}

/** True when `relPath` or any of its ancestor directories matches one of `globs`. */
export function isRestricted(relPath: string, globs: string[]): boolean {
  if (globs.length === 0) return false;
  const parts = normalizeRel(relPath).split("/").filter(Boolean);
  const regs = globs.map((g) => {
    let r = globCache.get(g);
    if (!r) {
      r = globToRegExp(g);
      if (globCache.size > 256) globCache.clear();
      globCache.set(g, r);
    }
    return r;
  });
  for (let n = 1; n <= parts.length; n++) {
    const prefix = parts.slice(0, n).join("/");
    if (regs.some((r) => r.test(prefix))) return true;
  }
  return false;
}

/** Workspace-relative, forward-slash form of an absolute path. */
export function toRel(workspaceDir: string, abs: string): string {
  return path.relative(path.resolve(workspaceDir), abs).replace(/\\/g, "/");
}

/** True for anything under <workspace>/.claude/ — only Node's skill lifecycle writes there. */
export function isNodeOwned(relPath: string): boolean {
  const first = normalizeRel(relPath).split("/")[0] ?? "";
  return first.toLowerCase() === ".claude";
}
