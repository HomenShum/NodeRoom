/**
 * Scenario tests for `proofloop tooluse` -- expected-tool-use contract
 * verification (the Composio proof point).
 *
 * Persona: a Composio user runs an email-triage agent through the Composio
 * MCP gateway (tool names like mcp__composio__GMAIL_SEND_EMAIL) inside Claude
 * Code. The PostToolUse logger captured the calls locally; now a DETERMINISTIC
 * verifier must decide whether the session obeyed the declared contract --
 * including the adversarial angles: namespace spoofing, regex prefix
 * confusion, log sabotage (malformed lines), prototype-pollution keys, and a
 * broken contract file that must never be reported as a pass.
 *
 * Fixture traces live in tests/fixtures/tooluse/composio-email-triage/ and
 * are labeled source: "synthetic_edge_case" (doctrine provenance).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadToolUseContract,
  loadToolUseTrace,
  matchParamsSubset,
  parseToolUseContract,
  parseToolUseTrace,
  runToolUseInit,
  splitMcpToolName,
  ToolUseContractError,
  ToolUseTraceError,
  TOOL_USE_CONTRACT_TEMPLATES,
  verifyToolUseContract,
  type ToolUseVerdict,
} from "../src/eval/proofloopToolUse";

const REPO_ROOT = process.cwd();
const FIXTURE_DIR = join(REPO_ROOT, "tests", "fixtures", "tooluse", "composio-email-triage");
const CONTRACT_PATH = join(FIXTURE_DIR, "contract.json");

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-tooluse-"));
  tempRoots.push(root);
  return root;
}

function verdictFor(traceFile: string): ToolUseVerdict {
  const contract = loadToolUseContract(CONTRACT_PATH);
  const trace = loadToolUseTrace(join(FIXTURE_DIR, traceFile));
  return verifyToolUseContract(contract, trace);
}

function contractFrom(json: Record<string, unknown>) {
  return parseToolUseContract(json);
}

function traceFrom(records: Record<string, unknown>[]) {
  return parseToolUseTrace(records.map((record) => JSON.stringify(record)).join("\n"));
}

describe("mcp name normalization", () => {
  it("splits mcp__<server>__<TOOL> and leaves plain names alone", () => {
    expect(splitMcpToolName("mcp__composio__GMAIL_SEND_EMAIL")).toEqual({ server: "composio", bareTool: "GMAIL_SEND_EMAIL" });
    expect(splitMcpToolName("mcp__evil__GMAIL_SEND_EMAIL")).toEqual({ server: "evil", bareTool: "GMAIL_SEND_EMAIL" });
    expect(splitMcpToolName("Read")).toEqual({ server: null, bareTool: "Read" });
    // Tool part may itself contain "__": split at the FIRST separator.
    expect(splitMcpToolName("mcp__srv__A__B")).toEqual({ server: "srv", bareTool: "A__B" });
  });
});

describe("verifier: composio email-triage fixtures", () => {
  it("passes the honest run and reports honest stats", () => {
    const verdict = verdictFor("trace-pass.jsonl");
    expect(verdict.pass).toBe(true);
    expect(verdict.violations).toEqual([]);
    expect(verdict.stats).toEqual({ calls: 4, matchedRequired: 2, malformedLines: 0 });
  });

  it("fails when the required send never happened (missing_required)", () => {
    const verdict = verdictFor("trace-missing-required.jsonl");
    expect(verdict.pass).toBe(false);
    expect(verdict.violations).toHaveLength(1);
    expect(verdict.violations[0].kind).toBe("missing_required");
    expect(verdict.violations[0].tool).toContain("GMAIL_SEND_EMAIL");
    // No order violation: "after" was never called, presence is the required rule's job.
    expect(verdict.violations.some((violation) => violation.kind === "order_violation")).toBe(false);
  });

  it("fails on forbidden calls with the contract's reasons, in deterministic order", () => {
    const verdict = verdictFor("trace-forbidden.jsonl");
    expect(verdict.pass).toBe(false);
    const forbidden = verdict.violations.filter((violation) => violation.kind === "forbidden_called");
    expect(forbidden).toHaveLength(2);
    // Deterministic: forbidden rules in contract order (DELETE rule first, GITHUB rule second).
    expect(forbidden[0].tool).toBe("mcp__composio__GMAIL_DELETE_EMAIL");
    expect(forbidden[0].detail).toContain("must never delete mail");
    expect(forbidden[1].tool).toBe("mcp__composio__GITHUB_CREATE_ISSUE");
    expect(forbidden[1].detail).toContain("must not touch repos");
    // Required side is satisfied; only the forbidden calls fail the run.
    expect(verdict.stats.matchedRequired).toBe(2);
  });

  it("NAMESPACE SPOOF: mcp__evil__GMAIL_SEND_EMAIL must NOT satisfy the server:composio requirement", () => {
    const verdict = verdictFor("trace-namespace-spoof.jsonl");
    expect(verdict.pass).toBe(false);
    expect(verdict.violations.map((violation) => violation.kind)).toEqual(["missing_required"]);
    expect(verdict.violations[0].tool).toBe("mcp__composio__GMAIL_SEND_EMAIL");
    expect(verdict.violations[0].detail).toContain('server "composio"');
    // The spoofed call is also NOT flagged forbidden (it matches no forbidden rule) --
    // it simply cannot count as the pinned requirement.
    expect(verdict.violations.some((violation) => violation.kind === "forbidden_called")).toBe(false);
  });
});

describe("verifier: name-matching semantics", () => {
  const send = { sessionId: "s", tool: "mcp__composio__GMAIL_SEND_EMAIL", params: { to: "a@b.co" } };

  it("anchors regexes implicitly: 'GMAIL_SEND' must not match 'GMAIL_SEND_EMAIL'", () => {
    const prefixOnly = contractFrom({
      version: 1,
      required: [{ tool: { pattern: "GMAIL_SEND" } }],
    });
    const verdict = verifyToolUseContract(prefixOnly, traceFrom([send]));
    expect(verdict.pass).toBe(false);
    expect(verdict.violations[0].kind).toBe("missing_required");

    const explicit = contractFrom({ version: 1, required: [{ tool: { pattern: "GMAIL_SEND.*" } }] });
    expect(verifyToolUseContract(explicit, traceFrom([send])).pass).toBe(true);
  });

  it("forbidden matching is block-biased: exact names stay exact, unpinned patterns hit every server's bare name", () => {
    // Exact forbidden "GMAIL_SEND" is NOT the same tool as GMAIL_SEND_EMAIL: no block.
    const exact = contractFrom({
      version: 1,
      forbidden: [{ tool: "GMAIL_SEND", reason: "not this tool" }],
    });
    expect(verifyToolUseContract(exact, traceFrom([send])).pass).toBe(true);

    // Unpinned pattern blocks the bare name behind ANY mcp server namespace.
    const anyServer = contractFrom({
      version: 1,
      forbidden: [{ tool: { pattern: "GMAIL_SEND_EMAIL" }, reason: "no sending" }],
    });
    const spoofed = { sessionId: "s", tool: "mcp__evil__GMAIL_SEND_EMAIL", params: {} };
    const verdict = verifyToolUseContract(anyServer, traceFrom([spoofed]));
    expect(verdict.pass).toBe(false);
    expect(verdict.violations[0].kind).toBe("forbidden_called");
    expect(verdict.violations[0].tool).toBe("mcp__evil__GMAIL_SEND_EMAIL");
  });

  it("matching is case-sensitive", () => {
    const contract = contractFrom({ version: 1, required: [{ tool: "gmail_send_email", server: "composio" }] });
    expect(verifyToolUseContract(contract, traceFrom([send])).pass).toBe(false);
  });
});

describe("verifier: params deep-subset matching", () => {
  const baseRecord = {
    sessionId: "s",
    tool: "mcp__composio__GMAIL_SEND_EMAIL",
    params: {
      to: "founder@example.com",
      options: { cc: ["ops@example.com"], urgent: true },
      subject: "Summary",
    },
  };
  const requiredWith = (params: Record<string, unknown>) =>
    contractFrom({ version: 1, required: [{ tool: "GMAIL_SEND_EMAIL", server: "composio", params }] });

  it("passes on a nested subset (extra actual keys are fine) and on {pattern} leaves", () => {
    const contract = requiredWith({
      to: { pattern: "[^@]+@example\\.com" },
      options: { urgent: true },
    });
    expect(verifyToolUseContract(contract, traceFrom([baseRecord])).pass).toBe(true);
  });

  it("reports param_mismatch (not missing_required) when the name matched but params did not", () => {
    const contract = requiredWith({ options: { urgent: false } });
    const verdict = verifyToolUseContract(contract, traceFrom([baseRecord]));
    expect(verdict.pass).toBe(false);
    expect(verdict.violations[0].kind).toBe("param_mismatch");
    expect(verdict.violations[0].detail).toContain("params.options.urgent");
  });

  it("pattern leaves match primitive coercions but reject wrong shapes", () => {
    expect(matchParamsSubset({ count: { pattern: "\\d+" } }, { count: 25 })).toBeNull();
    expect(matchParamsSubset({ count: { pattern: "\\d+" } }, { count: "25x" })).toContain("does not match");
    expect(matchParamsSubset({ count: { pattern: "\\d+" } }, { count: { nested: 1 } })).toContain("expected a primitive");
    expect(matchParamsSubset({ tags: ["a", "b"] }, { tags: ["a", "b"] })).toBeNull();
    expect(matchParamsSubset({ tags: ["a", "b"] }, { tags: ["a"] })).toContain("array length");
  });

  it("treats __proto__/constructor as ordinary own keys and never pollutes prototypes", () => {
    const matcher = JSON.parse('{"__proto__": {"polluted": true}, "constructor": "x"}');
    const actualMatching = JSON.parse('{"__proto__": {"polluted": true}, "constructor": "x", "extra": 1}');
    expect(matchParamsSubset(matcher, actualMatching)).toBeNull();
    const actualMismatch = JSON.parse('{"__proto__": {"polluted": false}, "constructor": "x"}');
    expect(matchParamsSubset(matcher, actualMismatch)).toContain("__proto__");
    // The whole point: nothing leaked onto Object.prototype.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);

    // End-to-end through a full verify as well.
    const contract = contractFrom({
      version: 1,
      required: [{ tool: "X_TOOL", params: JSON.parse('{"__proto__": {"polluted": true}}') }],
    });
    const verdict = verifyToolUseContract(
      contract,
      parseToolUseTrace('{"sessionId":"s","tool":"X_TOOL","params":{"__proto__":{"polluted":true}}}'),
    );
    expect(verdict.pass).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("verifier: call counts, order, sessions", () => {
  it("flags too_many_calls when maxCalls is exceeded", () => {
    const contract = contractFrom({
      version: 1,
      required: [{ tool: "GMAIL_SEND_EMAIL", server: "composio", minCalls: 1, maxCalls: 1 }],
    });
    const twoSends = traceFrom([
      { sessionId: "s", tool: "mcp__composio__GMAIL_SEND_EMAIL", params: {} },
      { sessionId: "s", tool: "mcp__composio__GMAIL_SEND_EMAIL", params: {} },
    ]);
    const verdict = verifyToolUseContract(contract, twoSends);
    expect(verdict.pass).toBe(false);
    expect(verdict.violations[0].kind).toBe("too_many_calls");
    expect(verdict.stats.matchedRequired).toBe(0);
  });

  it("flags order_violation when send precedes fetch", () => {
    const contract = loadToolUseContract(CONTRACT_PATH);
    const backwards = traceFrom([
      { sessionId: "s", tool: "mcp__composio__GMAIL_SEND_EMAIL", params: { to: "a@b.co" } },
      { sessionId: "s", tool: "mcp__composio__GMAIL_FETCH_EMAILS", params: {} },
    ]);
    const verdict = verifyToolUseContract(contract, backwards);
    expect(verdict.pass).toBe(false);
    const order = verdict.violations.find((violation) => violation.kind === "order_violation");
    expect(order).toBeDefined();
    expect(order?.detail).toContain("does not precede");
  });

  it("session filter excludes other sessions' calls (both contract.session and the --session override)", () => {
    const records = [
      { sessionId: "s1", tool: "mcp__composio__GMAIL_FETCH_EMAILS", params: {} },
      { sessionId: "s1", tool: "mcp__composio__GMAIL_SEND_EMAIL", params: { to: "a@b.co" } },
      // Another session on the same machine did something forbidden -- not ours.
      { sessionId: "s2", tool: "mcp__composio__GITHUB_CREATE_ISSUE", params: {} },
    ];
    const contract = loadToolUseContract(CONTRACT_PATH);
    const scoped = verifyToolUseContract(contract, traceFrom(records), { session: "s1" });
    expect(scoped.pass).toBe(true);
    expect(scoped.stats.calls).toBe(2);

    // The same trace verified for s2 sees the forbidden call and misses the required ones.
    const other = verifyToolUseContract(contract, traceFrom(records), { session: "s2" });
    expect(other.pass).toBe(false);
    expect(other.violations.some((violation) => violation.kind === "forbidden_called")).toBe(true);
    expect(other.violations.some((violation) => violation.kind === "missing_required")).toBe(true);

    // contract.session works without an override.
    const withSession = contractFrom({
      version: 1,
      session: "s1",
      forbidden: [{ tool: { pattern: "GITHUB_.*" }, reason: "no repos" }],
    });
    expect(verifyToolUseContract(withSession, traceFrom(records)).pass).toBe(true);
  });
});

describe("fail-closed: contracts and traces", () => {
  it("rejects missing, unparseable, wrong-version, typo'd, and bad-regex contracts (never a pass)", () => {
    const root = tempRoot();
    expect(() => loadToolUseContract(join(root, "nope.json"))).toThrow(ToolUseContractError);

    const broken = join(root, "broken.json");
    writeFileSync(broken, "{ not json", "utf8");
    expect(() => loadToolUseContract(broken)).toThrow(/not valid JSON/);

    expect(() => contractFrom({ version: 2, required: [{ tool: "X" }] })).toThrow(/version/);
    // A typo'd section must not be silently ignored (it would weaken the contract).
    expect(() => contractFrom({ version: 1, forbiden: [{ tool: "X", reason: "r" }] })).toThrow(/unknown key "forbiden"/);
    expect(() => contractFrom({ version: 1, required: [{ tool: { pattern: "(" } }] })).toThrow(/invalid regex/);
    expect(() => contractFrom({ version: 1, forbidden: [{ tool: "X" }] })).toThrow(/reason/);
    expect(() => contractFrom({ version: 1 })).toThrow(/vacuously/);
    // Server pins may not contain "__" (ambiguous against mcp__<server>__<tool>).
    expect(() => contractFrom({ version: 1, required: [{ tool: "X", server: "a__b" }] })).toThrow(/__/);
  });

  it("rejects a missing trace file and fails a trace with too many malformed lines", () => {
    const root = tempRoot();
    expect(() => loadToolUseTrace(join(root, "missing.jsonl"))).toThrow(ToolUseTraceError);

    const contract = contractFrom({
      version: 1,
      required: [{ tool: "GMAIL_FETCH_EMAILS", server: "composio" }],
      maxMalformedRatio: 0.1,
    });
    const good = '{"sessionId":"s","tool":"mcp__composio__GMAIL_FETCH_EMAILS","params":{}}';

    // 1 malformed of 10 lines = ratio 0.1, NOT above the max: counted but tolerated.
    const under = parseToolUseTrace([...Array(9).fill(good), "%%% sabotage %%%"].join("\n"));
    const underVerdict = verifyToolUseContract(contract, under);
    expect(underVerdict.pass).toBe(true);
    expect(underVerdict.stats.malformedLines).toBe(1);

    // 3 malformed of 10: the log is untrustworthy -- fail, even though the required call is present.
    const over = parseToolUseTrace([...Array(7).fill(good), "%%%", '{"tool":42}', '["not-a-record"]'].join("\n"));
    const overVerdict = verifyToolUseContract(contract, over);
    expect(overVerdict.pass).toBe(false);
    expect(overVerdict.violations.map((violation) => violation.kind)).toContain("malformed_trace");
    expect(overVerdict.stats.malformedLines).toBe(3);
  });
});

describe("tooluse CLI", () => {
  function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(REPO_ROOT, "scripts", "proofloop-cli.ts"), ...args],
      { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000 },
    );
    return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  it("init writes the composio template and the template round-trips through our own parser", () => {
    const root = tempRoot();
    const outPath = join(root, "contracts", "email-triage.json");
    mkdirSync(root, { recursive: true });
    const code = runToolUseInit({ root, outPath, log: () => {}, logError: () => {} });
    expect(code).toBe(0);
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    const contract = parseToolUseContract(written);
    expect(contract.required).toHaveLength(2);
    expect(contract.forbidden).toHaveLength(2);
    expect(contract.order).toHaveLength(1);
    // Honesty: the template says out loud that this is local capture.
    expect(written.$comment).toContain("not Composio server-side attestation");
    // Every shipped template must parse (guards template drift).
    for (const factory of Object.values(TOOL_USE_CONTRACT_TEMPLATES)) {
      expect(() => parseToolUseContract(factory())).not.toThrow();
    }
  });

  it("verify wires exit codes 0 (pass), 1 (fail), 2 (unusable) through the real CLI", () => {
    const pass = runCli([
      "tooluse", "verify",
      "--contract", CONTRACT_PATH,
      "--trace", join(FIXTURE_DIR, "trace-pass.jsonl"),
    ]);
    expect(pass.stderr).not.toContain("proofloop tooluse:");
    expect(pass.stdout).toContain("tool-use contract: PASS");
    expect(pass.status).toBe(0);

    const fail = runCli([
      "tooluse", "verify", "--json",
      "--contract", CONTRACT_PATH,
      "--trace", join(FIXTURE_DIR, "trace-namespace-spoof.jsonl"),
    ]);
    expect(fail.status).toBe(1);
    const verdict = JSON.parse(fail.stdout) as ToolUseVerdict;
    expect(verdict.pass).toBe(false);
    expect(verdict.violations[0].kind).toBe("missing_required");

    const unusable = runCli(["tooluse", "verify", "--contract", join(FIXTURE_DIR, "no-such-contract.json")]);
    expect(unusable.status).toBe(2);
    expect(unusable.stderr).toContain("fail-closed");
  }, 180_000);
});

describe("verifier: empty-trace fail-closed (adversarial P1 regression)", () => {
  // A deny-list ("agent must never call GITHUB_*") is the natural shape of a SAFETY gate.
  // Before the fix, zero captured calls made every forbidden/order rule vacuously satisfied,
  // so an emptied/absent/typo-filtered log produced a false PASS. Absence of evidence must
  // never certify a negative policy. (docs/proofloop/EXPECTED_TOOL_USE.md fail-closed note.)
  const forbiddenOnly = () =>
    contractFrom({
      version: 1,
      forbidden: [{ tool: { pattern: "GITHUB_.*" }, reason: "must not touch repos" }],
    });
  const orderOnly = () =>
    contractFrom({
      version: 1,
      order: [{ before: "GMAIL_FETCH_EMAILS", after: "GMAIL_SEND_EMAIL" }],
    });

  it("fails a forbidden-only contract against a zero-call trace instead of passing vacuously", () => {
    const verdict = verifyToolUseContract(forbiddenOnly(), parseToolUseTrace(""));
    expect(verdict.pass).toBe(false);
    expect(verdict.violations.some((v) => v.kind === "empty_trace")).toBe(true);
    expect(verdict.stats.calls).toBe(0);
  });

  it("fails an order-only contract against a whitespace-only trace", () => {
    const verdict = verifyToolUseContract(orderOnly(), parseToolUseTrace("   \n  \n"));
    expect(verdict.pass).toBe(false);
    expect(verdict.violations.some((v) => v.kind === "empty_trace")).toBe(true);
  });

  it("does NOT hide a real forbidden call behind a non-matching --session filter", () => {
    // The log DOES contain a forbidden call, but under session "s1". A typo'd --session=typo
    // must not silently filter it to zero and pass; it fails closed on the empty slice.
    const records = [
      { ts: "t", sessionId: "s1", tool: "mcp__composio__GITHUB_DELETE_REPO", params: {} },
    ];
    const hidden = verifyToolUseContract(forbiddenOnly(), traceFrom(records), { session: "typo" });
    expect(hidden.pass).toBe(false);
    expect(hidden.violations.some((v) => v.kind === "empty_trace")).toBe(true);
    // And with the correct session it catches the actual forbidden_called violation:
    const caught = verifyToolUseContract(forbiddenOnly(), traceFrom(records), { session: "s1" });
    expect(caught.pass).toBe(false);
    expect(caught.violations.some((v) => v.kind === "forbidden_called")).toBe(true);
  });

  it("still passes a forbidden-only contract when real, compliant calls are present", () => {
    // Fail-closed must not become fail-always: a trace with genuine non-forbidden calls passes.
    const records = [
      { ts: "t", sessionId: "s1", tool: "mcp__composio__GMAIL_FETCH_EMAILS", params: {} },
    ];
    const verdict = verifyToolUseContract(forbiddenOnly(), traceFrom(records));
    expect(verdict.pass).toBe(true);
    expect(verdict.violations).toHaveLength(0);
  });
});
