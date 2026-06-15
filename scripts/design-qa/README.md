# Design-QA flow (converging polish gate)

Implements docs/design/DESIGN_QA_LADDER.md. Polish is a gate that **terminates**, not a perpetual critic.
The order is: deterministic ground-truth first, baseline diff for convergence, the VLM last and advisory.

## Stages

| Stage | File | Blocking? | Run |
|---|---|---|---|
| S0+S1+S2+S5 deterministic floor | `floor.ts` | **yes** (objective) | `QA_BASE_URL=http://localhost:5301 npx tsx scripts/design-qa/floor.ts` |
| S3 approved-baseline diff | `../../e2e/design-baseline.spec.ts` | **yes** | `npx playwright test design-baseline` (approve: `--update-snapshots`) |
| S4 rubric VLM panel | `rubric-panel.ts` | no (advisory) | `npx tsx scripts/design-qa/rubric-panel.ts --media=cand.png [--reference=base.png] [--floor=.tmp-qa/design-floor.json]` |
| S6 convergence | (the exit codes + the rule below) | -- | -- |
| S7 CI gate | `../../.github/workflows/design-gate.yml` | required check | on PRs touching `src/ui/**` / `styles.css` |

The floor exits non-zero unless the **SHIP bar** (zero P0/P1) is met. The panel is advisory (exit 0 always)
until it is calibrated against a ~50-100 human-labeled golden set.

## The convergence rule (the perpetual-critic kill switch)

STOP and ship when ANY of:
1. the candidate **matches the approved baseline** within the perceptual threshold (S3) -- the dominant exit;
   a settled screen is never sent to the VLM and can never be re-flagged;
2. the **SHIP bar** is met: floor has zero P0/P1 AND (advisory) panel `passBar` (mean >= 4/5, no dim < 3/5,
   no open P0/P1), with all P2s deferred to a selector-keyed backlog;
3. the **bounded-round cap** fires: no new P0/P1 for 2 rounds, or MAX_ROUNDS=3.

Baseline promotion is an explicit human step (`--update-snapshots`); the system never self-certifies "polished."

## Why it converges (and the old loop did not)

The VLM is asked a **reachable** question ("how far from THIS approved reference?") not an **unreachable** one
("is this polished?"). Most checks are moved to deterministic ground truth (the floor), so the VLM only judges
genuine subjective craft on **changed** surfaces, and the approved baseline stops re-litigating settled pixels.

## Notes

- Run from the **real** `node_modules` (a worktree `node_modules` junction breaks tsx ESM resolution).
- The floor needs a live app (`:5301` dev server); it captures demo desktop/mobile + the blank room.
- First validation already found WCAG AA contrast failures that 5 rounds of open-ended VLM critique missed --
  the point of the deterministic floor.
