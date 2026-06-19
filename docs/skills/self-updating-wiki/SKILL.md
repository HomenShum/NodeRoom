---
name: self-updating-wiki
description: Keep the NodeRoom agent wiki synchronized with room artifacts, upload references, public chat, traces, and agent run evidence. Use when updating the in-app wiki, docs/AGENT_WIKI.md, interview documentation, or any agent-generated table-of-contents page after file uploads, research updates, finance spreadsheet edits, trace changes, or agent workflow changes.
---

# Self Updating Wiki

## Overview

Maintain a room-visible wiki that explains the current state of a NodeRoom workspace from evidence already present in the room. The wiki is a product surface, not a marketing page: keep it structured, source-linked, and safe for every collaborator in the room.

## Source Rules

Use only room-visible evidence:

- Artifacts: wiki, spreadsheets, research tables, notes, wall cards, uploaded files.
- Element state: values, versions, locks, drafts, proposals, source metadata.
- Trace state: uploads, edits, lock lifecycle, merges, approvals, agent status, run telemetry.
- Public chat messages and private-agent notes only after the user promotes them.
- Existing citations and uploaded file references already attached to artifacts or messages.

Do not use private chat, private drafts, uncited external facts, guesses about a company, or inferred financial conclusions that are not supported by artifact or trace evidence.

## Stable Structure

Render the wiki with a stable table of contents:

1. Overview
2. Files
3. Agents
4. Workflows
5. Rules
6. Backend
7. Recent trace

Each section must be scannable. The Files section must expose links or buttons that reopen the underlying artifact. A file reference in chat is encoded as:

```text
References: File title -> noderoom-artifact:<artifact-id>
```

Treat this as a pointer to source material, not a copy of the file content.

## Update Workflow

1. Read the room artifact list and identify newly uploaded, edited, or selected files.
2. Read trace entries since the last wiki version and group them by workflow: upload, research, finance edit, lock/draft/merge, proposal, agent run.
3. Rebuild the table of contents in the fixed order.
4. Update Files with artifact titles, versions, row counts or file metadata, and clickable artifact ids.
5. Update Agents with public/private agent scope, status, and recent run telemetry only when trace evidence exists.
6. Update Workflows with concise finance and GTM status, naming missing evidence as "unknown" instead of filling gaps.
7. Update Rules and Backend only when implementation rules or deployment assumptions changed.
8. Append a Recent trace summary with times and event names; keep it short.

## Trigger Events

Refresh the wiki after:

- File upload or artifact creation.
- Chat message sent with a file reference.
- Research rows imported, requeued, completed, or source-cited.
- Spreadsheet edits, lock release, draft merge, proposal approval, or proposal rejection.
- Agent run completion, failure, model change, cost update, or tool-call telemetry update.
- User promotion of a private agent note to public chat.

## Validation

Before finishing:

- Confirm every file link resolves to an existing artifact id.
- Confirm no private channel text appears in shared wiki output unless promoted.
- Confirm unsupported claims have citations or are removed.
- Confirm the table of contents still has the seven required sections.
- Confirm the wiki update is reflected in `docs/AGENT_WIKI.md` when the repo docs changed.
