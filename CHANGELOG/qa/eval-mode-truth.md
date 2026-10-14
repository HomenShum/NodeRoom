# Evaluation mode truth — 2026-10-14

Maintainers comparing agent behavior need to know whether a model actually ran.
Previously, `eval:real` without a key silently replayed scripted golden plans and
labeled their score real. It now rejects absent, empty, or whitespace-only
`ANTHROPIC_API_KEY` before cases, a banner, or scoring. Every case shape shares
model selection; `eval` remains scripted even with credentials configured.

Validation: both frame/Omnigent smokes passed; mode tests went from 5 failures
on the old runner to 8/8 passing; unchanged scripted golden cases passed 6/6.
`npm run floor` passed both typechecks but exited 1: 2,785 tests passed and three
failed (one stale proof receipt, two Excel COM logon-session failures).

No provider requests or real-model quality claim. Outer Omnigent CLI, independent
review, CI, browser checks, and publication remain unverified here.
