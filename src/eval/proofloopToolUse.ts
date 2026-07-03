/**
 * Proof Loop expected-tool-use contracts -- `proofloop tooluse <verify|init>`.
 *
 * The Composio proof point: agents that work through an MCP gateway call tools
 * with names like `mcp__composio__GMAIL_SEND_EMAIL`. The PostToolUse logger
 * written by `proofloop hooks install` (see src/eval/proofloopHooks.ts)
 * captures every tool call into `.proofloop/tooluse/log.jsonl`, and this
 * module's DETERMINISTIC verifier checks that capture against a declared
 * contract:
 *
 *   - required:  tools the agent MUST have called (optionally pinned to one
 *                MCP server namespace, with deep-subset param matching)
 *   - forbidden: tools the agent must NOT have called (block-biased matching)
 *   - order:     the first satisfied "before" call must precede the first
 *                "after" call
 *
 * HONEST BOUNDARY: this is LOCAL capture on the machine that ran the worker
 * session. It proves what this session's tool hooks saw -- it is NOT
 * server-side attestation from Composio (or any MCP provider), and calls
 * issued outside tool hooks (e.g. curl inside a Bash tool) are not captured.
 * See docs/proofloop/EXPECTED_TOOL_USE.md.
 *
 * FAIL-CLOSED: a missing/unparseable contract or a missing trace file is a
 * hard error (CLI exit 2), never a pass. Malformed trace lines are counted,
 * and a malformed ratio above maxMalformedRatio fails verification -- a
 * verifier that failed open here would reward log sabotage
 * (noderl/spec/anti-reward-hacking-doctrine.md). No LLM anywhere.
 *
 * Contracts are JSON (this repo deliberately has no YAML parser dependency;
 * zero new npm deps).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Repo-relative path the PostToolUse logger appends to (forward slashes). */
export const TOOL_USE_LOG_RELATIVE_PATH = ".proofloop/tooluse/log.jsonl";

export const TOOL_USE_CONTRACT_VERSION = 1;
export const DEFAULT_MAX_MALFORMED_RATIO = 0.1;

/** Contract file is unusable (missing, unparseable, invalid). CLI exit 2. */
export class ToolUseContractError extends Error {}
/** Trace file is unusable (missing / unreadable). CLI exit 2. */
export class ToolUseTraceError extends Error {}

// ---------------------------------------------------------------------------
// contract schema (versioned)

/** A tool reference: exact name or { pattern } (regex, implicitly anchored). */
export type CompiledToolRef = {
  label: string;
  matches: (name: string) => boolean;
};

export type ToolUseRequiredRule = {
  label: string;
  tool: CompiledToolRef;
  /** MCP server pin: only `mcp__<server>__*` calls from THIS server can satisfy the rule. */
  server?: string;
  minCalls: number;
  maxCalls?: number;
  /** Deep SUBSET matcher; leaves are exact JSON values or { pattern }. */
  params?: Record<string, unknown>;
  note?: string;
};

export type ToolUseForbiddenRule = {
  label: string;
  tool: CompiledToolRef;
  server?: string;
  reason: string;
};

export type ToolUseOrderRule = {
  before: CompiledToolRef;
  after: CompiledToolRef;
};

export type ToolUseContract = {
  version: 1;
  required: ToolUseRequiredRule[];
  forbidden: ToolUseForbiddenRule[];
  order: ToolUseOrderRule[];
  /** Optional default session filter (CLI --session overrides). */
  session?: string;
  maxMalformedRatio: number;
};

// ---------------------------------------------------------------------------
// trace records (JSONL, one JSON object per line)

export type ToolUseCall = {
  /** 0-based index among the VALID records, in file order. */
  index: number;
  ts?: string;
  sessionId?: string;
  /** Full tool name as logged, e.g. "mcp__composio__GMAIL_SEND_EMAIL" or "Read". */
  tool: string;
  /** MCP server namespace ("composio") or null for non-MCP names. */
  server: string | null;
  /** Bare tool name with the mcp__<server>__ prefix stripped (= tool for non-MCP). */
  bareTool: string;
  params: unknown;
  source?: string;
};

export type ParsedToolUseTrace = {
  calls: ToolUseCall[];
  /** Non-empty lines seen (valid + malformed). */
  totalLines: number;
  malformedLines: number;
};

// ---------------------------------------------------------------------------
// verdict

export type ToolUseViolationKind =
  | "missing_required"
  | "too_many_calls"
  | "forbidden_called"
  | "param_mismatch"
  | "order_violation"
  | "malformed_trace"
  | "empty_trace";

export type ToolUseViolation = {
  kind: ToolUseViolationKind;
  tool: string;
  detail: string;
};

export type ToolUseVerdict = {
  pass: boolean;
  /** Deterministic order: required rules (contract order), forbidden rules, order rules, malformed_trace. */
  violations: ToolUseViolation[];
  stats: { calls: number; matchedRequired: number; malformedLines: number };
};

// ---------------------------------------------------------------------------
// name matching (SECURITY-CRITICAL)
//
// `mcp__<server>__<TOOL>` normalizes into { server, bareTool } (split at the
// FIRST "__" after the mcp__ prefix; server names may not contain "__" --
// enforced at contract parse time for pins).
//
//   - REQUIRED with a server pin: the call's server must EQUAL the pin, then
//     the tool ref is matched against the bare and full name. A spoofed
//     `mcp__evil__GMAIL_SEND_EMAIL` can never satisfy a server:"composio"
//     requirement. Without a pin the ref matches bare or full name.
//   - FORBIDDEN is BLOCK-BIASED: the ref is matched against BOTH the full
//     name and the bare name, so an unpinned pattern like /GITHUB_.*/ blocks
//     `mcp__anyserver__GITHUB_X` as well as a bare `GITHUB_X`. A server pin
//     (rarely needed) narrows the rule to that server's calls only.
//   - Regexes are implicitly anchored (wrapped in ^(?:...)$): "GMAIL_SEND"
//     does NOT match "GMAIL_SEND_EMAIL" unless written as "GMAIL_SEND.*".
//   - Everything is case-sensitive.

const MCP_NAME_RE = /^mcp__(.+?)__(.+)$/;

export function splitMcpToolName(name: string): { server: string | null; bareTool: string } {
  const match = MCP_NAME_RE.exec(name);
  if (match) return { server: match[1], bareTool: match[2] };
  return { server: null, bareTool: name };
}

function requiredNameMatches(rule: ToolUseRequiredRule, call: ToolUseCall): boolean {
  if (rule.server !== undefined && call.server !== rule.server) return false;
  return rule.tool.matches(call.bareTool) || rule.tool.matches(call.tool);
}

function forbiddenMatches(rule: ToolUseForbiddenRule, call: ToolUseCall): boolean {
  if (rule.server !== undefined && call.server !== rule.server) return false;
  return rule.tool.matches(call.tool) || rule.tool.matches(call.bareTool);
}

function orderRefMatches(ref: CompiledToolRef, call: ToolUseCall): boolean {
  return ref.matches(call.bareTool) || ref.matches(call.tool);
}

// ---------------------------------------------------------------------------
// safe own-key helpers (prototype-pollution-inert)
//
// Contract params and trace params come from JSON.parse, which creates
// "__proto__"/"constructor" as ORDINARY OWN data properties. We only ever
// read own keys (hasOwnProperty + Object.keys) and never merge or assign into
// shared objects, so those keys are compared like any other key and cannot
// pollute Object.prototype.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownGet(obj: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? (obj as Record<string, unknown>)[key] : undefined;
}

function ownHas(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// ---------------------------------------------------------------------------
// contract parsing / validation (fail-closed: any surprise throws)

function compileAnchored(source: string, context: string): RegExp {
  try {
    // Implicit whole-name anchoring: "GMAIL_SEND" must not match "GMAIL_SEND_EMAIL".
    return new RegExp(`^(?:${source})$`);
  } catch (error) {
    throw new ToolUseContractError(`${context}: invalid regex pattern ${JSON.stringify(source)}: ${message(error)}`);
  }
}

function compileToolRef(value: unknown, context: string): CompiledToolRef {
  if (typeof value === "string" && value.length > 0) {
    return { label: value, matches: (name) => name === value };
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    const pattern = ownGet(value, "pattern");
    if (keys.length === 1 && keys[0] === "pattern" && typeof pattern === "string" && pattern.length > 0) {
      const regex = compileAnchored(pattern, context);
      return { label: `/${pattern}/`, matches: (name) => regex.test(name) };
    }
  }
  throw new ToolUseContractError(`${context}: tool ref must be a non-empty string or {"pattern": "<regex>"}.`);
}

/** A single-key {"pattern": "<string>"} object is always treated as a regex leaf. */
function isPatternLeaf(value: unknown): value is { pattern: string } {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "pattern" && typeof ownGet(value, "pattern") === "string";
}

function validateParamsMatcher(node: unknown, context: string): void {
  if (isPatternLeaf(node)) {
    compileAnchored(node.pattern, context);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((entry, i) => validateParamsMatcher(entry, `${context}[${i}]`));
    return;
  }
  if (isPlainObject(node)) {
    for (const key of Object.keys(node)) validateParamsMatcher(ownGet(node, key), `${context}.${key}`);
    return;
  }
  const type = node === null ? "null" : typeof node;
  if (type !== "string" && type !== "number" && type !== "boolean" && type !== "null") {
    throw new ToolUseContractError(`${context}: unsupported matcher leaf of type ${type}.`);
  }
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], context: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new ToolUseContractError(
        `${context}: unknown key "${key}" (allowed: ${allowed.join(", ")}). Refusing to guess -- a typo here would silently weaken the contract.`,
      );
    }
  }
}

function parseServerPin(value: unknown, context: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolUseContractError(`${context}: server must be a non-empty string.`);
  }
  if (value.includes("__")) {
    throw new ToolUseContractError(`${context}: server ${JSON.stringify(value)} may not contain "__" (ambiguous against mcp__<server>__<tool> parsing).`);
  }
  return value;
}

export function parseToolUseContract(value: unknown): ToolUseContract {
  if (!isPlainObject(value)) throw new ToolUseContractError("contract must be a JSON object.");
  rejectUnknownKeys(value, ["version", "required", "forbidden", "order", "session", "maxMalformedRatio", "$comment", "description"], "contract");

  if (ownGet(value, "version") !== TOOL_USE_CONTRACT_VERSION) {
    throw new ToolUseContractError(`contract.version must be exactly ${TOOL_USE_CONTRACT_VERSION} (got ${JSON.stringify(ownGet(value, "version"))}).`);
  }

  const required: ToolUseRequiredRule[] = asRuleArray(ownGet(value, "required"), "contract.required").map((entry, i) => {
    const context = `contract.required[${i}]`;
    rejectUnknownKeys(entry, ["tool", "server", "minCalls", "maxCalls", "params", "note"], context);
    const tool = compileToolRef(ownGet(entry, "tool"), context);
    const server = parseServerPin(ownGet(entry, "server"), context);
    const minCalls = parseCount(ownGet(entry, "minCalls"), `${context}.minCalls`) ?? 1;
    const maxCalls = parseCount(ownGet(entry, "maxCalls"), `${context}.maxCalls`);
    if (maxCalls !== undefined && maxCalls < minCalls) {
      throw new ToolUseContractError(`${context}: maxCalls (${maxCalls}) < minCalls (${minCalls}).`);
    }
    const paramsRaw = ownGet(entry, "params");
    if (paramsRaw !== undefined && !isPlainObject(paramsRaw)) {
      throw new ToolUseContractError(`${context}.params must be an object.`);
    }
    if (paramsRaw !== undefined) validateParamsMatcher(paramsRaw, `${context}.params`);
    const note = ownGet(entry, "note");
    if (note !== undefined && typeof note !== "string") throw new ToolUseContractError(`${context}.note must be a string.`);
    return {
      label: server ? `mcp__${server}__${tool.label}` : tool.label,
      tool,
      ...(server !== undefined ? { server } : {}),
      minCalls,
      ...(maxCalls !== undefined ? { maxCalls } : {}),
      ...(paramsRaw !== undefined ? { params: paramsRaw as Record<string, unknown> } : {}),
      ...(note !== undefined ? { note } : {}),
    };
  });

  const forbidden: ToolUseForbiddenRule[] = asRuleArray(ownGet(value, "forbidden"), "contract.forbidden").map((entry, i) => {
    const context = `contract.forbidden[${i}]`;
    rejectUnknownKeys(entry, ["tool", "server", "reason", "note"], context);
    const tool = compileToolRef(ownGet(entry, "tool"), context);
    const server = parseServerPin(ownGet(entry, "server"), context);
    const reason = ownGet(entry, "reason");
    if (typeof reason !== "string" || reason.length === 0) {
      throw new ToolUseContractError(`${context}: reason is required (a non-empty string saying WHY this tool is forbidden).`);
    }
    return {
      label: server ? `mcp__${server}__${tool.label}` : tool.label,
      tool,
      ...(server !== undefined ? { server } : {}),
      reason,
    };
  });

  const order: ToolUseOrderRule[] = asRuleArray(ownGet(value, "order"), "contract.order").map((entry, i) => {
    const context = `contract.order[${i}]`;
    rejectUnknownKeys(entry, ["before", "after", "note"], context);
    return {
      before: compileToolRef(ownGet(entry, "before"), `${context}.before`),
      after: compileToolRef(ownGet(entry, "after"), `${context}.after`),
    };
  });

  const session = ownGet(value, "session");
  if (session !== undefined && (typeof session !== "string" || session.length === 0)) {
    throw new ToolUseContractError("contract.session must be a non-empty string.");
  }

  const ratioRaw = ownGet(value, "maxMalformedRatio");
  let maxMalformedRatio = DEFAULT_MAX_MALFORMED_RATIO;
  if (ratioRaw !== undefined) {
    if (typeof ratioRaw !== "number" || !Number.isFinite(ratioRaw) || ratioRaw < 0 || ratioRaw > 1) {
      throw new ToolUseContractError("contract.maxMalformedRatio must be a number between 0 and 1.");
    }
    maxMalformedRatio = ratioRaw;
  }

  if (required.length === 0 && forbidden.length === 0 && order.length === 0) {
    throw new ToolUseContractError("contract declares no required, forbidden, or order rules -- an empty contract would vacuously pass anything.");
  }

  return {
    version: TOOL_USE_CONTRACT_VERSION,
    required,
    forbidden,
    order,
    ...(session !== undefined ? { session } : {}),
    maxMalformedRatio,
  };
}

function asRuleArray(value: unknown, context: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ToolUseContractError(`${context} must be an array.`);
  return value.map((entry, i) => {
    if (!isPlainObject(entry)) throw new ToolUseContractError(`${context}[${i}] must be an object.`);
    return entry;
  });
}

function parseCount(value: unknown, context: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ToolUseContractError(`${context} must be a non-negative integer.`);
  }
  return value;
}

/** FAIL-CLOSED loader: missing or unparseable contract file throws (never "pass"). */
export function loadToolUseContract(path: string): ToolUseContract {
  if (!existsSync(path)) {
    throw new ToolUseContractError(`contract file not found: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const yamlHint = /\.ya?ml$/i.test(path)
      ? " Contracts are JSON (this repo has no YAML parser dependency)."
      : "";
    throw new ToolUseContractError(`contract file is not valid JSON: ${path}: ${message(error)}.${yamlHint}`);
  }
  return parseToolUseContract(parsed);
}

// ---------------------------------------------------------------------------
// trace parsing

export function parseToolUseTrace(text: string): ParsedToolUseTrace {
  const calls: ToolUseCall[] = [];
  let totalLines = 0;
  let malformedLines = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    totalLines += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformedLines += 1;
      continue;
    }
    if (!isPlainObject(parsed)) {
      malformedLines += 1;
      continue;
    }
    const tool = ownGet(parsed, "tool");
    if (typeof tool !== "string" || tool.length === 0) {
      malformedLines += 1;
      continue;
    }
    const { server, bareTool } = splitMcpToolName(tool);
    const ts = ownGet(parsed, "ts");
    const sessionId = ownGet(parsed, "sessionId");
    const source = ownGet(parsed, "source");
    const params = ownGet(parsed, "params");
    calls.push({
      index: calls.length,
      ...(typeof ts === "string" ? { ts } : {}),
      ...(typeof sessionId === "string" ? { sessionId } : {}),
      tool,
      server,
      bareTool,
      params: params === undefined ? {} : params,
      ...(typeof source === "string" ? { source } : {}),
    });
  }
  return { calls, totalLines, malformedLines };
}

/** FAIL-CLOSED loader: a missing trace file throws (never "pass"). */
export function loadToolUseTrace(path: string): ParsedToolUseTrace {
  if (!existsSync(path)) {
    throw new ToolUseTraceError(
      `trace file not found: ${path}. Run \`proofloop hooks install\` so the PostToolUse logger captures tool calls, or pass --trace <file>.`,
    );
  }
  return parseToolUseTrace(readFileSync(path, "utf8"));
}

// ---------------------------------------------------------------------------
// params deep-subset matching

/**
 * Deep SUBSET match: every key in `matcher` must exist in `actual` and match.
 * Extra keys in `actual` are fine. Leaves:
 *   - {"pattern": "<regex>"}  -> anchored regex against String(primitive value)
 *   - arrays                  -> same length, element-wise match
 *   - objects                 -> recurse (subset)
 *   - primitives/null         -> strict equality
 * Returns null on match, or a human-readable mismatch detail.
 */
export function matchParamsSubset(matcher: unknown, actual: unknown, path = "params"): string | null {
  if (isPatternLeaf(matcher)) {
    const regex = compileAnchored(matcher.pattern, path); // validated at parse time
    if (actual === null || (typeof actual !== "string" && typeof actual !== "number" && typeof actual !== "boolean")) {
      return `${path}: expected a primitive matching /${matcher.pattern}/, got ${describeValue(actual)}`;
    }
    return regex.test(String(actual)) ? null : `${path}: ${JSON.stringify(String(actual))} does not match /${matcher.pattern}/`;
  }
  if (Array.isArray(matcher)) {
    if (!Array.isArray(actual)) return `${path}: expected an array, got ${describeValue(actual)}`;
    if (actual.length !== matcher.length) return `${path}: expected array length ${matcher.length}, got ${actual.length}`;
    for (let i = 0; i < matcher.length; i++) {
      const detail = matchParamsSubset(matcher[i], actual[i], `${path}[${i}]`);
      if (detail !== null) return detail;
    }
    return null;
  }
  if (isPlainObject(matcher)) {
    if (!isPlainObject(actual)) return `${path}: expected an object, got ${describeValue(actual)}`;
    for (const key of Object.keys(matcher)) {
      // "__proto__"/"constructor" are ordinary own keys here: we read via
      // hasOwnProperty and never assign, so they cannot pollute prototypes.
      if (!ownHas(actual, key)) return `${path}.${key}: missing`;
      const detail = matchParamsSubset(ownGet(matcher, key), ownGet(actual, key), `${path}.${key}`);
      if (detail !== null) return detail;
    }
    return null;
  }
  return Object.is(matcher, actual) ? null : `${path}: expected ${JSON.stringify(matcher)}, got ${describeValue(actual)}`;
}

function describeValue(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    const text = JSON.stringify(value);
    return text === undefined ? String(value) : text.length > 120 ? `${text.slice(0, 120)}...` : text;
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// the verifier (pure, deterministic, no LLM)

export function verifyToolUseContract(
  contract: ToolUseContract,
  trace: ParsedToolUseTrace,
  options: { session?: string } = {},
): ToolUseVerdict {
  const session = options.session ?? contract.session;
  const calls = session === undefined ? trace.calls : trace.calls.filter((call) => call.sessionId === session);
  const violations: ToolUseViolation[] = [];
  let matchedRequired = 0;

  for (const rule of contract.required) {
    const nameMatched = calls.filter((call) => requiredNameMatches(rule, call));
    let firstParamMismatch: string | null = null;
    const satisfied = rule.params
      ? nameMatched.filter((call) => {
          const detail = matchParamsSubset(rule.params, call.params);
          if (detail !== null && firstParamMismatch === null) {
            firstParamMismatch = `call #${call.index} (${call.tool}): ${detail}`;
          }
          return detail === null;
        })
      : nameMatched;

    if (satisfied.length < rule.minCalls) {
      if (nameMatched.length > satisfied.length && firstParamMismatch !== null) {
        violations.push({
          kind: "param_mismatch",
          tool: rule.label,
          detail: `${nameMatched.length - satisfied.length} call(s) matched the tool name but not the params -- first mismatch: ${firstParamMismatch}`,
        });
      } else {
        violations.push({
          kind: "missing_required",
          tool: rule.label,
          detail: `expected >= ${rule.minCalls} call(s)${rule.server ? ` on MCP server "${rule.server}"` : ""}, found ${satisfied.length}${rule.note ? ` (${rule.note})` : ""}`,
        });
      }
      continue;
    }
    if (rule.maxCalls !== undefined && satisfied.length > rule.maxCalls) {
      violations.push({
        kind: "too_many_calls",
        tool: rule.label,
        detail: `expected <= ${rule.maxCalls} call(s), found ${satisfied.length} (call #${satisfied.map((c) => c.index).join(", #")})`,
      });
      continue;
    }
    matchedRequired += 1;
  }

  // Fail-closed on zero evidence for negative policies. A `forbidden`/`order` rule can only be
  // VIOLATED by a call that is present -- so a trace with zero (post-session-filter) calls makes
  // every such rule vacuously "satisfied", producing a false PASS. That is exactly the sabotage
  // the doctrine warns about: an agent can empty the log (`> log.jsonl` via Bash), capture can
  // silently never fire, or a `--session` typo can filter the log to nothing -- and a deny-list
  // ("never call GITHUB_*") would then pass on no evidence at all. Absence of captured calls
  // cannot prove a tool-use policy was honored. (A `required`-only contract already fails via
  // missing_required, so this only tightens the forbidden/order case and avoids double-reporting.)
  if (calls.length === 0 && (contract.forbidden.length > 0 || contract.order.length > 0)) {
    violations.push({
      kind: "empty_trace",
      tool: "(trace)",
      detail:
        session === undefined
          ? "no tool calls were captured -- a forbidden/order policy cannot be certified from an empty trace (fail-closed; check that PostToolUse capture ran and the log was not truncated)"
          : `no tool calls matched session "${session}" -- a forbidden/order policy cannot be certified against an empty session slice (fail-closed; check the --session/contract.session value)`,
    });
  }

  for (const rule of contract.forbidden) {
    for (const call of calls) {
      if (forbiddenMatches(rule, call)) {
        violations.push({
          kind: "forbidden_called",
          tool: call.tool,
          detail: `call #${call.index} matches forbidden rule ${rule.label}: ${rule.reason}`,
        });
      }
    }
  }

  for (const rule of contract.order) {
    const beforeIndex = calls.findIndex((call) => orderRefMatches(rule.before, call));
    const afterIndex = calls.findIndex((call) => orderRefMatches(rule.after, call));
    if (afterIndex >= 0 && (beforeIndex < 0 || beforeIndex >= afterIndex)) {
      violations.push({
        kind: "order_violation",
        tool: rule.after.label,
        detail:
          beforeIndex < 0
            ? `"${rule.after.label}" was called (call #${afterIndex}) but "${rule.before.label}" was never called before it`
            : `first "${rule.before.label}" (call #${beforeIndex}) does not precede first "${rule.after.label}" (call #${afterIndex})`,
      });
    }
  }

  if (trace.totalLines > 0 && trace.malformedLines / trace.totalLines > contract.maxMalformedRatio) {
    const ratio = (trace.malformedLines / trace.totalLines).toFixed(3);
    violations.push({
      kind: "malformed_trace",
      tool: "(trace)",
      detail: `${trace.malformedLines}/${trace.totalLines} trace line(s) malformed (ratio ${ratio} > max ${contract.maxMalformedRatio}) -- treating the log as untrustworthy (fail-closed)`,
    });
  }

  return {
    pass: violations.length === 0,
    violations,
    stats: { calls: calls.length, matchedRequired, malformedLines: trace.malformedLines },
  };
}

export function formatToolUseVerdict(
  verdict: ToolUseVerdict,
  context: { contractPath: string; tracePath: string; session?: string; requiredRules: number },
): string {
  const lines = [
    `tool-use contract: ${verdict.pass ? "PASS" : "FAIL"}`,
    `  contract: ${context.contractPath}`,
    `  trace:    ${context.tracePath}`,
    `  session:  ${context.session ?? "(all sessions)"}`,
    `  calls=${verdict.stats.calls} matchedRequired=${verdict.stats.matchedRequired}/${context.requiredRules} malformedLines=${verdict.stats.malformedLines}`,
  ];
  if (verdict.violations.length > 0) {
    lines.push("  violations:");
    for (const violation of verdict.violations) {
      lines.push(`    - [${violation.kind}] ${violation.tool}: ${violation.detail}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// starter templates (`proofloop tooluse init`)

export const TOOL_USE_CONTRACT_TEMPLATES: Record<string, () => Record<string, unknown>> = {
  "composio-email-triage": () => ({
    $comment:
      "Expected-tool-use contract for a Composio-MCP email-triage agent. Verified against LOCAL PostToolUse capture (.proofloop/tooluse/log.jsonl) -- not Composio server-side attestation. See docs/proofloop/EXPECTED_TOOL_USE.md.",
    version: 1,
    required: [
      {
        tool: "GMAIL_FETCH_EMAILS",
        server: "composio",
        minCalls: 1,
        note: "triage must actually read the inbox through the Composio MCP server",
      },
      {
        tool: "GMAIL_SEND_EMAIL",
        server: "composio",
        minCalls: 1,
        maxCalls: 1,
        params: { to: { pattern: "[^@\\s]+@[^@\\s]+\\.[^@\\s]+" } },
        note: "exactly one summary email, to a real address",
      },
    ],
    forbidden: [
      { tool: { pattern: "GMAIL_DELETE.*" }, reason: "email triage must never delete mail" },
      { tool: { pattern: "GITHUB_.*" }, reason: "email triage must not touch repos" },
    ],
    order: [{ before: "GMAIL_FETCH_EMAILS", after: "GMAIL_SEND_EMAIL" }],
    maxMalformedRatio: 0.1,
  }),
};

// ---------------------------------------------------------------------------
// impure CLI runners (proofloop-cli.ts `tooluse` delegates here)

export type ToolUseCliIo = {
  log?: (line: string) => void;
  logError?: (line: string) => void;
};

/** Exit code contract: 0 = pass, 1 = fail, 2 = contract or trace unusable. */
export function runToolUseVerify(
  options: {
    root: string;
    contractPath: string;
    tracePath?: string;
    session?: string;
    json?: boolean;
  } & ToolUseCliIo,
): 0 | 1 | 2 {
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  const contractPath = resolve(options.root, options.contractPath);
  const tracePath = resolve(options.root, options.tracePath ?? TOOL_USE_LOG_RELATIVE_PATH);
  let contract: ToolUseContract;
  let trace: ParsedToolUseTrace;
  try {
    contract = loadToolUseContract(contractPath);
    trace = loadToolUseTrace(tracePath);
  } catch (error) {
    logError(`proofloop tooluse: ${message(error)}`);
    logError("proofloop tooluse: contract or trace unusable -- refusing to report a verdict (fail-closed, exit 2).");
    return 2;
  }
  const verdict = verifyToolUseContract(contract, trace, options.session !== undefined ? { session: options.session } : {});
  if (options.json) {
    log(JSON.stringify(verdict, null, 2));
  } else {
    log(
      formatToolUseVerdict(verdict, {
        contractPath,
        tracePath,
        ...(options.session ?? contract.session ? { session: options.session ?? contract.session } : {}),
        requiredRules: contract.required.length,
      }),
    );
  }
  return verdict.pass ? 0 : 1;
}

export function runToolUseInit(
  options: { root: string; template?: string; outPath?: string } & ToolUseCliIo,
): 0 | 1 {
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  const templateName = options.template ?? "composio-email-triage";
  const factory = TOOL_USE_CONTRACT_TEMPLATES[templateName];
  if (!factory) {
    logError(`proofloop tooluse: unknown template "${templateName}". Known: ${Object.keys(TOOL_USE_CONTRACT_TEMPLATES).join(", ")}`);
    return 1;
  }
  const template = factory();
  // Self-check: a template our own parser rejects must never be shipped to a user.
  parseToolUseContract(template);
  const outPath = resolve(options.root, options.outPath ?? "tooluse-contract.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
  log(`proofloop: wrote ${outPath}`);
  log(`proofloop: verify with \`proofloop tooluse verify --contract ${outPath}\` (exit 0 pass / 1 fail / 2 unusable)`);
  return 0;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
