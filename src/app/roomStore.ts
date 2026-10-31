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
import type { Actor } from "../engine/types";

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
  // Seed a starter variance sheet. engine.createRoom() creates a BARE room, so
  // without this the StoryLab playground (its only caller) has no sheet — the
  // grid seeds nothing and the L4/L7 lease drill silently no-ops on artId "".
  // The grid + drills address cells as `${rowId}__${col}` (A/B/C), so an empty
  // sheet is enough; LabGrid fills A/B and the drills write C.
  engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Variance", by: me, seed: [] });
  return { roomId: room.id, me };
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
