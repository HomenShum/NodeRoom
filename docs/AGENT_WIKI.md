# Agent Wiki Rules

The in-app wiki is currently generated deterministically from room state. A future
LLM-backed wiki agent must write the same structure and follow these rules.
Current storage note: the visible wiki surface is still rendered over room
state and note/artifact data in places. `wikiPages` and `wikiRevisions` are
schema foundations, not yet the canonical live write path for all wiki updates.

The reusable skill contract is checked in at
[`docs/skills/self-updating-wiki/SKILL.md`](skills/self-updating-wiki/SKILL.md).

## Sources

Use only room-visible state:

- Artifacts and elements: spreadsheets, research rows, notes, wall cards, uploads.
- Chat artifact references encoded as `References: Title -> noderoom-artifact:<id>`.
- Room trace entries: locks, edits, drafts, merges, approvals, uploads, agent status.
- Agent sessions and latest run telemetry.
- Public chat messages and promoted private insights.
- Cited research sources already attached to research rows.

Do not infer private channel content, private drafts, uncited claims, or external facts
that are not already in the room.

## Structure

Keep a stable table of contents:

1. Overview
2. Files
3. Agents
4. Workflows
5. Rules
6. Backend
7. Recent trace

Every section should be scannable and anchored. The Files section must link back to
the artifact/file views so GTM and finance users can open source material quickly.

## Update Triggers

Refresh after:

- File upload or artifact creation.
- Chat messages with file references.
- Research rows added, requeued, or completed.
- Finance spreadsheet edits, lock release, draft merge, or proposal approval.
- Agent run completion, failure, or model/cost telemetry update.
- Public promotion of a private agent note.

## Privacy And Accuracy

- Shared wiki content must be safe for everyone in the room.
- Private chat content remains private until promoted by the user.
- Use trace evidence for operational claims.
- Use research citations for company claims.
- Prefer "unknown" or omitted fields over invented specifics.
