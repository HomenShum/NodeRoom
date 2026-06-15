/**
 * roomStore — the singleton engine + demo room, exposed to React.
 *
 * `useEngineRev()` is a `useSyncExternalStore` subscription over the engine's
 * own change notifications — the local mirror of a Convex reactive query. UI
 * components call it to re-render, then read engine data directly. (In prod,
 * swap `engine.*` reads for Convex `useQuery` and `engine.*` writes for mutations.)
 */

import { useSyncExternalStore } from "react";
import { RoomEngine } from "../engine/roomEngine";
import { buildDemoRoom, playCollab, type DemoRoom } from "../engine/demoRoom";
import type { Actor, ArtifactMeta, DataframeColumn } from "../engine/types";

export const engine = new RoomEngine({ now: () => Date.now() });
export const demo: DemoRoom = buildDemoRoom(engine);

let rev = 0;
engine.subscribe(() => { rev += 1; });

/** Re-render whenever the engine changes (the reactive-query mirror). */
export function useEngineRev(): number {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => rev,
    () => rev,
  );
}

export function createFreshRoom(title: string, hostName: string): { roomId: string; me: Actor } {
  const { room, host } = engine.createRoom({ title: title || "Untitled room", hostName: hostName || "Host", autoAllow: true });
  const me: Actor = { kind: "user", id: host.id, name: host.name };
  const seed = blankSheetSeed();
  const meta: ArtifactMeta = { dataframe: { columns: blankSheetColumns(), rowCount: 8, sourceFile: "blank-room", parser: "blank_seed", truncated: false, warnings: [] } };
  engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Blank sheet", by: me, seed, meta });
  engine.createArtifact({ roomId: room.id, kind: "note", title: "Note", by: me, seed: [{ id: "doc", value: "<h1>Notes</h1><p></p>" }] });
  engine.createArtifact({ roomId: room.id, kind: "wall", title: "Wall", by: me, seed: [] });
  return { roomId: room.id, me };
}

function blankSheetSeed(): Array<{ id: string; value: unknown }> {
  const seed: Array<{ id: string; value: unknown }> = [];
  for (let row = 1; row <= 8; row++) {
    for (const col of ["A", "B", "C"]) seed.push({ id: `r${row}__${col}`, value: "" });
  }
  return seed;
}

function blankSheetColumns(): DataframeColumn[] {
  return ["A", "B", "C"].map((label, order): DataframeColumn => ({ id: label, label, order, mode: "manual", type: "text", agentWritable: true }));
}

export function enterDemoRoomAsHost(_hostName?: string): { roomId: string; me: Actor } {
  return { roomId: demo.roomId, me: demo.members.homen };
}

export function joinRoomByCode(code: string, name: string): { roomId: string; me: Actor } | null {
  const res = engine.joinRoom({ code: code.trim(), name: name.trim() || "Guest" });
  if (!res) return null;
  return { roomId: res.room.id, me: { kind: "user", id: res.member.id, name: res.member.name } };
}

export function runDemo(conflict: boolean): Promise<void> {
  const reduced = window.matchMedia?.("(prefers-reduced-motion:reduce)").matches ?? false;
  return playCollab(engine, demo, { reduced, conflict });
}
