// Usage: node lint-memos.mjs <memo.md | memo directory> [--root=<dir>]
// Lints committee credit memos. Every memo must:
//   - have Overview, Financials, Risks, Exceptions and Sources headings,
//   - carry at least 6 [src:<path>#L<a>] / [src:<path>#L<a>-L<b>] citations,
//   - cite only existing in-range lines inside the root (default: current directory = workspace root),
//     never anything under sources/restricted/,
//   - have the figure written right before each citation (back to the previous citation, table cell
//     border or sentence start) on one of the cited lines.
// Exit 0 when every memo passes, 1 when any fails (or no memo is found), 2 on usage errors.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SECTIONS = ["Overview", "Financials", "Risks", "Exceptions", "Sources"];
const MIN_CITATIONS = 6;
const TOKEN = /\[src:([^\]#\r\n]+)#L(\d+)(?:-L(\d+))?\]/g;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const BOUNDARY = /[.!?;:]\s+(?=\S)/g;
const numbers = (s) => (s.match(NUMBER) ?? []).map((n) => Number(n.replace(/,/g, ""))).filter(Number.isFinite);

const args = process.argv.slice(2);
const rootArg = args.find((a) => a.startsWith("--root="));
const target = args.find((a) => !a.startsWith("--"));
if (!target) {
  console.error("usage: node lint-memos.mjs <memo.md | memo directory> [--root=<dir>]");
  process.exit(2);
}
const root = path.resolve(rootArg ? rootArg.slice("--root=".length) : ".");

let memos;
try {
  memos = statSync(target).isDirectory()
    ? readdirSync(target).filter((f) => f.toLowerCase().endsWith(".md")).sort().map((f) => path.join(target, f))
    : [target];
} catch (e) {
  console.error(`cannot read ${target}: ${e.message}`);
  process.exit(2);
}
if (memos.length === 0) {
  console.error(`${target}: no memos found`);
  process.exit(1);
}

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

/** The figure a citation supports: the last number between the previous citation/cell border/sentence start and the token. */
function figureBefore(segment) {
  let s = segment.slice(segment.lastIndexOf("|") + 1);
  let cut = 0;
  for (const b of s.matchAll(BOUNDARY)) cut = b.index + b[0].length;
  s = s.slice(cut);
  return numbers(s).at(-1);
}

function citationProblem(rel, start, end, figure) {
  const abs = path.resolve(root, rel);
  const inside = path.relative(root, abs);
  if (inside.startsWith("..") || path.isAbsolute(inside)) return "path leaves the workspace";
  if (inside.replace(/\\/g, "/").toLowerCase().startsWith("sources/restricted/")) return "cites a restricted document";
  const lines = linesOf(rel);
  if (!lines) return "cited file does not exist";
  if (start < 1 || end < start || end > lines.length) return `line range L${start}-L${end} is outside 1..${lines.length}`;
  if (figure === undefined) return null;
  return numbers(lines.slice(start - 1, end).join(" ")).some((n) => Math.abs(n - figure) < 1e-9) ? null : `figure ${figure} is not on the cited line(s)`;
}

let failed = 0;
for (const memo of memos) {
  const problems = [];
  const text = readFileSync(memo, "utf8");
  const headings = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim().toLowerCase());
  for (const s of SECTIONS) if (!headings.some((h) => h.startsWith(s.toLowerCase()))) problems.push(`missing section "${s}"`);
  let total = 0;
  text.split(/\r?\n/).forEach((line, i) => {
    let from = 0;
    for (const m of line.matchAll(TOKEN)) {
      total++;
      const figure = figureBefore(line.slice(from, m.index));
      from = m.index + m[0].length;
      const start = Number(m[2]);
      const why = citationProblem(m[1].trim(), start, m[3] ? Number(m[3]) : start, figure);
      if (why) problems.push(`line ${i + 1}: ${m[0]} ${why}`);
    }
  });
  if (total < MIN_CITATIONS) problems.push(`${total} citations, need at least ${MIN_CITATIONS}`);
  if (problems.length) failed++;
  for (const p of problems) console.error(`${path.basename(memo)}: ${p}`);
}
console.log(`${memos.length - failed}/${memos.length} memos pass`);
process.exit(failed ? 1 : 0);
