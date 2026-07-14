/**
 * Scenario-based proof for the live grid's formula engine. Not toy asserts: a banker builds a
 * real Q3 P&L on the grid (drivers -> derived metrics -> aggregates -> conditional commentary),
 * then we hit the dangerous failure modes that crash naive recalc (cycles, div/0, error
 * propagation, text-in-arithmetic). The resolver here is the SAME recursive, cycle-guarded,
 * error-propagating shape the live ExcelGridSheet builds — so this also proves the integration
 * pattern, not just the parser.
 */
import { describe, test, expect } from "vitest";
import { evaluateFormula, FormulaEvalError, SUPPORTED_FORMULA_FUNCTIONS, colToIndex, indexToCol, type CellResolver, type CellValue, type FormulaResult } from "../src/nodeagent/core/formulaEngine";

/** Build a sheet from A1-keyed raw values / formula strings, with a recursive cycle-guarded
 *  resolver that mirrors the live grid (computed values flow through; upstream errors propagate). */
function makeSheet(cells: Record<string, number | string>) {
  const cache = new Map<string, FormulaResult>();
  const visiting = new Set<string>();
  const resolver: CellResolver = {
    getCell: (ref) => {
      const r = compute(ref);
      if ("error" in r) throw new FormulaEvalError(r.error); // propagate upstream error code
      return r.value;
    },
  };
  function compute(ref: string): FormulaResult {
    const key = ref.toUpperCase();
    const cached = cache.get(key);
    if (cached) return cached;
    if (visiting.has(key)) return { error: "#CYCLE!" };
    const raw = cells[key];
    if (raw === undefined) return { value: null }; // empty cell
    if (typeof raw === "string" && raw.trim().startsWith("=")) {
      visiting.add(key);
      const res = evaluateFormula(raw, resolver);
      visiting.delete(key);
      cache.set(key, res);
      return res;
    }
    const res: FormulaResult = { value: raw as CellValue };
    cache.set(key, res);
    return res;
  }
  return { compute };
}
const val = (r: FormulaResult) => ("value" in r ? r.value : `ERR:${r.error}`);

describe("A1 column helpers", () => {
  test("round-trip A/Z/AA/AB", () => {
    for (const [letters, idx] of [["A", 1], ["Z", 26], ["AA", 27], ["AB", 28]] as const) {
      expect(colToIndex(letters)).toBe(idx);
      expect(indexToCol(idx)).toBe(letters);
    }
  });
});

describe("Banker builds a Q3 P&L (happy path)", () => {
  // The driver inputs a banker types, then the derived rows as formulas.
  const sheet = makeSheet({
    A1: "Revenue", B1: 12400,
    A2: "COGS", B2: 9000,
    A3: "Gross profit", B3: "=B1-B2",
    A4: "Gross margin", B4: "=B3/B1",
    A5: "OpEx", B5: 2650,
    A6: "Operating income", B6: "=B3-B5",
    A7: "Total opex+cogs", B7: "=SUM(B2,B5)",
    A8: "Avg line item", B8: "=AVERAGE(B1:B2)",
    A9: "Health", B9: '=IF(B4>0.25,"healthy","thin")',
    A10: "Bonus pool", B10: "=IF(B6>1000,ROUND(B6*0.1,0),0)",
  });
  test("gross profit = revenue - COGS", () => expect(val(sheet.compute("B3"))).toBe(3400));
  test("gross margin = GP / revenue", () => expect(val(sheet.compute("B4"))).toBeCloseTo(0.27419, 4));
  test("operating income chains off GP", () => expect(val(sheet.compute("B6"))).toBe(750));
  test("SUM with mixed scalar args", () => expect(val(sheet.compute("B7"))).toBe(11650));
  test("AVERAGE over a range", () => expect(val(sheet.compute("B8"))).toBe(10700));
  test("IF returns the healthy branch", () => expect(val(sheet.compute("B9"))).toBe("healthy"));
  test("nested IF(... ROUND(...)) — bonus is 0 because OI < 1000", () => expect(val(sheet.compute("B10"))).toBe(0));
});

describe("Recalc cascades through dependency chains", () => {
  test("two-level chain D = C*2, C = A+B", () => {
    const s = makeSheet({ A1: 10, B1: 20, C1: "=A1+B1", D1: "=C1*2" });
    expect(val(s.compute("C1"))).toBe(30);
    expect(val(s.compute("D1"))).toBe(60);
  });
  test("editing a driver changes the dependents (fresh sheet = fresh compute)", () => {
    const after = makeSheet({ A1: 100, B1: 20, C1: "=A1+B1", D1: "=C1*2" });
    expect(val(after.compute("D1"))).toBe(240); // 100+20=120, *2=240
  });
});

describe("Functions and operators", () => {
  test("SUM over a range", () => expect(val(makeSheet({ A1: 5, A2: 15, A3: 10, X: "=SUM(A1:A3)" }).compute("X"))).toBe(30));
  test("SUM ignores text + blank cells in a range", () => expect(val(makeSheet({ A1: 5, A2: "txt", A3: 10, A4: "", X: "=SUM(A1:A4)" }).compute("X"))).toBe(15));
  test("MIN / MAX / COUNT / COUNTA over a mixed range", () => {
    const m = makeSheet({ A1: 5, A2: 15, A3: 10, A4: "txt", C1: "=MIN(A1:A4)", C2: "=MAX(A1:A4)", C3: "=COUNT(A1:A4)", C4: "=COUNTA(A1:A4)" });
    expect(val(m.compute("C1"))).toBe(5);
    expect(val(m.compute("C2"))).toBe(15);
    expect(val(m.compute("C3"))).toBe(3); // text excluded from COUNT
    expect(val(m.compute("C4"))).toBe(4); // text counted by COUNTA
  });
  test("operator precedence + parens + power", () => {
    expect(val(makeSheet({ X: "=2+3*4" }).compute("X"))).toBe(14);
    expect(val(makeSheet({ X: "=(2+3)*4" }).compute("X"))).toBe(20);
    expect(val(makeSheet({ X: "=2^10" }).compute("X"))).toBe(1024);
    expect(val(makeSheet({ X: "=-3+ABS(-7)" }).compute("X"))).toBe(4);
  });
  test("percent literal and comparisons", () => {
    expect(val(makeSheet({ X: "=50%" }).compute("X"))).toBe(0.5);
    expect(val(makeSheet({ X: "=10>=10" }).compute("X"))).toBe(true);
    expect(val(makeSheet({ X: "=5<>6" }).compute("X"))).toBe(true);
  });
  test("ROUND / ROUNDUP / ROUNDDOWN", () => {
    expect(val(makeSheet({ X: "=ROUND(3.14159,2)" }).compute("X"))).toBe(3.14);
    expect(val(makeSheet({ X: "=ROUNDUP(3.01,0)" }).compute("X"))).toBe(4);
    expect(val(makeSheet({ X: "=ROUNDDOWN(3.99,0)" }).compute("X"))).toBe(3);
  });
  test("empty referenced cell is treated as 0 in arithmetic", () => {
    expect(val(makeSheet({ A1: 1000, X: "=A1+Z9" }).compute("X"))).toBe(1000);
  });
  test("coerces accounting-formatted numeric strings", () => {
    expect(val(makeSheet({ A1: "(50)", A2: "1,200", X: "=A1+A2" }).compute("X"))).toBe(1150);
  });
  test("floating-point dust is cleaned", () => {
    expect(val(makeSheet({ X: "=0.1+0.2" }).compute("X"))).toBe(0.3);
  });

  test("preserves Excel-scale forecast precision", () => {
    expect(val(makeSheet({ X: "=5620-1251.44166666667" }).compute("X"))).toBe(4368.55833333333);
  });
});

describe("Error handling never crashes, never silently lies", () => {
  test("#DIV/0! on divide by zero", () => expect(val(makeSheet({ X: "=1/0" }).compute("X"))).toBe("ERR:#DIV/0!"));
  test("#DIV/0! on AVERAGE of no numbers", () => expect(val(makeSheet({ A1: "txt", X: "=AVERAGE(A1)" }).compute("X"))).toBe("ERR:#DIV/0!"));
  test("#VALUE! on text in arithmetic", () => expect(val(makeSheet({ A1: "hello", X: "=A1+1" }).compute("X"))).toBe("ERR:#VALUE!"));
  test("#NAME? on unknown function", () => expect(val(makeSheet({ X: "=FROBNICATE(1)" }).compute("X"))).toBe("ERR:#NAME?"));
  test("#VALUE! on a bare range used as a scalar", () => expect(val(makeSheet({ A1: 1, A2: 2, X: "=A1:A2+1" }).compute("X"))).toBe("ERR:#VALUE!"));
  test("malformed formula -> #ERROR!, no throw", () => expect(val(makeSheet({ X: "=1+" }).compute("X"))).toBe("ERR:#ERROR!"));

  test("a 2-cell cycle yields #CYCLE! and does NOT stack-overflow", () => {
    const s = makeSheet({ A1: "=B1", B1: "=A1" });
    expect(val(s.compute("A1"))).toBe("ERR:#CYCLE!");
    expect(val(s.compute("B1"))).toBe("ERR:#CYCLE!");
  });
  test("a 3-cell cycle is caught too", () => {
    const s = makeSheet({ A1: "=B1+1", B1: "=C1+1", C1: "=A1+1" });
    expect(val(s.compute("A1"))).toBe("ERR:#CYCLE!");
  });
  test("upstream error PROPAGATES (Excel semantics): Y=X+1 where X=1/0 is #DIV/0!", () => {
    const s = makeSheet({ X1: "=1/0", Y1: "=X1+1" });
    expect(val(s.compute("Y1"))).toBe("ERR:#DIV/0!");
  });
});

describe("Lookup + criteria functions (the finance power tools)", () => {
  // A small accounts table: A=name, B=tier, C=ARR
  const book = {
    A1: "Acme", B1: "A", C1: 100,
    A2: "Bolt", B2: "B", C2: 50,
    A3: "Cive", B3: "A", C3: 200,
    A4: "Dyno", B4: "C", C4: 25,
  };
  test("SUMIF — total ARR for tier A (separate sum range)", () => expect(val(makeSheet({ ...book, X: '=SUMIF(B1:B4,"A",C1:C4)' }).compute("X"))).toBe(300));
  test("COUNTIF — count tier A", () => expect(val(makeSheet({ ...book, X: '=COUNTIF(B1:B4,"A")' }).compute("X"))).toBe(2));
  test("COUNTIF — numeric criteria >60", () => expect(val(makeSheet({ ...book, X: '=COUNTIF(C1:C4,">60")' }).compute("X"))).toBe(2));
  test("AVERAGEIF — avg ARR for tier A", () => expect(val(makeSheet({ ...book, X: '=AVERAGEIF(B1:B4,"A",C1:C4)' }).compute("X"))).toBe(150));
  test("VLOOKUP exact — ARR for Cive", () => expect(val(makeSheet({ ...book, X: '=VLOOKUP("Cive",A1:C4,3,FALSE)' }).compute("X"))).toBe(200));
  test("VLOOKUP miss -> #N/A", () => expect(val(makeSheet({ ...book, X: '=VLOOKUP("Zzz",A1:C4,3,FALSE)' }).compute("X"))).toBe("ERR:#N/A"));
  test("INDEX/MATCH — ARR where name=Bolt", () => expect(val(makeSheet({ ...book, X: '=INDEX(C1:C4,MATCH("Bolt",A1:A4,0))' }).compute("X"))).toBe(50));
  test("IFERROR wraps #DIV/0! with a fallback", () => expect(val(makeSheet({ X: '=IFERROR(1/0,"n/a")' }).compute("X"))).toBe("n/a"));
  test("IFERROR passes a good value through", () => expect(val(makeSheet({ X: "=IFERROR(2+2,0)" }).compute("X"))).toBe(4));
  test("MOD and POWER", () => {
    expect(val(makeSheet({ X: "=MOD(17,5)" }).compute("X"))).toBe(2);
    expect(val(makeSheet({ X: "=POWER(2,8)" }).compute("X"))).toBe(256);
  });
  test("text functions LEN/LEFT/RIGHT/MID/TRIM/UPPER/LOWER", () => {
    expect(val(makeSheet({ A1: "Anthropic", X: "=LEN(A1)" }).compute("X"))).toBe(9);
    expect(val(makeSheet({ A1: "Anthropic", X: "=LEFT(A1,4)" }).compute("X"))).toBe("Anth");
    expect(val(makeSheet({ A1: "Anthropic", X: "=RIGHT(A1,2)" }).compute("X"))).toBe("ic");
    expect(val(makeSheet({ A1: "Anthropic", X: "=MID(A1,2,3)" }).compute("X"))).toBe("nth");
    expect(val(makeSheet({ A1: "  a   b  ", X: "=TRIM(A1)" }).compute("X"))).toBe("a b");
    expect(val(makeSheet({ A1: "abc", X: "=UPPER(A1)" }).compute("X"))).toBe("ABC");
    expect(val(makeSheet({ A1: "ABC", X: "=LOWER(A1)" }).compute("X"))).toBe("abc");
  });
  test("nested: bonus = ARR * IF(tier=A, 0.1, 0.05) via VLOOKUP", () => {
    const s = makeSheet({ ...book, X: '=C3*IF(VLOOKUP("Cive",A1:C4,2,FALSE)="A",0.1,0.05)' });
    expect(val(s.compute("X"))).toBe(20); // 200 * 0.1
  });
  test("unknown function still -> #NAME?", () => expect(val(makeSheet({ X: "=FOO(1)" }).compute("X"))).toBe("ERR:#NAME?"));
  test("SUPPORTED set exposes the new functions", () => {
    for (const fn of ["SUMIF", "COUNTIF", "AVERAGEIF", "VLOOKUP", "INDEX", "MATCH", "IFERROR", "MOD", "POWER", "LEN"]) expect(SUPPORTED_FORMULA_FUNCTIONS).toContain(fn);
  });
});
