/**
 * Scenario: an analyst runs a NodeRoom task on an engine without native file
 * tools. The agent reads sources, writes a cited report, a notebook and runs
 * the template's checks. A curious (or prompt-injected) agent also tries to
 * read outside the workspace, read a restricted filing and write into .claude/.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { z } from "zod";
import type { EngineEventDraft, NodeToolContext, NodeToolResult, TemplateConfig } from "../src/contract.js";
import { buildNodeToolCatalog } from "../src/tools/catalog.js";
import { parseCitations } from "../src/tools/citations.js";
import { isRestricted, resolveInside, toRel } from "../src/tools/workspaceFs.js";
import { parseTestSummary } from "../src/checks.js";

const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function write(root: string, rel: string, text: string) {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

function setup(template: Partial<TemplateConfig> = {}, nativeFileTools = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), "nodeagent-tools-"));
  roots.push(root);
  const ws = path.join(root, "ws");
  const state = path.join(root, "state");
  mkdirSync(ws, { recursive: true });
  const tpl: TemplateConfig = { id: "t", title: "t", description: "", restrictedGlobs: ["sources/restricted/**", "**/*.secret.md"], checks: {}, ...template };
  const events: EngineEventDraft[] = [];
  const controller = new AbortController();
  const ctx: NodeToolContext = { runId: "run-1", workspaceDir: ws, nodeStateDir: state, template: tpl, signal: controller.signal, emit: (e) => events.push(e) };
  const tools = buildNodeToolCatalog({ nativeFileTools });
  const call = async (name: string, args: unknown, over: Partial<NodeToolContext> = {}): Promise<NodeToolResult> => {
    const t = tools.find((x) => x.name === name);
    assert.ok(t, `tool ${name} exists`);
    return t.execute(t.schema.parse(args), { ...ctx, ...over });
  };
  return { root, ws, state, events, controller, tools, call, ctx };
}

describe("catalog shape", () => {
  it("engines with native file tools do not get Node duplicates; always-loaded set is fixed", () => {
    const withFs = buildNodeToolCatalog({ nativeFileTools: false });
    const noFs = buildNodeToolCatalog({ nativeFileTools: true });
    const ws = ["list_files", "read_file", "write_file", "edit_file", "search_text"];
    for (const n of ws) {
      assert.ok(withFs.some((t) => t.name === n && t.family === "workspace"));
      assert.ok(!noFs.some((t) => t.name === n));
    }
    assert.deepEqual(noFs.filter((t) => t.alwaysLoad).map((t) => t.name).sort(), ["list_sources", "load_tool", "run_checks", "search_tools", "update_goals"]);
    const names = new Set<string>();
    for (const t of withFs) {
      assert.ok(!names.has(t.name), `unique name ${t.name}`);
      names.add(t.name);
      assert.ok(t.schema instanceof z.ZodObject, `${t.name} schema is z.object`);
      assert.equal((z.toJSONSchema(t.schema) as { type: string }).type, "object");
      if (!t.alwaysLoad) assert.ok(t.searchHint, `${t.name} deferred tools carry a searchHint`);
    }
  });
});

describe("workspace boundary (adversarial paths)", () => {
  it("refuses ../../outside, absolute paths outside, and junction/symlink escapes", async () => {
    const { root, ws, call } = setup();
    write(root, "outside.txt", "TOP SECRET OUTSIDE");
    write(ws, "notes.md", "inside\n");
    for (const p of ["../../outside", "../outside.txt", path.join(root, "outside.txt"), "C:\\Windows\\win.ini", "\\\\server\\share\\x.txt", "notes.md\0.txt"]) {
      const r = await call("read_file", { path: p });
      assert.equal(r.ok, false, `refused ${JSON.stringify(p)}`);
      assert.ok(!r.content.includes("TOP SECRET"));
    }
    // Junctions need no admin rights on Windows; plain dir symlinks elsewhere.
    symlinkSync(root, path.join(ws, "escape"), process.platform === "win32" ? "junction" : "dir");
    assert.equal(resolveInside(ws, "escape/outside.txt"), null);
    const r = await call("read_file", { path: "escape/outside.txt" });
    assert.equal(r.ok, false);
    const w = await call("write_file", { path: "escape/planted.txt", content: "x" });
    assert.equal(w.ok, false);
    assert.equal(existsSync(path.join(root, "planted.txt")), false);
  });

  it("path helpers: inside paths resolve (case-insensitive on Windows), globs match **, *, ?", () => {
    const { ws } = setup();
    assert.ok(resolveInside(ws, "a/b/../c.txt"));
    assert.equal(resolveInside(ws, ""), null);
    assert.equal(toRel(ws, path.join(ws, "a", "b.txt")), "a/b.txt");
    if (process.platform === "win32") {
      assert.ok(resolveInside(ws, path.join(ws.toUpperCase(), "x.txt")), "drive/case-insensitive compare");
      assert.equal(resolveInside(ws, "file.txt:stream"), null, "NTFS alternate data stream refused");
    }
    assert.ok(isRestricted("sources/restricted", ["sources/restricted/**"]));
    assert.ok(isRestricted("sources\\restricted\\deep\\x.md", ["sources/restricted/**"]));
    assert.ok(isRestricted("a/b/c.secret.md", ["**/*.secret.md"]));
    assert.ok(isRestricted("x.secret.md", ["**/*.secret.md"]));
    assert.ok(isRestricted("data/f1.csv", ["data/f?.csv"]));
    assert.ok(!isRestricted("data/f10.csv", ["data/f?.csv"]));
    assert.ok(!isRestricted("sources/public/x.md", ["sources/restricted/**", "*.env"]));
    assert.ok(isRestricted("config/.env", ["**/.env"]));
    assert.ok(!isRestricted("sources/restrictedish/x.md", ["sources/restricted/**"]));
  });

  it("happy path: read with offset/limit is line-numbered; write and unique edit; .claude/ and restricted writes refused", async () => {
    const { ws, call } = setup();
    write(ws, "data/report.md", "l1\nl2\nl3\nl4\n");
    const r = await call("read_file", { path: "data/report.md", offset: 2, limit: 2 });
    assert.ok(r.ok);
    assert.match(r.content, /lines 2-3 of 4/);
    assert.match(r.content, /^\s+2\tl2$/m);
    assert.ok(!r.content.includes("l1") && !r.content.includes("l4"));

    assert.ok((await call("write_file", { path: "out/summary.md", content: "alpha beta alpha\n" })).ok);
    const dup = await call("edit_file", { path: "out/summary.md", old_string: "alpha", new_string: "gamma" });
    assert.equal(dup.ok, false);
    assert.match(dup.content, /more than once/);
    assert.ok((await call("edit_file", { path: "out/summary.md", old_string: "beta", new_string: "delta" })).ok);
    assert.equal(readFileSync(path.join(ws, "out/summary.md"), "utf8"), "alpha delta alpha\n");

    const sk = await call("write_file", { path: ".claude/skills/evil/SKILL.md", content: "---\nname: evil\n---\n" });
    assert.equal(sk.ok, false);
    assert.match(sk.content, /only Node writes under \.claude/);
    assert.equal(existsSync(path.join(ws, ".claude")), false);
    const rs = await call("write_file", { path: "sources/restricted/new.md", content: "x" });
    assert.equal(rs.ok, false);
    assert.match(rs.content, /permission denied by workspace policy/);
  });

  it("search_text and list_files never leak restricted content", async () => {
    const { ws, call } = setup();
    write(ws, "sources/public/a.md", "# A\nrevenue grew 12%\n");
    write(ws, "sources/restricted/m.md", "# Merger\nrevenue CONFIDENTIAL-MNA\n");
    write(ws, "notes/plan.secret.md", "revenue SECRET-PLAN\n");
    const s = await call("search_text", { pattern: "revenue" });
    assert.ok(s.ok);
    assert.match(s.content, /sources\/public\/a\.md:2:/);
    assert.ok(!s.content.includes("CONFIDENTIAL") && !s.content.includes("SECRET-PLAN"));
    assert.match(s.content, /2 restricted files skipped/);
    const md = await call("search_text", { pattern: "grew", glob: "**/*.md" });
    assert.match(md.content, /1 matches/);
    const bad = await call("search_text", { pattern: "(" });
    assert.equal(bad.ok, false);
    const l = await call("list_files", {});
    assert.match(l.content, /sources\/restricted\/m\.md\t\(unavailable: restricted by workspace policy\)/);
  });
});

describe("restricted policy cannot be sidestepped by aliases", () => {
  it("an in-workspace junction, different casing or an 8.3 short name still hits the restricted glob", async (t) => {
    const { ws, call } = setup();
    write(ws, "sources/restricted/deal.md", "CONFIDENTIAL TERMS\n");
    symlinkSync(path.join(ws, "sources", "restricted"), path.join(ws, "alias"), process.platform === "win32" ? "junction" : "dir");
    const viaLink = await call("read_file", { path: "alias/deal.md" });
    assert.equal(viaLink.ok, false);
    assert.match(viaLink.content, /sources\/restricted\/deal\.md: permission denied/);
    assert.equal(toRel(ws, resolveInside(ws, "alias/deal.md")!), "sources/restricted/deal.md");
    assert.equal((await call("check_citations", { path: "alias/deal.md" })).ok, false);
    if (process.platform === "win32") {
      assert.equal((await call("read_source", { path: "SOURCES/Restricted/deal.md" })).ok, false);
      const short = path.join(ws, "sources", "RESTRI~1");
      if (existsSync(short)) {
        const r = await call("read_file", { path: "sources/RESTRI~1/deal.md" });
        assert.equal(r.ok, false);
        assert.ok(!r.content.includes("CONFIDENTIAL"));
      } else t.diagnostic("8.3 short names disabled on this volume; short-name alias not exercised");
    }
  });
});

describe("sources", () => {
  it("lists docs with heading and line count; restricted docs listed as unavailable with no content", async () => {
    const { ws, call } = setup();
    write(ws, "sources/filings/q3.md", "intro\n# Q3 Filing\nline3\n");
    write(ws, "sources/restricted/deal.md", "# Project Falcon\nCONFIDENTIAL TERMS\n");
    write(ws, "sources/data.csv", "a,b\n1,2\n");
    const r = await call("list_sources", {});
    assert.ok(r.ok);
    assert.match(r.content, /sources\/filings\/q3\.md \| 3 lines \| Q3 Filing/);
    assert.match(r.content, /sources\/restricted\/deal\.md \| unavailable: restricted by workspace policy/);
    assert.match(r.content, /sources\/data\.csv \| 2 lines \| \(no heading\)/);
    assert.ok(!r.content.includes("Falcon") && !r.content.includes("CONFIDENTIAL"));
    const sub = await call("list_sources", { folder: "filings" });
    assert.match(sub.content, /^1 sources/);
    assert.equal((await call("list_sources", { folder: "../.." })).ok, false);
  });

  it("read_source returns the honest denial for restricted docs and line-numbered ranges otherwise", async () => {
    const { ws, call } = setup();
    write(ws, "sources/filings/q3.md", "a\nb\nc\nd\n");
    write(ws, "sources/restricted/deal.md", "CONFIDENTIAL\n");
    write(ws, "secret.txt", "not a source\n");
    const denied = await call("read_source", { path: "sources/restricted/deal.md" });
    assert.equal(denied.ok, false);
    assert.match(denied.content, /permission denied by workspace policy/);
    assert.ok(!denied.content.includes("CONFIDENTIAL"));
    const r = await call("read_source", { path: "filings/q3.md", startLine: 2, endLine: 3 });
    assert.ok(r.ok);
    assert.match(r.content, /sources\/filings\/q3\.md lines 2-3 of 4/);
    assert.match(r.content, /^\s+3\tc$/m);
    assert.equal((await call("read_source", { path: "../secret.txt" })).ok, false);
    assert.equal((await call("read_source", { path: "sources/filings/q3.md", startLine: 9 })).ok, false);
    assert.equal((await call("read_source", { path: "sources/missing.md" })).ok, false);
  });
});

describe("citations", () => {
  it("flags a bad line range, a restricted citation and a missing file; counts valid ones", async () => {
    const { ws, call } = setup();
    write(ws, "sources/filings/q3.md", "1\n2\n3\n4\n5\n");
    write(ws, "sources/restricted/deal.md", "x\n");
    write(
      ws,
      "report.md",
      [
        "Revenue grew [src:sources/filings/q3.md#L2-L4].",
        "Margin [src:sources/filings/q3.md#L5] and [src:sources/filings/q3.md#L4-L9].",
        "Deal [src:sources/restricted/deal.md#L1].",
        "Ghost [src:sources/nope.md#L1] escape [src:../../etc/passwd#L1] backwards [src:sources/filings/q3.md#L3-L2].",
      ].join("\n"),
    );
    assert.equal(parseCitations("[src:a.md#L1] [src:b.md#L2-L3] [src:bad#X1]").length, 2);
    const r = await call("check_citations", { path: "report.md" });
    assert.equal(r.ok, false);
    const d = r.data as { total: number; valid: number; invalid: number; failures: Array<{ reason: string; line: number }> };
    assert.equal(d.total, 7);
    assert.equal(d.valid, 2);
    assert.equal(d.invalid, 5);
    const reasons = d.failures.map((f) => f.reason).join(" | ");
    assert.match(reasons, /exceeds sources\/filings\/q3\.md \(5 lines\)/);
    assert.match(reasons, /restricted by workspace policy/);
    assert.match(reasons, /does not exist/);
    assert.match(reasons, /outside the workspace/);
    assert.match(reasons, /invalid line range L3-L2/);
    write(ws, "clean.md", "ok [src:sources/filings/q3.md#L1-L5]\n");
    assert.equal((await call("check_citations", { path: "clean.md" })).ok, true);
  });
});

describe("run_checks", () => {
  const tinyProject = (ws: string) => {
    write(ws, "tests/math.test.mjs", 'import {test} from "node:test";\nimport assert from "node:assert";\ntest("adds", () => assert.equal(1 + 1, 2));\ntest("mults", () => assert.equal(2 * 3, 6));\ntest("broken", () => assert.equal(1, 2));\n');
    write(ws, "green/ok.test.mjs", 'import {test} from "node:test";\ntest("one", () => {});\ntest("two", () => {});\n');
    write(ws, "hang/hang.mjs", "setInterval(() => {}, 1000);\n");
  };

  it("parses pass/fail counts from a real node:test run, emits check.result and appends checks.jsonl", async () => {
    const { ws, state, events, call } = setup({
      checks: {
        unit: { cwd: "tests", command: ["node", "--test", "math.test.mjs"], timeoutMs: 60_000 },
        green: { cwd: "green", command: ["node", "--test", "--test-reporter=tap", "ok.test.mjs"], timeoutMs: 60_000 },
      },
    });
    tinyProject(ws);
    const red = await call("run_checks", { suite: "unit" });
    assert.equal(red.ok, false, red.content);
    assert.deepEqual([(red.data as { passed: number }).passed, (red.data as { failed: number }).failed], [2, 1]);
    const ev = events.find((e) => e.type === "check.result");
    assert.ok(ev && ev.type === "check.result");
    assert.equal(ev.independent, false);
    assert.equal(ev.passed, 2);
    assert.equal(ev.failed, 1);
    assert.ok(ev.outputTail.length <= 4096);

    const green = await call("run_checks", { suite: "green" });
    assert.equal(green.ok, true, green.content);
    assert.match(green.content, /2 passed, 0 failed/);
    const lines = readFileSync(path.join(state, "checks.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].runId, "run-1");
    assert.equal(lines[0].independent, false);
  });

  it("refuses unknown and prototype-key suites, times out a hanging check, honours abort", async () => {
    const { ws, events, call } = setup({
      checks: {
        hang: { cwd: "hang", command: ["node", "hang.mjs"], timeoutMs: 800 },
        hangLong: { cwd: "hang", command: ["node", "hang.mjs"], timeoutMs: 30_000 },
        escape: { cwd: "..", command: ["node", "-e", "0"], timeoutMs: 5000 },
      },
    });
    tinyProject(ws);
    for (const suite of ["nope", "constructor", "__proto__", "toString"]) {
      const r = await call("run_checks", { suite });
      assert.equal(r.ok, false);
      assert.match(r.content, /unknown check suite/);
    }
    const esc = await call("run_checks", { suite: "escape" });
    assert.equal(esc.ok, false);
    assert.match(esc.content, /outside the workspace/);
    const t0 = Date.now();
    const hung = await call("run_checks", { suite: "hang" });
    assert.equal(hung.ok, false);
    assert.match(hung.content, /timed out after 800ms/);
    assert.ok(Date.now() - t0 < 15_000);
    const ac = new AbortController();
    const t1 = Date.now();
    const p = call("run_checks", { suite: "hangLong" }, { signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    const ab = await p;
    assert.equal(ab.ok, false);
    assert.match(ab.content, /; aborted$/);
    assert.ok(Date.now() - t1 < 15_000, "abort ends the check well before its 30s timeout");
    assert.equal(events.filter((e) => e.type === "check.result").length, 2, "refused suites emit no check.result");
  });

  it("summary parser handles TAP and spec reporters, and reports none when absent", () => {
    assert.deepEqual(parseTestSummary("# tests 3\n# pass 2\n# fail 1\n"), { passed: 2, failed: 1 });
    assert.deepEqual(parseTestSummary("\x1b[34mℹ pass 5\x1b[39m\nℹ fail 0\n"), { passed: 5, failed: 0 });
    assert.equal(parseTestSummary("all good!\n"), null);
  });
});

describe("notebook", () => {
  it("creates then extends a valid nbformat 4.5 notebook and refuses to clobber non-notebooks", async () => {
    const { ws, call } = setup();
    const a = await call("notebook_add_cell", { path: "analysis/q3.ipynb", cell_type: "markdown", source: "# Q3\nRevenue review\n" });
    assert.ok(a.ok, a.content);
    const b = await call("notebook_add_cell", { path: "analysis/q3.ipynb", cell_type: "code", source: "x = 1\nprint(x)" });
    assert.ok(b.ok);
    const nb = JSON.parse(readFileSync(path.join(ws, "analysis/q3.ipynb"), "utf8"));
    assert.equal(nb.nbformat, 4);
    assert.equal(nb.nbformat_minor, 5);
    assert.equal(typeof nb.metadata, "object");
    assert.equal(nb.cells.length, 2);
    const [md, code] = nb.cells;
    assert.equal(md.cell_type, "markdown");
    assert.deepEqual(md.source, ["# Q3\n", "Revenue review\n"]);
    assert.equal(code.cell_type, "code");
    assert.deepEqual(code.source, ["x = 1\n", "print(x)"]);
    assert.equal(code.execution_count, null);
    assert.deepEqual(code.outputs, []);
    assert.ok(md.id && code.id && md.id !== code.id && /^[A-Za-z0-9-_]{1,64}$/.test(md.id));
    write(ws, "notes.ipynb", "not json");
    const clobber = await call("notebook_add_cell", { path: "notes.ipynb", cell_type: "code", source: "1" });
    assert.equal(clobber.ok, false);
    assert.equal(readFileSync(path.join(ws, "notes.ipynb"), "utf8"), "not json");
    assert.equal((await call("notebook_add_cell", { path: "x.txt", cell_type: "code", source: "1" })).ok, false);
  });
});

describe("goals and tool-meta", () => {
  it("update_goals emits engine-claimed goals; rejects unknown deps and duplicate ids", async () => {
    const { events, call } = setup();
    const r = await call("update_goals", { goals: [{ id: "g1", title: "Read filings", status: "done" }, { id: "g2", title: "Write report", status: "active", dependsOn: ["g1"] }] }, { agentId: "helper-7" });
    assert.ok(r.ok);
    const ev = events.find((e) => e.type === "goals.updated");
    assert.ok(ev && ev.type === "goals.updated");
    assert.equal(ev.source, "node-goals");
    assert.equal(ev.agentId, "helper-7");
    assert.ok(ev.goals.every((g) => g.claimedBy === "engine"));
    assert.equal((await call("update_goals", { goals: [{ id: "a", title: "x", status: "pending", dependsOn: ["zzz"] }] })).ok, false);
    assert.equal((await call("update_goals", { goals: [{ id: "a", title: "x", status: "pending" }, { id: "a", title: "y", status: "done" }] })).ok, false);
    assert.equal(events.filter((e) => e.type === "goals.updated").length, 1);
  });

  it("search_tools finds deferred tools in this catalog; load_tool returns JSON schemas and emits tool.loaded", async () => {
    const { events, call } = setup({}, true);
    const s = await call("search_tools", { query: "jupyter notebook" });
    assert.ok(s.ok);
    assert.match(s.content.split("\n")[0], /^notebook_add_cell \[notebook\] \(deferred\)/);
    assert.ok(!s.content.includes("read_file"), "native-file engines never see Node file tools");
    const se = events.find((e) => e.type === "tool.search");
    assert.ok(se && se.type === "tool.search" && se.via === "node" && se.results[0] === "notebook_add_cell");
    const l = await call("load_tool", { names: ["notebook_add_cell", "check_citations", "made_up"] });
    assert.ok(l.ok);
    const payload = JSON.parse(l.content);
    assert.deepEqual(payload.unknown, ["made_up"]);
    assert.deepEqual(payload.tools[0].inputSchema.properties.cell_type.enum, ["markdown", "code"]);
    const le = events.find((e) => e.type === "tool.loaded");
    assert.ok(le && le.type === "tool.loaded");
    assert.deepEqual(le.names, ["notebook_add_cell", "check_citations"]);
    assert.equal(le.via, "node-load-tool");
    const none = await call("load_tool", { names: ["nope"] });
    assert.equal(none.ok, false);
    assert.equal(events.filter((e) => e.type === "tool.loaded").length, 1);
  });
});

describe("wiring and bounds", () => {
  it("the real gateway constructs this catalog and routes calls through it (schema errors honest, not thrown)", async () => {
    const { createGateway } = await import("../src/tools/gateway.js");
    const { ws, state, ctx } = setup();
    write(ws, "sources/a.md", "# A\nx\n");
    const events: EngineEventDraft[] = [];
    const gw = createGateway({ runId: "run-gw", workspaceDir: ws, nodeStateDir: state, template: ctx.template, nativeFileTools: false, signal: new AbortController().signal, emit: (e) => events.push(e) });
    assert.ok(gw.get("read_file") && gw.get("list_sources"));
    assert.equal((await gw.call("read_file", { path: "../../outside" }, {})).ok, false);
    const bad = await gw.call("read_file", { path: 42 }, {});
    assert.equal(bad.ok, false);
    assert.match(bad.content, /Invalid arguments/);
    const ls = await gw.call("list_sources", {}, { callId: "c1" });
    assert.ok(ls.ok);
    assert.equal(ls.callId, "c1");
    assert.equal((gw.jsonSchema("draft_skill") as { type: string }).type, "object");
  });

  it("burst and sustained use stay bounded: 1200-file tree, 5000-line search, 40 parallel calls", async () => {
    const { ws, events, call } = setup();
    for (let i = 0; i < 1200; i++) write(ws, `bulk/d${i % 12}/f${i}.txt`, `row ${i}\n`);
    write(ws, "big.txt", Array.from({ length: 5000 }, (_, i) => `needle ${i}`).join("\n"));
    const l = await call("list_files", { path: "bulk" });
    assert.match(l.content, /^500 files under bulk \(truncated at 500\)/);
    const s = await call("search_text", { pattern: "needle", path: "big.txt", maxMatches: 200 });
    assert.match(s.content, /^200 matches in 1 files \(stopped at 200\)/);
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        i % 2 ? call("search_tools", { query: "citations" }) : call("update_goals", { goals: [{ id: `g${i}`, title: `goal ${i}`, status: "active" }] }),
      ),
    );
    assert.ok(results.every((r) => r.ok));
    assert.equal(events.filter((e) => e.type === "goals.updated").length, 20);
    assert.equal(events.filter((e) => e.type === "tool.search").length, 20);
    const r = await call("read_file", { path: "big.txt", offset: 4999 });
    assert.match(r.content, /lines 4999-5000 of 5000/);
  });
});
