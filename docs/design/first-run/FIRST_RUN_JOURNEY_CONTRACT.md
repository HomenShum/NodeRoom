# NodeRoom First-Run Journey Contract

Captured: 2026-07-10

## Authority

Latest production/main owns behavior. This contract owns the approved first-run
experience. Design artifacts and fixture rooms are evidence, not authority.

## Four Questions

At every step a first-time user must be able to answer:

1. What is NodeRoom?
2. What should I do next?
3. Who can see this and what can NodeAgent change?
4. Did my action work?

## Entry Paths

The public landing exposes three distinct intents before any room mutation:

- **Create a room**: create an empty, code-access workspace.
- **Join with a code**: enter an existing room without creating another one.
- **Try a sample room**: create an explicitly labeled workspace containing
  synthetic diligence artifacts.

Phone-sized Create, Join, and Sample intents must route into the mobile shell.
`surface=desktop` is reserved for deterministic QA and is never emitted by a
normal user-facing call to action.

## Pre-Mutation Contract

Create and Sample require an explicit confirmation surface before the mutation.
It must show:

- room title and display name;
- that allowed visitors with the room code or invite link join as editors and can edit shared content, upload files, use room chat, and run NodeAgent;
- that the route is unlisted but not access-controlled by `noindex`;
- Review every edit as the default NodeAgent policy;
- Auto-approve as an explicit, reversible higher-authority choice;
- whether the room starts empty or with synthetic sample data.

Legacy `?create=` and `?demo=` links must stage this confirmation rather than
silently minting a room.

## First Success

An empty room opens on a calm Home surface with one primary task. Desktop can
offer the artifact creator directly; mobile, where live upload/creation is not
yet wired, must use an honest governed plan rather than a fake artifact:

> Plan your first source-backed artifact

The mobile action opens the room-visible NodeAgent lane with a read-only prompt
that states what source is needed. Chat and Load sample workspace remain
secondary alternatives. A sample room
opens with a persistent `Sample workspace` indicator and one guided task that
opens the primary artifact. The indicator must survive reload and invite join.

The first governed success is:

`artifact -> scoped NodeAgent request -> sourced proposal -> accept/reject -> trace -> export receipt`

## Reliability

- Show acknowledgement immediately after confirmation.
- Creation and join are idempotent across lost responses and reload.
- A failed attempt remains visible and can be retried explicitly; it never loops.
- A blank room never claims that sample seeding is in progress.
- Reload restores the room session, draft, current artifact, and durable work.
- Export receipt includes filename, format, row count, and timestamp.

## Definition Of Done

Fresh desktop and phone contexts complete Create, Join, Sample, first governed
action, export, and reload against the deployed Convex-backed product. Memory
mode, fixture assertions, screenshots, and agent persona reviews cannot replace
that production proof.
