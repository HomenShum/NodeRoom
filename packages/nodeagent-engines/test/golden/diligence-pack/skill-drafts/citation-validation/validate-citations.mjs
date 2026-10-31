// Usage: node validate-citations.mjs <table.md> [--root=<dir>]
// Checks every [src:<path>#L<a>] / [src:<path>#L<a>-L<b>] token in the document:
//   - the path stays inside the root (default: current directory = workspace root),
//   - it is not under sources/restricted/,
//   - the file exists and the line range is in bounds,
//   - every number written before the token (back to the previous cell border, token or line
//     start) appears on one of the cited lines.
// Exit 0 when every citation is valid, 1 when any fails (or none exist), 2 on usage errors.
import { readFileSync } from "node:fs";
import path from "node:path";

const TOKEN = /\[src:([^\]#\r\n]+)#L(\d+)(?:-L(\d+))?\]/g;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const numbers = (s) => (s.match(NUMBER) ?? []).map((n) => Number(n.replace(/,/g, ""))).filter(Number.isFinite);

const args = process.argv.slice(2);
const rootArg = args.find((a) => a.startsWith("--root="));
const table = args.find((a) => !a.startsWith("--"));
if (!table) {
  console.error("usage: node validate-citations.mjs <table.md> [--root=<dir>]");
  process.exit(2);
}
const root = path.resolve(rootArg ? rootArg.slice("--root=".length) : ".");

const files = new Map();
function linesOf(rel) {
  if (!files.has(rel)) {
    let lines = null;
    try {
      lines = readFileSync(path.join(root, rel), "utf8").replace(/\r?\n$/, "").split(/\r?\n/);
    } catch {
      /* missing or unreadable */
    }
    files.set(rel, lines);
  }
  return files.get(rel);
}

function check(rel, start, end, before) {
  const abs = path.resolve(root, rel);
  const inside = path.relative(root, abs);
  if (inside.startsWith("..") || path.isAbsolute(inside)) return "path leaves the workspace";
  if (inside.replace(/\\/g, "/").startsWith("sources/restricted/")) return "cites a restricted document";
  const lines = linesOf(rel);
  if (!lines) return "cited file does not exist";
  if (start < 1 || end < start || end > lines.length) return `line range L${start}-L${end} is outside 1..${lines.length}`;
  const cited = numbers(lines.slice(start - 1, end).join(" "));
  const missing = numbers(before).filter((n) => !cited.some((c) => Math.abs(c - n) < 1e-9));
  return missing.length ? `number(s) ${missing.join(", ")} not found on the cited line(s)` : null;
}

let text;
try {
  text = readFileSync(table, "utf8");
} catch (e) {
  console.error(`cannot read ${table}: ${e.message}`);
  process.exit(2);
}

let total = 0;
const failures = [];
text.split(/\r?\n/).forEach((line, i) => {
  let from = 0;
  for (const m of line.matchAll(TOKEN)) {
    total++;
    const segment = line.slice(from, m.index);
    const before = segment.slice(segment.lastIndexOf("|") + 1);
    from = m.index + m[0].length;
    const start = Number(m[2]);
    const why = check(m[1].trim(), start, m[3] ? Number(m[3]) : start, before);
    if (why) failures.push(`line ${i + 1}: ${m[0]} ${why}`);
  }
});

if (total === 0) {
  console.error(`${table}: no [src:...] citations found`);
  process.exit(1);
}
for (const f of failures) console.error(f);
console.log(`${total - failures.length}/${total} citations valid`);
process.exit(failures.length ? 1 : 0);
