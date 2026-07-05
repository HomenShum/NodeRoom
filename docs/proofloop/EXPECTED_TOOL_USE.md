# Expected-tool-use contract verification

Proof Loop can assert that an agent session **called the tools it was supposed
to call, with the params it was supposed to use, and did NOT call forbidden
ones**. The pipeline is: capture (hooks) → contract → verify → gate/CI.

## 1. Capture (hooks)

```bash
npm run proofloop -- hooks install          # or: proofloop hooks install --dir <repo>
```

Besides the Stop gate and PreToolUse guard, install now writes
`.proofloop/hooks/posttooluse-log.mjs` and merges a **PostToolUse** entry
(matcher `.*` = every tool) into `.claude/settings.json`. Each tool call is
appended to `.proofloop/tooluse/log.jsonl` as one JSON line:

```json
{"ts":"2026-07-03T10:01:30.000Z","sessionId":"abc","tool":"mcp__composio__GMAIL_SEND_EMAIL","params":{"to":"a@b.co"},"source":"posttooluse-hook"}
```

Secret-looking **keys** (`/key|token|secret|password|authorization|bearer|credential/i`,
at any depth, incl. arrays-of-objects and mixed case) are redacted before
writing. The logger always exits 0 — a broken logger must never block the
user's tools. Opt out with `--no-tooluse-log`.

> **Redaction is key-name based only.** A secret embedded in a *value* under an
> innocent key — e.g. `{"note": "the api key is sk-…"}` or a token pasted into a
> `body`/`prompt` field — is written in cleartext. Do not treat
> `.proofloop/tooluse/log.jsonl` as secret-safe; it is a local audit log, and
> `.proofloop/` is gitignored so it never leaves the machine on its own.
>
> **The log is unbounded.** Every captured tool call is appended; there is no
> rotation or size cap, and `verify` reads the whole file into memory. Under a
> long-running agent loop it grows without limit — truncate or rotate it
> between runs if that matters, and expect `verify` cost to scale with log size.

## 2. Contract (JSON, versioned)

```bash
npm run proofloop -- tooluse init --template composio-email-triage --out tooluse-contract.json
```

- `required[]` — `tool` (exact name or `{ "pattern": "regex" }`), optional
  `server` pin, `minCalls` (default 1), `maxCalls`, `params` (deep **subset**
  matcher; leaves are exact values or `{ "pattern": ... }`), `note`.
- `forbidden[]` — `tool`, optional `server`, and a mandatory `reason`.
- `order[]` — `{ "before": ..., "after": ... }`: the first call matching
  `before` must precede the first call matching `after`.
- `session`, `maxMalformedRatio` (default 0.1).

Contracts are JSON (this repo has no YAML parser dependency; zero new deps).

## 3. Verify (deterministic, no LLM)

```bash
npm run proofloop -- tooluse verify --contract tooluse-contract.json [--trace <file>] [--session <id>] [--json]
```

Exit codes: **0** pass, **1** contract violated, **2** contract or trace
unusable (missing/unparseable — never reported as a pass).

Name-matching rules (security-critical, all case-sensitive):

- `mcp__<server>__<TOOL>` normalizes into `{ server, bareTool }`.
- A **required** rule with `server: "composio"` is only satisfied by that
  server's calls — `mcp__evil__GMAIL_SEND_EMAIL` can never satisfy it.
- A **forbidden** rule is block-biased: matched against the full **and** bare
  name, so `{ "pattern": "GITHUB_.*" }` blocks `mcp__anyserver__GITHUB_X` too.
- Regexes are implicitly anchored: `GMAIL_SEND` does not match
  `GMAIL_SEND_EMAIL`; write `GMAIL_SEND.*` if you mean the prefix.
- Matching is **codepoint-exact**: case-sensitive and no Unicode
  normalization. A deny-list rule matches the literal MCP tool name only — a
  Cyrillic-homoglyph lookalike is a *different* string. This is safe against a
  real MCP server (an agent cannot rename `mcp__composio__GITHUB_DELETE_REPO`),
  but it is a contract-author footgun: write the exact tool name.

## 4. Gate / CI wiring

Run `proofloop tooluse verify` as an extra step next to `proofloop gate` — in
a shipping checklist, a Stop-hook `--gate-command` chain
(`proofloop gate --goal official-scores && proofloop tooluse verify --contract ...`),
or a CI job that re-verifies a committed trace. CI re-verification is the
backstop for the local-tamper bypass described below.

## Composio

Composio users' agents call tools through the Composio MCP gateway with names
like `mcp__composio__GMAIL_SEND_EMAIL`. Capture is **name-agnostic** — the
PostToolUse hook logs whatever tool name the worker reports — so this works
with Composio's MCP tools out of the box: pin `server: "composio"` in
`required` rules and express the rest of the workflow policy as
forbidden/order/param rules. `tooluse init` ships a worked example
(fetch-before-send email triage that must not delete mail or touch repos).

**Honest boundary.** This is **local capture**: it proves what *this worker
session's tool hooks saw* on the machine that ran it. It is **not**
server-side attestation from Composio — Composio's own logs remain the
authoritative record of what actually hit their gateway. Calls made outside
tool hooks (e.g. `curl` inside a Bash tool, or another process) are not
captured, and a user with shell access can rewrite the local log. Treat a
passing verdict as "the session's tool stream matched the contract," not as a
cryptographic proof of external side effects.

## Doctrine notes (anti-reward-hacking)

- The tool-use log is **enforcement input**, so `.proofloop/tooluse/` is on
  the PreToolUse guard's protected paths: agent `Edit`/`Write` to the log is
  refused at edit time (an agent doctoring its own log to satisfy a contract
  is the doctrine's reward-hacking pattern). Known bypass: Bash writes are not
  intercepted — CI re-verification is the backstop.
- The verifier is **fail-closed**: missing/invalid contract or missing trace
  is exit 2; a malformed-line ratio above `maxMalformedRatio` fails the
  verdict; and a `forbidden`/`order` contract verified against **zero captured
  calls** (empty log, capture never fired, or a `--session` that matches
  nothing) fails with an `empty_trace` violation — a deny-list policy cannot be
  certified from the absence of evidence. Failing open would reward log
  sabotage (`> log.jsonl` via Bash, the documented write-bypass).
- Records carry provenance labels (`source`): the logger writes
  `posttooluse-hook`; test fixtures are labeled `synthetic_edge_case`.
