# SFN Command Center

`sfn` is the operating console for building, running, proving, and hardening agent products across agent hosts.

```text
Hooks observe the agent.
Receipts prove the work.
The CLI makes the loop visible.
```

## Core Commands

```bash
npm run sfn -- dashboard --case FR-010
npm run sfn -- loop status
npm run sfn -- loop events
npm run sfn -- loop doctor
npm run sfn -- agent matrix
npm run sfn -- agent install-hooks --target codex
npm run sfn -- proof receipt --case FR-010
npm run sfn -- proof verify --case FR-010
npm run sfn -- proof verdict --case FR-010
npm run sfn -- noderoom watch --case FR-010
```

## Universal Event Bus

Every host maps into one event vocabulary:

```text
session.start
session.stop
phase.start
phase.stop
prompt.submit
tool.pre
tool.post
tool.error
file.read.pre
file.write.pre
file.write.post
command.run.pre
command.run.post
browser.proof.start
browser.proof.stop
receipt.write
memory.write
eval.start
eval.stop
rework.recorded
```

Native hooks are useful, but not sufficient. Hosts without hooks are wrapped by the CLI and receive `external_proof_only` claim level until browser traces, exported files, scorer receipts, and proof verdicts exist.

## Adapter Rule

```text
Native hook if available.
API session if available.
MCP/rules/skills if available.
Generic wrapper if nothing else.
Receipt required always.
```

`npm run sfn -- agent matrix` prints the current adapter map for Claude Code, Codex, Windsurf, Devin, Cursor, Trae, OpenCode, OpenClaw, Hermes, Pi Agent, Flue AI, and generic CLI hosts.

## Hook Templates

`npm run sfn -- agent install-hooks --target <target>` writes starter hook files for supported targets:

```text
.solo/bin/record-event
.codex/hooks.json
.claude/settings.json
.windsurf/hooks.json
.devin/rules/solo-founder-loop.md
```

The templates all write to `.solo/events.jsonl`. They are intentionally local-first and should be reviewed before being adopted as trusted native hook config.

## NodeRoom Proof Watch

`npm run sfn -- noderoom watch --case FR-010` renders a proof dashboard from `docs/eval/fresh-room/<case>/latest.json`.

It does not fake browser execution. If a receipt is missing, the command says so; the correct next step is a headed browser proof run followed by `npm run sfn -- proof verify --case <case>`.
