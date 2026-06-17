# Walkthrough Review CLI

Reusable CLI and MCP-compatible wrapper for this loop:

```text
feature spec -> browser capture -> render -> model UX judge -> Markdown/JSON report
```

NodeRoom is the reference consumer. Other coding-agent projects can copy the
package plus a config file and point each command at their own capture, render,
and model-review scripts.

## CLI

```bash
npx tsx packages/walkthrough-review-cli/src/cli.ts run startup-diligence-war-room --ui-review
```

Generic shape:

```bash
walkthrough-review run \
  --config walkthrough-review.config.json \
  --base http://127.0.0.1:5178 \
  --model gemini-3.5-flash \
  --ui-review \
  startup-diligence-war-room
```

## MCP

```bash
npx tsx packages/walkthrough-review-cli/src/mcp.ts --config walkthrough-review.config.json
```

The MCP server exposes one tool:

```text
walkthrough_review_run
```

The tool accepts `features`, `base`, `model`, `runId`, `uiReview`,
`skipCapture`, `skipRender`, `skipGemini`, `media`, `allowSkipped`, and
`dryRun`. The MCP layer calls the same runner as the CLI; it does not reimplement
the workflow.

## Contract

The config file owns project-specific commands. The runner owns:

- argument parsing and command templating
- optional local env loading via `envFile`
- capture-manifest freshness checks
- media selection
- review manifest generation
- JSON/Markdown output
- process exit semantics for agents and CI

Exit codes:

```text
0 = run completed
1 = UX/review issues or command failure
2 = invalid config/arguments
```
