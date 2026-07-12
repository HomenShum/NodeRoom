# Claude Usage Analysis — Repeated Work, Sorted — 2026-07-12

**Method:** two independent mining passes, merged. (a) Raw Claude Code session transcripts: 25 JSONL files across the noderoom project + 8 worktree dirs — 103,977 events, 792 user messages — aggregated by tool name, Bash command family, and request-theme keywords. (b) claude-mem observation DB (42,484 observations total; 10,356 on noderoom across 16 sessions, 2026-06-13→07-12) aggregated by observation type and recurring titles. Cross-validated against 769 git commits since 2026-05-01. Companion: `DIRECTION_AUDIT_2026-07-12.md`.

## Headline finding

**The repeated work is already codified — it just isn't routed or enforced.** 9 skills and ~250 npm scripts exist, but Skill-tool routing is near zero: 9 skill invocations vs 3,778 Bash calls across all sessions. New skills are the wrong fix; the high-ROI rebuilds are chained npm commands, hooks, and index docs that a model finds without knowing the repo.

Known blind spot: claude-mem coverage of July is thin relative to git; July frequencies lean on commit cross-validation and may understate the receipt-refresh and browser-verify loops.

## Repeated work, sorted by measured frequency

| # | Pattern | Frequency (evidence) | Existing asset | Rebuild | Status |
|---|---|---|---|---|---|
| 1 | Live-preview / browser DOM verification loop | ~1,300 browser tool calls (preview_eval 789+112, browser_batch 179, clicks/screenshots/console ~350); 73+ verify observations across 12 sessions | generic verify skill, `proofloop -- ui contract`, 3 gotcha memories | `docs/qa/BROWSER_VERIFY.md` — the one-page reliable recipe (build→preview, strict port, testids, hidden-tab/occlusion gotchas) + a later `proof:visual` hook | ✅ doc shipped this pass |
| 2 | Typecheck+vitest floor before every claim | ~560 invocations ≈ 22/session (tsc 287, vitest 243, typecheck 99); 93 obs / 17 sessions | commands restated in 3 skills; no single entry | **`npm run floor`** — root typecheck + convex typecheck + vitest; CLAUDE.md says use it INSTEAD of ad-hoc invocations | ✅ shipped this pass |
| 3 | Verified ship loop (floor → commit → rebase → push → PR → merge → verify) | 373 commits, 198 fetch, 173 push, 99 PR creates / 98 merges; ship skill never skill-invoked | .claude/skills/ship | ship skill calls `npm run floor`; generic co-author trailer; later: floor-on-push hook | partially (floor exists; skill edits deferred) |
| 4 | Benchmark sweeps + navigating 60–90 `benchmark:*` scripts | 144 eval/benchmark commits; keyword in 22/25 sessions (861 mentions) | `proofloop -- manifest` (partial) | `docs/eval/BENCHMARK_RUNBOOK.md` — lane × stage matrix, every cell → exact script, cost class, prerequisites | ✅ shipped this pass |
| 5 | Fleet/parallel-lane merge & rebase reconciliation | 137 merge commits (18% of all commits); 91 obs / 11 sessions; 199 worktree assignments | memory notes only | `fleet-merge` skill (classify mine/foreign/conflicted; refuse to commit foreign half-edits) | deferred |
| 6 | ProofLoop receipt/gate refresh + commit | 134 receipt/gate commits; 40+ dirty lane files right now | proofloop:gate/report, proofs:staleness | `proofloop:receipts:commit` script — regenerate, staleness-verify, stage only receipt paths, refuse on gate regression | deferred (blocked on C15 board bug) |
| 7 | Demo-room seed/reset loop | 99 seeding commits; 39 obs / 12 sessions; recurring seed-dependency bugs | demo / demo:agent, scattered per-scenario seeds | `npm run seed -- <scenario>` with shared schema + `--verify` post-seed counts | deferred |
| 8 | Design audit / token-parity after UI edits | 91 parity commits; design keyword in 20/25 sessions (1,001 mentions); design:audit hand-run only 19× | design:audit/manifest/parity | PostToolUse hook on src/ui/** + styles.css edits that auto-runs design:audit | deferred (hook design needs care re: runtime cost per edit) |
| 9 | Walkthrough GIF / episode media regeneration | 72–91 media commits; keywords in 20/25 sessions; 82 render obs / 13 sessions | THREE overlapping skills (readme-walkthroughs, produce-episode, walkthrough-review) + ~12 scripts | consolidate into walkthrough-review with modes: capture-only / readme-gif / full-episode | deferred |
| 10 | Two-target deploy + live-DOM verification | 81 deploy commits; deploy keyword in 17 sessions (513 mentions); 214 obs over 19 days | convex:deploy:guard/verify as separate legs; qa:story:prod | **`npm run ship:prod`** — guard → convex deploy → `scripts/ship-prod-verify.mjs` raw-HTML signal grep, exits nonzero naming the failed leg | ✅ shipped this pass |
| 11 | Gemini judge passes forked across 7 drifting scripts | 29 judge obs / 8 sessions; 161 gemini obs / 11 sessions; recurring JSON-parse crashes | 7 independent judge scripts | one shared judge module (schema-validated scorecard, parse retry, key handling) + `npm run judge -- <target>` | deferred |
| 12 | "Where are we" session progress audits | 6+ explicit asks; 4+ dedicated deep-read sessions; git log ×410 + git status ×396 partly this ritual | proofloop resume (run-state only), MEMORY.md | `/status-audit` command + generated docs/STATE.md digest | deferred |

## What shipped in this pass

1. **`npm run floor`** (package.json) — the per-change gate, referenced from CLAUDE.md as the replacement for ad-hoc tsc/vitest.
2. **`npm run ship:prod`** + `scripts/ship-prod-verify.mjs` — deploy chain ending in a raw-HTML DOM-signal assertion against https://noderoom.live; catches disconnected webhooks, SSR Suspense shells, and stale CDN HTML.
3. **`docs/qa/BROWSER_VERIFY.md`** — the reliable browser-proof recipe (pattern #1).
4. **`docs/eval/BENCHMARK_RUNBOOK.md`** — the lane × stage command matrix (pattern #4); verified against package.json with zero dead scripts found.
5. **Alias dedupe** — `omniagent:nodeagent:smoke` and `previews:render` deleted (byte-identical to `omnigent:nodeagent:smoke` / `workflow:trace-previews`).
6. **post-edit hook prod gate** — auto-codegen no longer fires while `.env.local` pins prod (C3).

## Deferred rebuild queue (in priority order)

fleet-merge skill (#5) → proofloop:receipts:commit (#6, after the C15 board fix) → seed command (#7) → design-audit hook (#8) → media-skill consolidation (#9) → shared Gemini judge (#11) → /status-audit + STATE.md (#12) → ship-skill floor integration (#3).
