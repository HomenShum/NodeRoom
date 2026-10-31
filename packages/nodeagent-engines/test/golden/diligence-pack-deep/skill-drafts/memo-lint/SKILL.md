---
name: memo-lint
description: "Lint committee credit memos (analysis/memos/*.md): required sections, at least six citations, every cited figure on its cited line, no missing files or lines, nothing from sources/restricted/. Use before handing memos to the credit committee."
allowed-tools: Read, Bash(node:*)
---

# Memo lint

Run from the workspace root on one memo or the whole folder:

    node .claude/skills/memo-lint/lint-memos.mjs analysis/memos

Each memo must:

1. Have `Overview`, `Financials`, `Risks`, `Exceptions` and `Sources` headings.
2. Carry at least 6 `[src:<path>#L<a>]` / `[src:<path>#L<a>-L<b>]` citations.
3. Cite only files that exist, line ranges in bounds, paths inside the workspace and never under
   `sources/restricted/`.
4. Put each citation right after the figure it supports: the last number before the token (back to the
   previous token, `|` cell border or sentence start) must appear on a cited line. Derived figures
   (runway, stressed runway) carry no citation; cite their inputs instead.

Exit codes: 0 = every memo passes, 1 = at least one problem (each printed with memo and line),
2 = usage error. `--root=<dir>` resolves citation paths against another directory (used by the examples).

Examples (paths resolved against `--root=skill-drafts/memo-lint/examples`):

- `examples/good-memo.md` passes.
- `examples/missing-section.md` fails: no Risks section.
- `examples/wrong-number.md` fails: the cash figure cites the burn line.
- `examples/restricted.md` fails: cites a restricted document.
