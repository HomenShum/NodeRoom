/**
 * formulaEngine.ts - a small, pure, browser-safe spreadsheet formula engine for the live grid.
 *
 * No dependencies. `evaluateFormula(formula, resolver)` evaluates ONE formula, asking the
 * `CellResolver` for cell values by A1 ref. Recursion across formula cells and cycle detection
 * are the CALLER's responsibility (the resolver returns already-resolved values). Errors surface
 * as `{ error }` tokens (#DIV/0!, #VALUE!, #NAME?, #REF!, #ERROR!) - the function never throws.
 *
 * Supports: numbers, "strings", TRUE/FALSE, trailing %, ( ); operators + - * / ^, unary +/-,
 * comparisons = <> < > <= >=; A1 refs (A1, $A$1) and ranges (A1:B3); and the finance-core
 * functions SUM AVERAGE MEDIAN MIN MAX COUNT COUNTA IF AND OR NOT ROUND ROUNDUP ROUNDDOWN ABS SQRT
 * CONCAT CONCATENATE TEXT. (Reuses the look-and-feel of the bench evaluator in spreadsheetBenchRunner.ts
 * but is independently implemented for the browser; extend the function set as needed.)
 */

export type CellValue = number | string | boolean | null;
export interface CellResolver {
  /** The (already-resolved) value at an A1 ref, or null/"" if the cell is empty. */
  getCell(ref: string): CellValue;
}
export type FormulaResult = { value: CellValue } | { error: string };

/** Thrown internally to abort a formula with a specific error code. Exported so a recursive
 *  resolver can re-throw it to PROPAGATE an upstream cell's error (Excel semantics: =A1+1 is
 *  #DIV/0! when A1 is #DIV/0!). The caller's resolver maps a referenced cell's error to
 *  `throw new FormulaEvalError(code)`; evaluateFormula catches it and returns `{ error: code }`. */
export class FormulaEvalError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "FormulaEvalError";
  }
}

/* A1 helpers */
const A1_RE = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]*)$/;
/** "A" -> 1, "Z" -> 26, "AA" -> 27. */
export function colToIndex(letters: string): number {
  let n = 0;
  for (const c of letters.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}
/** 1 -> "A", 27 -> "AA". */
export function indexToCol(index: number): string {
  let s = "";
  let n = index;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function normalizeRef(ref: string): string {
  return ref.replace(/\$/g, "").toUpperCase();
}
function parseRef(ref: string): { col: number; row: number } | null {
  const m = normalizeRef(ref).match(A1_RE);
  if (!m) return null;
  return { col: colToIndex(m[1]), row: Number(m[2]) };
}
function expandRange(a: string, b: string): string[] {
  const pa = parseRef(a);
  const pb = parseRef(b);
  if (!pa || !pb) throw new FormulaEvalError("#REF!");
  const c0 = Math.min(pa.col, pb.col), c1 = Math.max(pa.col, pb.col);
  const r0 = Math.min(pa.row, pb.row), r1 = Math.max(pa.row, pb.row);
  const refs: string[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) refs.push(indexToCol(c) + r);
  return refs;
}

/* tokenizer */
type Tok = { t: "num" | "str" | "id" | "op"; v: string };
const TWO_CHAR_OPS = new Set(["<=", ">=", "<>"]);
function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
    if (ch === '"') {
      let j = i + 1, str = "";
      while (j < src.length) {
        if (src[j] === '"') { if (src[j + 1] === '"') { str += '"'; j += 2; continue; } break; }
        str += src[j++];
      }
      if (j >= src.length) throw new FormulaEvalError("#ERROR!"); // unterminated string
      toks.push({ t: "str", v: str });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if ((src[j] === "e" || src[j] === "E") && /[0-9+\-]/.test(src[j + 1] ?? "")) {
        j++;
        if (src[j] === "+" || src[j] === "-") j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      toks.push({ t: "num", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$.]/.test(src[j])) j++;
      toks.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) { toks.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/^(),:%<>={}".includes(ch)) { toks.push({ t: "op", v: ch }); i++; continue; }
    throw new FormulaEvalError("#ERROR!"); // unrecognized character
  }
  return toks;
}

/* parser -> AST */
type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "array"; values: Node[] }
  | { k: "ref"; v: string }
  | { k: "range"; a: string; b: string }
  | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "un"; op: string; e: Node }
  | { k: "pct"; e: Node }
  | { k: "call"; name: string; args: Node[] };

class Parser {
  pos = 0;
  constructor(private toks: Tok[]) {}
  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private next(): Tok { const t = this.toks[this.pos]; if (!t) throw new FormulaEvalError("#ERROR!"); this.pos++; return t; }
  private isOp(v: string): boolean { const t = this.peek(); return !!t && t.t === "op" && t.v === v; }
  private eat(v: string): void { if (!this.isOp(v)) throw new FormulaEvalError("#ERROR!"); this.pos++; }

  parse(): Node {
    const n = this.compare();
    if (this.pos !== this.toks.length) throw new FormulaEvalError("#ERROR!");
    return n;
  }
  private compare(): Node {
    let l = this.additive();
    while (this.peek()?.t === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(this.peek()!.v)) {
      const op = this.next().v;
      l = { k: "bin", op, l, r: this.additive() };
    }
    return l;
  }
  private additive(): Node {
    let l = this.multiplicative();
    while (this.isOp("+") || this.isOp("-")) { const op = this.next().v; l = { k: "bin", op, l, r: this.multiplicative() }; }
    return l;
  }
  private multiplicative(): Node {
    let l = this.power();
    while (this.isOp("*") || this.isOp("/")) { const op = this.next().v; l = { k: "bin", op, l, r: this.power() }; }
    return l;
  }
  private power(): Node {
    const l = this.unary();
    if (this.isOp("^")) { this.next(); return { k: "bin", op: "^", l, r: this.power() }; } // right-assoc
    return l;
  }
  private unary(): Node {
    if (this.isOp("-") || this.isOp("+")) { const op = this.next().v; return { k: "un", op, e: this.unary() }; }
    return this.postfix();
  }
  private postfix(): Node {
    let e = this.primary();
    while (this.isOp("%")) { this.next(); e = { k: "pct", e }; }
    return e;
  }
  private primary(): Node {
    const t = this.next();
    if (t.t === "num") { const v = Number(t.v); if (!Number.isFinite(v)) throw new FormulaEvalError("#ERROR!"); return { k: "num", v }; }
    if (t.t === "str") return { k: "str", v: t.v };
    if (t.t === "op" && t.v === "{") {
      const values: Node[] = [this.compare()];
      while (this.isOp(",")) { this.next(); values.push(this.compare()); }
      this.eat("}");
      return { k: "array", values };
    }
    if (t.t === "op" && t.v === "(") { const e = this.compare(); this.eat(")"); return e; }
    if (t.t === "id") {
      const up = t.v.toUpperCase();
      if (up === "TRUE") return { k: "bool", v: true };
      if (up === "FALSE") return { k: "bool", v: false };
      if (this.isOp("(")) {
        this.next();
        const args: Node[] = [];
        if (!this.isOp(")")) {
          args.push(this.compare());
          while (this.isOp(",")) { this.next(); args.push(this.compare()); }
        }
        this.eat(")");
        return { k: "call", name: up, args };
      }
      // ref or range
      if (!A1_RE.test(normalizeRef(t.v))) throw new FormulaEvalError("#NAME?");
      if (this.isOp(":")) {
        this.next();
        const t2 = this.next();
        if (t2.t !== "id" || !A1_RE.test(normalizeRef(t2.v))) throw new FormulaEvalError("#REF!");
        return { k: "range", a: t.v, b: t2.v };
      }
      return { k: "ref", v: t.v };
    }
    throw new FormulaEvalError("#ERROR!");
  }
}

/* evaluator */
const SUPPORTED = new Set([
  "SUM", "AVERAGE", "MEDIAN", "MIN", "MAX", "COUNT", "COUNTA", "IF", "AND", "OR", "NOT",
  "ROUND", "ROUNDUP", "ROUNDDOWN", "ABS", "SQRT", "CONCAT", "CONCATENATE",
  "SUMIF", "COUNTIF", "AVERAGEIF", "VLOOKUP", "INDEX", "MATCH", "IFERROR",
  "MOD", "POWER", "LEN", "LEFT", "RIGHT", "MID", "TRIM", "UPPER", "LOWER", "TEXT",
]);

/** Coerce a value to a number for ARITHMETIC (blank -> 0, numeric string -> number, else #VALUE!). */
function toNumber(v: CellValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (s === "") return 0;
  const n = coerceNumeric(s);
  if (n === null) throw new FormulaEvalError("#VALUE!");
  return n;
}
/** Parse a numeric-looking string ("12,400", "$1,200", "24%", "(50)") to a number, else null. */
function coerceNumeric(s: string): number | null {
  let str = s.trim();
  if (str === "") return null;
  let mult = 1;
  if (/%$/.test(str)) { mult = 0.01; str = str.slice(0, -1); }
  let neg = false;
  if (/^\(.*\)$/.test(str)) { neg = true; str = str.slice(1, -1); } // accounting negatives
  str = str.replace(/[$,\s]/g, "");
  if (str === "" || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(str)) return null;
  const n = Number(str) * mult * (neg ? -1 : 1);
  return Number.isFinite(n) ? n : null;
}
/** Numbers from a value for AGGREGATES (numeric values/strings only; text/blank/bool ignored). */
function aggNumber(v: CellValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return coerceNumeric(v);
  return null; // booleans & blanks ignored by SUM/AVERAGE/etc.
}

type EvalValue = CellValue | CellValue[];

function evalValue(n: Node, R: CellResolver): EvalValue {
  switch (n.k) {
    case "num": return n.v;
    case "str": return n.v;
    case "bool": return n.v;
    case "array": return n.values.map((value) => evalScalar(value, R));
    case "ref": return R.getCell(normalizeRef(n.v));
    case "range": throw new FormulaEvalError("#VALUE!"); // a bare range is not a scalar
    case "pct": return toNumber(evalScalar(n.e, R)) / 100;
    case "un": return n.op === "-" ? -toNumber(evalScalar(n.e, R)) : toNumber(evalScalar(n.e, R));
    case "bin": return evalBin(n, R);
    case "call": return evalCall(n, R);
  }
}

function evalScalar(n: Node, R: CellResolver): CellValue {
  const value = evalValue(n, R);
  if (Array.isArray(value)) throw new FormulaEvalError("#VALUE!");
  return value;
}

function evalBin(n: { op: string; l: Node; r: Node }, R: CellResolver): CellValue {
  const op = n.op;
  if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
    const a = evalScalar(n.l, R);
    const b = evalScalar(n.r, R);
    return compare(op, a, b);
  }
  const a = toNumber(evalScalar(n.l, R));
  const b = toNumber(evalScalar(n.r, R));
  switch (op) {
    case "+": return round12(a + b);
    case "-": return round12(a - b);
    case "*": return round12(a * b);
    case "/": if (b === 0) throw new FormulaEvalError("#DIV/0!"); return round12(a / b);
    case "^": { const v = Math.pow(a, b); if (!Number.isFinite(v)) throw new FormulaEvalError("#NUM!"); return round12(v); }
  }
  throw new FormulaEvalError("#ERROR!");
}

function compare(op: string, a: CellValue, b: CellValue): boolean {
  // numeric compare when both coerce to numbers, else string compare (Excel-ish)
  const an = typeof a === "number" ? a : typeof a === "string" ? coerceNumeric(a) : a === true ? 1 : a === false ? 0 : null;
  const bn = typeof b === "number" ? b : typeof b === "string" ? coerceNumeric(b) : b === true ? 1 : b === false ? 0 : null;
  let cmp: number;
  if (an !== null && bn !== null && typeof an === "number" && typeof bn === "number") {
    cmp = an < bn ? -1 : an > bn ? 1 : 0;
  } else {
    const as = a === null ? "" : String(a);
    const bs = b === null ? "" : String(b);
    cmp = as < bs ? -1 : as > bs ? 1 : 0;
  }
  switch (op) {
    case "=": return cmp === 0;
    case "<>": return cmp !== 0;
    case "<": return cmp < 0;
    case ">": return cmp > 0;
    case "<=": return cmp <= 0;
    case ">=": return cmp >= 0;
  }
  return false;
}

function truthy(v: CellValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") { const n = coerceNumeric(v); return n !== null ? n !== 0 : v.length > 0; }
  return false;
}

/** Flatten a function arg into a list of values (a range expands; everything else is one value). */
function argValues(n: Node, R: CellResolver): CellValue[] {
  if (n.k === "range") return expandRange(n.a, n.b).map((ref) => R.getCell(ref));
  const value = evalValue(n, R);
  return Array.isArray(value) ? value : [value];
}
function aggNumbers(args: Node[], R: CellResolver): number[] {
  const out: number[] = [];
  for (const a of args) for (const v of argValues(a, R)) { const num = aggNumber(v); if (num !== null) out.push(num); }
  return out;
}

/** Coerce a value to a number for comparison/lookup, or null. */
function toNum(v: CellValue): number | null {
  return typeof v === "number" ? v : typeof v === "string" ? coerceNumeric(v) : typeof v === "boolean" ? (v ? 1 : 0) : null;
}
/** Excel-ish loose equality for lookups: numeric when both coerce, else case-insensitive string. */
function looseEqual(a: CellValue, b: CellValue): boolean {
  const an = toNum(a), bn = toNum(b);
  if (an !== null && bn !== null) return an === bn;
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}
/** Expand a range (or single ref) node into a 2D grid of values for INDEX/MATCH/VLOOKUP/*IF. */
function rangeGrid(node: Node, R: CellResolver): CellValue[][] {
  if (node.k === "ref") return [[R.getCell(normalizeRef(node.v))]];
  if (node.k !== "range") throw new FormulaEvalError("#REF!");
  const pa = parseRef(node.a), pb = parseRef(node.b);
  if (!pa || !pb) throw new FormulaEvalError("#REF!");
  const r0 = Math.min(pa.row, pb.row), r1 = Math.max(pa.row, pb.row);
  const c0 = Math.min(pa.col, pb.col), c1 = Math.max(pa.col, pb.col);
  const grid: CellValue[][] = [];
  for (let r = r0; r <= r1; r++) { const row: CellValue[] = []; for (let c = c0; c <= c1; c++) row.push(R.getCell(indexToCol(c) + r)); grid.push(row); }
  return grid;
}
/** Match a value against a SUMIF/COUNTIF criteria (">10", "<>x", "abc", or a literal). */
function matchesCriteria(value: CellValue, criteria: CellValue): boolean {
  if (typeof criteria === "string") {
    const m = criteria.match(/^(<=|>=|<>|<|>|=)?\s*([\s\S]*)$/);
    const op = m?.[1] || "=";
    const rhs = (m?.[2] ?? "").trim();
    const rhsNum = coerceNumeric(rhs);
    if (rhsNum !== null) {
      const vNum = toNum(value);
      if (vNum === null) return op === "<>";
      switch (op) { case "=": return vNum === rhsNum; case "<>": return vNum !== rhsNum; case "<": return vNum < rhsNum; case ">": return vNum > rhsNum; case "<=": return vNum <= rhsNum; case ">=": return vNum >= rhsNum; }
    }
    const vStr = (value === null ? "" : String(value)).toLowerCase();
    return op === "<>" ? vStr !== rhs.toLowerCase() : vStr === rhs.toLowerCase();
  }
  return looseEqual(value, criteria);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function excelDateParts(serial: number): { day: number; month: number; year: number; weekday: string } {
  const wholeDays = Math.trunc(serial);
  if (!Number.isFinite(serial) || wholeDays < 0) throw new FormulaEvalError("#VALUE!");
  const weekdayIndex = ((wholeDays - 1) % 7 + 7) % 7;
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekdayIndex];
  if (wholeDays === 60) return { day: 29, month: 2, year: 1900, weekday };
  const epoch = wholeDays < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + wholeDays * MS_PER_DAY);
  if (Number.isNaN(date.getTime())) throw new FormulaEvalError("#VALUE!");
  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
    weekday,
  };
}

function formatExcelDateSerial(serial: number, format: string): string {
  const parts = excelDateParts(serial);
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const replacements: Record<string, string> = {
    dddd: parts.weekday,
    ddd: parts.weekday.slice(0, 3),
    dd: String(parts.day).padStart(2, "0"),
    d: String(parts.day),
    mmmm: monthNames[parts.month - 1],
    mmm: monthNames[parts.month - 1].slice(0, 3),
    mm: String(parts.month).padStart(2, "0"),
    m: String(parts.month),
    yyyy: String(parts.year).padStart(4, "0"),
    yy: String(parts.year % 100).padStart(2, "0"),
  };
  const unsupported = format.replace(/dddd|ddd|dd|d|mmmm|mmm|mm|m|yyyy|yy/gi, "");
  if (/[a-z]/i.test(unsupported)) throw new FormulaEvalError("#UNSUPPORTED!");
  let matched = false;
  const rendered = format.replace(/dddd|ddd|dd|d|mmmm|mmm|mm|m|yyyy|yy/gi, (token) => {
    matched = true;
    return replacements[token.toLowerCase()];
  });
  if (!matched) throw new FormulaEvalError("#UNSUPPORTED!");
  return rendered;
}

function evalCall(n: { name: string; args: Node[] }, R: CellResolver): EvalValue {
  const fn = n.name;
  if (!SUPPORTED.has(fn)) throw new FormulaEvalError("#NAME?");
  switch (fn) {
    case "SUM": return round12(aggNumbers(n.args, R).reduce((s, x) => s + x, 0));
    case "AVERAGE": { const xs = aggNumbers(n.args, R); if (xs.length === 0) throw new FormulaEvalError("#DIV/0!"); return round12(xs.reduce((s, x) => s + x, 0) / xs.length); }
    case "MEDIAN": {
      const xs = aggNumbers(n.args, R).sort((a, b) => a - b);
      if (xs.length === 0) throw new FormulaEvalError("#NUM!");
      const middle = Math.floor(xs.length / 2);
      return xs.length % 2 === 1 ? xs[middle] : round12((xs[middle - 1] + xs[middle]) / 2);
    }
    case "MIN": { const xs = aggNumbers(n.args, R); return xs.length ? Math.min(...xs) : 0; }
    case "MAX": { const xs = aggNumbers(n.args, R); return xs.length ? Math.max(...xs) : 0; }
    case "COUNT": return aggNumbers(n.args, R).length;
    case "COUNTA": { let c = 0; for (const a of n.args) for (const v of argValues(a, R)) if (!(v === null || v === "")) c++; return c; }
    case "IF": { if (n.args.length < 2) throw new FormulaEvalError("#ERROR!"); return truthy(evalScalar(n.args[0], R)) ? evalScalar(n.args[1], R) : (n.args[2] ? evalScalar(n.args[2], R) : false); }
    case "AND": { const xs = n.args.flatMap((a) => argValues(a, R)); return xs.length > 0 && xs.every(truthy); }
    case "OR": { const xs = n.args.flatMap((a) => argValues(a, R)); return xs.some(truthy); }
    case "NOT": return !truthy(evalScalar(n.args[0], R));
    case "ABS": return Math.abs(toNumber(evalScalar(n.args[0], R)));
    case "SQRT": { const x = toNumber(evalScalar(n.args[0], R)); if (x < 0) throw new FormulaEvalError("#NUM!"); return Math.sqrt(x); }
    case "ROUND":
    case "ROUNDUP":
    case "ROUNDDOWN": {
      const x = toNumber(evalScalar(n.args[0], R));
      const d = n.args[1] ? Math.trunc(toNumber(evalScalar(n.args[1], R))) : 0;
      const f = Math.pow(10, d);
      if (fn === "ROUND") return Math.round(x * f) / f;
      if (fn === "ROUNDUP") return (x < 0 ? -Math.ceil(-x * f) : Math.ceil(x * f)) / f;
      return (x < 0 ? -Math.floor(-x * f) : Math.floor(x * f)) / f;
    }
    case "CONCAT":
    case "CONCATENATE": { let s = ""; for (const a of n.args) for (const v of argValues(a, R)) s += v === null ? "" : String(v); return s; }
    case "SUMIF": {
      const range = rangeGrid(n.args[0], R).flat();
      const crit = evalScalar(n.args[1], R);
      const sumR = n.args[2] ? rangeGrid(n.args[2], R).flat() : range;
      let s = 0;
      for (let i = 0; i < range.length; i++) if (matchesCriteria(range[i], crit)) { const num = aggNumber(sumR[i] ?? null); if (num !== null) s += num; }
      return round12(s);
    }
    case "COUNTIF": { const range = rangeGrid(n.args[0], R).flat(); const crit = evalScalar(n.args[1], R); return range.filter((v) => matchesCriteria(v, crit)).length; }
    case "AVERAGEIF": {
      const range = rangeGrid(n.args[0], R).flat();
      const crit = evalScalar(n.args[1], R);
      const avgR = n.args[2] ? rangeGrid(n.args[2], R).flat() : range;
      const xs: number[] = [];
      for (let i = 0; i < range.length; i++) if (matchesCriteria(range[i], crit)) { const num = aggNumber(avgR[i] ?? null); if (num !== null) xs.push(num); }
      if (xs.length === 0) throw new FormulaEvalError("#DIV/0!");
      return round12(xs.reduce((a, b) => a + b, 0) / xs.length);
    }
    case "VLOOKUP": {
      const lookup = evalScalar(n.args[0], R);
      const table = rangeGrid(n.args[1], R);
      const colArg = evalValue(n.args[2], R);
      const returnsArray = Array.isArray(colArg);
      const colIndices = (returnsArray ? colArg : [colArg]).map((value) => Math.trunc(toNumber(value)));
      const approx = n.args[3] ? truthy(evalScalar(n.args[3], R)) : true;
      if (table.length === 0 || colIndices.some((colIdx) => colIdx < 1 || colIdx > table[0].length)) throw new FormulaEvalError("#REF!");
      const project = (row: CellValue[]): EvalValue => returnsArray ? colIndices.map((colIdx) => row[colIdx - 1]) : row[colIndices[0] - 1];
      if (!approx) { for (const row of table) if (looseEqual(row[0], lookup)) return project(row); throw new FormulaEvalError("#N/A"); }
      const ln = toNum(lookup);
      let best = -1;
      for (let i = 0; i < table.length; i++) { const cn = toNum(table[i][0]); if (cn !== null && ln !== null) { if (cn <= ln) best = i; else break; } }
      if (best < 0) throw new FormulaEvalError("#N/A");
      return project(table[best]);
    }
    case "INDEX": {
      const grid = rangeGrid(n.args[0], R);
      const a1 = Math.trunc(toNumber(evalScalar(n.args[1], R)));
      if (!n.args[2]) {
        if (grid.length === 1) { const row = grid[0]; if (a1 < 1 || a1 > row.length) throw new FormulaEvalError("#REF!"); return row[a1 - 1]; }
        if ((grid[0]?.length ?? 0) === 1) { if (a1 < 1 || a1 > grid.length) throw new FormulaEvalError("#REF!"); return grid[a1 - 1][0]; }
      }
      const colNum = n.args[2] ? Math.trunc(toNumber(evalScalar(n.args[2], R))) : 1;
      if (a1 < 1 || a1 > grid.length || colNum < 1 || colNum > (grid[0]?.length ?? 0)) throw new FormulaEvalError("#REF!");
      return grid[a1 - 1][colNum - 1];
    }
    case "MATCH": {
      const lookup = evalScalar(n.args[0], R);
      const arr = rangeGrid(n.args[1], R).flat();
      const mt = n.args[2] ? Math.trunc(toNumber(evalScalar(n.args[2], R))) : 1;
      if (mt === 0) { for (let i = 0; i < arr.length; i++) if (looseEqual(arr[i], lookup)) return i + 1; throw new FormulaEvalError("#N/A"); }
      const ln = toNum(lookup);
      let best = -1;
      for (let i = 0; i < arr.length; i++) { const cn = toNum(arr[i]); if (cn === null || ln === null) continue; if (mt === 1 ? cn <= ln : cn >= ln) best = i; }
      if (best < 0) throw new FormulaEvalError("#N/A");
      return best + 1;
    }
    case "IFERROR": {
      try { return evalScalar(n.args[0], R); }
      catch (e) { if (e instanceof FormulaEvalError) return n.args[1] ? evalScalar(n.args[1], R) : ""; throw e; }
    }
    case "MOD": { const a = toNumber(evalScalar(n.args[0], R)); const b = toNumber(evalScalar(n.args[1], R)); if (b === 0) throw new FormulaEvalError("#DIV/0!"); return round12(a - b * Math.floor(a / b)); }
    case "POWER": { const v = Math.pow(toNumber(evalScalar(n.args[0], R)), toNumber(evalScalar(n.args[1], R))); if (!Number.isFinite(v)) throw new FormulaEvalError("#NUM!"); return round12(v); }
    case "LEN": return String(evalScalar(n.args[0], R) ?? "").length;
    case "LEFT": { const s = String(evalScalar(n.args[0], R) ?? ""); const k = n.args[1] ? Math.trunc(toNumber(evalScalar(n.args[1], R))) : 1; return s.slice(0, Math.max(0, k)); }
    case "RIGHT": { const s = String(evalScalar(n.args[0], R) ?? ""); const k = n.args[1] ? Math.trunc(toNumber(evalScalar(n.args[1], R))) : 1; return k <= 0 ? "" : s.slice(-k); }
    case "MID": { const s = String(evalScalar(n.args[0], R) ?? ""); const start = Math.trunc(toNumber(evalScalar(n.args[1], R))); const len = Math.trunc(toNumber(evalScalar(n.args[2], R))); const from = Math.max(0, start - 1); return s.slice(from, from + Math.max(0, len)); }
    case "TRIM": return String(evalScalar(n.args[0], R) ?? "").trim().replace(/\s+/g, " ");
    case "UPPER": return String(evalScalar(n.args[0], R) ?? "").toUpperCase();
    case "LOWER": return String(evalScalar(n.args[0], R) ?? "").toLowerCase();
    case "TEXT": {
      if (n.args.length !== 2) throw new FormulaEvalError("#ERROR!");
      return formatExcelDateSerial(toNumber(evalScalar(n.args[0], R)), String(evalScalar(n.args[1], R) ?? ""));
    }
  }
  throw new FormulaEvalError("#NAME?");
}

/** Match Excel's 15-significant-digit numeric precision while removing JS dust. */
function round12(x: number): number {
  if (!Number.isFinite(x)) return x;
  return Number(x.toPrecision(15));
}

/**
 * Evaluate a formula string (with or without a leading "=") against a resolver.
 * Never throws: failures come back as `{ error: "#..." }`.
 */
export function evaluateFormula(formula: string, resolver: CellResolver): FormulaResult {
  try {
    const body = formula.trim().replace(/^=/, "").trim();
    if (body === "") return { value: "" };
    const ast = new Parser(tokenize(body)).parse();
    const value = evalScalar(ast, resolver);
    if (typeof value === "number" && !Number.isFinite(value)) return { error: "#NUM!" };
    return { value };
  } catch (e) {
    if (e instanceof FormulaEvalError) return { error: e.code };
    return { error: "#ERROR!" };
  }
}

export const SUPPORTED_FORMULA_FUNCTIONS: readonly string[] = [...SUPPORTED];
