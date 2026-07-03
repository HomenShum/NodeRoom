/**
 * All-artifact edits — scenario test for "the agent can edit ANY artifact, not just the sheet".
 *
 * Persona: a NodeAgent (public) working in one room that holds the product's full trio — a spreadsheet,
 * a shared NOTE, and a post-it WALL. Goal: prove the tools port edits every type through the SAME CAS
 * spine (set / create / delete), that snapshot exposes raw elements for the kind-agnostic context
 * builders, and that buildNoteContext / buildWallContext render correct, actionable context.
 *
 * Angles covered: happy path (note rewrite, post-it add/move/remove), sad path (CAS conflict on a stale
 * base for both a note and a post-it), and context legibility (the model sees current state + how to act).
 */

import { describe, it, expect } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { buildNoteContext, buildWallContext } from "../src/nodeagent/core/worldModel";
import type { Actor } from "../src/engine/types";

function setup() {
  const eng = new RoomEngine();
  const { room, host } = eng.createRoom({ title: "Q3 Review", hostName: "Maya", autoAllow: true });
  const hostActor: Actor = { kind: "user", id: host.id, name: "Maya" };
  const note = eng.createArtifact({
    roomId: room.id, kind: "note", title: "Team notes", by: hostActor,
    seed: [{ id: "doc", value: "<h1>Team notes</h1><p>Original body.</p>" }],
  });
  const wall = eng.createArtifact({
    roomId: room.id, kind: "wall", title: "Ideas wall", by: hostActor,
    seed: [{ id: "s_welcome", value: { text: "Drop ideas here", x: 60, y: 60, color: "#FDE68A" } }],
  });
  const agent: Actor = { kind: "agent", id: "pub", name: "Room Agent", scope: "public" };
  const sess = eng.startSession({ roomId: room.id, agentId: "pub", agentName: "Room Agent", scope: "public" });
  const noteTools = new InMemoryRoomTools(eng, room.id, note.id, agent, sess.id);
  const wallTools = new InMemoryRoomTools(eng, room.id, wall.id, agent, sess.id);
  return { eng, room, note, wall, agent, noteTools, wallTools };
}

describe("all-artifact edits — a NodeAgent edits a NOTE", () => {
  it("rewrites the doc body with CAS and the new value is visible in the snapshot", async () => {
    const { eng, note, noteTools } = setup();
    const r = await noteTools.editCell("doc", "<h1>Team notes</h1><p>Rewritten by the agent.</p>", 1);
    expect(r.ok).toBe(true);
    expect(String(eng.getArtifact(note.id)!.elements.doc.value)).toContain("Rewritten by the agent");
    const snap = await noteTools.snapshot();
    expect(snap.elements?.find((e) => e.id === "doc")?.value).toContain("Rewritten by the agent");
  });

  it("returns a conflict (no clobber) on a stale base version", async () => {
    const { noteTools } = setup();
    const first = await noteTools.editCell("doc", "<p>v2</p>", 1);
    expect(first.ok).toBe(true);
    const stale = await noteTools.editCell("doc", "<p>also v2</p>", 1); // base 1 is now stale
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect("conflict" in stale && stale.conflict).toBe(true);
  });
});

describe("all-artifact edits — a NodeAgent works the post-it WALL (create / move / delete)", () => {
  it("creates a new post-it with kind 'create'", async () => {
    const { eng, wall, wallTools } = setup();
    const r = await wallTools.editCell("s_idea1", { text: "Cut OpEx 5%", x: 200, y: 120, color: "#BBF7D0" }, 0, undefined, "create");
    expect(r.ok).toBe(true);
    const el = eng.getArtifact(wall.id)!.elements.s_idea1;
    expect(el).toBeTruthy();
    expect((el.value as { text: string }).text).toBe("Cut OpEx 5%");
  });

  it("moves an existing post-it with CAS, and rejects a stale move", async () => {
    const { wall, eng, wallTools } = setup();
    const baseV = eng.getArtifact(wall.id)!.elements.s_welcome.version;
    const moved = await wallTools.editCell("s_welcome", { text: "Drop ideas here", x: 320, y: 200, color: "#FDE68A" }, baseV, undefined, "set");
    expect(moved.ok).toBe(true);
    const stale = await wallTools.editCell("s_welcome", { text: "x", x: 0, y: 0, color: "#FDE68A" }, baseV, undefined, "set");
    expect(stale.ok).toBe(false);
  });

  it("deletes a post-it with kind 'delete'", async () => {
    const { eng, wall, wallTools } = setup();
    const baseV = eng.getArtifact(wall.id)!.elements.s_welcome.version;
    const r = await wallTools.editCell("s_welcome", null, baseV, undefined, "delete");
    expect(r.ok).toBe(true);
    expect(eng.getArtifact(wall.id)!.elements.s_welcome).toBeUndefined();
  });
});

describe("all-artifact edits — kind-agnostic context builders", () => {
  it("buildNoteContext serves the BLOCK protocol when the notebook lane exists", async () => {
    const { noteTools } = setup();
    const [msg] = await buildNoteContext(noteTools, "Tighten the intro");
    expect(msg.content).toContain("NOTEBOOK");
    // Current body is visible as addressable blocks, fenced as untrusted.
    expect(msg.content).toContain("Original body");
    expect(msg.content).toContain("UNTRUSTED ROOM DATA");
    // The governed write protocol replaces whole-doc rewrites.
    expect(msg.content).toContain("append_notebook_outline");
    expect(msg.content).toContain("read_notebook");
    expect(msg.content).not.toMatch(/write_locked_cell on/);
  });

  it("buildNoteContext keeps the legacy doc-element protocol when the notebook lane is absent", async () => {
    const { noteTools } = setup();
    // A RoomTools port without the notebook capability (rooms predating the lane).
    const legacyTools = Object.create(noteTools, {
      readNotebook: { value: undefined },
      applyNotebookOutline: { value: undefined },
    }) as typeof noteTools;
    const [msg] = await buildNoteContext(legacyTools, "Tighten the intro");
    expect(msg.content).toContain("NOTE");
    expect(msg.content).toContain("Original body");
    expect(msg.content).toContain("doc");
    expect(msg.content).toMatch(/update_wiki|kind "set"/);
  });

  it("buildWallContext lists existing post-its + how to add one", async () => {
    const { wallTools } = setup();
    const [msg] = await buildWallContext(wallTools, "Add three risk ideas");
    expect(msg.content).toContain("POST-IT WALL");
    expect(msg.content).toContain("Drop ideas here");
    expect(msg.content).toContain('kind "create"');
  });
});
