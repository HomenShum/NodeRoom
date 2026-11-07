---
name: citation-validation
description: "Validate that every [src:<path>#L<n>] citation in a markdown table or note resolves to an existing, non-restricted source line that contains the number it supports. Use before publishing analysis/comparison.md or any cited table."
allowed-tools: Read, Bash(node:*)
---

# Citation validation

Run from the workspace root:

    node .claude/skills/citation-validation/validate-citations.mjs analysis/comparison.md

What it checks for every `[src:<path>#L<a>]` or `[src:<path>#L<a>-L<b>]` token:

1. The path stays inside the workspace and is not under `sources/restricted/`.
2. The cited file exists and the line range is in bounds.
3. Every number written before the token, back to the previous `|` cell border, previous token or line start, appears on one of the cited lines (commas are ignored, `18.0` equals `18`).

Exit codes: 0 = all citations valid, 1 = at least one failure (each printed with its line), 2 = usage error.
A document with no citations at all fails.

Conventions that keep tables checkable:

- Put the citation directly after the value it supports: `24.2 [src:sources/financials/x.md#L37]`.
- Derived values (runway = cash / burn) carry no citation in the cell; cite their inputs instead.
- Text cells may cite a line; any numbers in the text must then appear on that line.

Examples (paths are resolved against `--root`):

- `examples/good-table.md` passes.
- `examples/wrong-number.md` fails: the cash value cites the burn line.
- `examples/out-of-range.md` fails: the line does not exist.
