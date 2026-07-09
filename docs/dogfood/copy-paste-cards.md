# Proof Loop Copy-Paste Cards

## Unified Setup Pack

```bash
npm run proofloop -- agents setup all --local
npm run proofloop -- mcp serve
npm run proofloop -- providers setup all
npm run proofloop -- memory seed-dogfood
npm run proofloop -- graph ingest --backend neo4j
npm run proofloop -- dashboard export latest
```

Use this when a team wants Codex or Claude Code to be the enforceable control plane while Cursor, Windsurf, Devin, or a generic CLI worker consume the same ProofLoop setup pack. Codex and Claude Code install hooks; other hosts get rules/docs, a working stdio MCP bridge config, provider setup commands, and honest `needs_adapter` receipts until launch/trace/gate enforcement is wired.

## Native Agent Enforcement

```bash
npm run proofloop -- agents launch devin-cli --prompt .proofloop/runs/latest/codex-reprompt.md
npm run proofloop -- agents collect devin-cli --run-dir .proofloop/agents/native/<run>
npm run proofloop -- agents verify devin-cli --run-dir .proofloop/agents/native/<run> --strict
```

Use this when a host can be launched non-interactively and can export a session transcript or ATIF file. `verify --strict` only passes when launch, session export, and the ProofLoop gate all pass.

## Codex

```bash
npm run proofloop -- manifest --dense
npm run proofloop -- agents setup codex --local
npm run proofloop -- this-repo --live
npm run proofloop -- codex-loop bankertoolbench --dry-run
```

Use this when you want Proof Loop to install Codex hooks and produce repair prompts from failed proof receipts.

## Claude Code

```bash
npm run proofloop -- manifest --dense
npm run proofloop -- agents setup claude-code --local
npm run proofloop -- hooks status
npm run proofloop -- this-repo --live
```

Use this when Claude Code is the worker and Proof Loop is the stop/tool-use supervisor.

## Cursor

```bash
npm run proofloop -- agents setup cursor
npm run proofloop -- docs agents --dense
npm run proofloop -- gate --goal official-scores
```

Current status: adapter receipt should honestly report `needs_adapter` until Cursor exposes a launch/re-prompt, trace capture, and gate enforcement surface.

Native path: set `PROOFLOOP_CURSOR_COMMAND` to a headless Cursor CLI prompt runner, then use `agents launch cursor`, `agents collect cursor`, and `agents verify cursor --strict`.
Default launcher: `scripts/proofloop-cursor-launch.mjs` uses `cursor-agent` or `cursor agent` when installed; set `PROOFLOOP_CURSOR_BINARY` or `PROOFLOOP_CURSOR_COMMAND` to override.

## Windsurf

```bash
npm run proofloop -- agents setup windsurf
npm run proofloop -- docs agents --dense
npm run proofloop -- gate --goal official-scores
```

Current status: adapter receipt should honestly report `needs_adapter` until Cascade/session export and relaunch hooks are available.

Native path: use Cascade MCP/hooks and collect the transcript with `agents collect windsurf --session <cascade-transcript.jsonl>`. A strict launch claim still requires a non-interactive launcher.

## Devin

```bash
npm run proofloop -- agents setup devin
npm run proofloop -- codex reprompt latest
npm run proofloop -- gate --goal official-scores
```

Current status: adapter receipt should honestly report `needs_adapter` until Devin API launch/session export and ProofLoop gate enforcement are wired. The generated setup pack is still useful as the prompt and receipt contract.

Native path: use `agents launch devin-cli --prompt <file>` for local Devin CLI, or wire `PROOFLOOP_DEVIN_API_COMMAND` for hosted Devin API session creation.
Default hosted launcher: `scripts/proofloop-devin-api-launch.mjs` calls Devin API v3 when `PROOFLOOP_DEVIN_API_KEY`/`DEVIN_API_KEY` and `PROOFLOOP_DEVIN_ORG_ID`/`DEVIN_ORG_ID` are set.

## Generic CLI Agent

```bash
npm run proofloop -- agents setup generic-cli --command "<agent command that reads stdin>"
npm run proofloop -- codex-loop bankertoolbench --agent generic-cli --dry-run
```

Use this for workers that can read a repair prompt from stdin and emit logs.

## CI Only

```bash
npm run proofloop -- ci install github --goal official-scores
npm run proofloop -- gate --goal official-scores
```

Use this when the team only wants PR gating. Do not use `default` unless it has been initialized.

## Local Privacy Mode

```bash
npm run proofloop -- memory init
npm run proofloop -- memory seed-dogfood
npm run proofloop -- graph index
npm run proofloop -- search --hybrid "similar UI overflow or fake success failures"
```

Use this when local SQLite/FTS memory and code graph are enough and no provider credentials should leave the machine.

## Provider Setup

```bash
npm run proofloop -- providers setup all
npm run proofloop -- providers setup nebius
```

Use this before provider-backed benchmark or product claims. Missing credentials should be recorded as `needs_credentials`, not failure of unrelated lanes.
