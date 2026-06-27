// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "../src/engine/types";
import type { AgentJobTelemetry } from "../src/app/store";

const mockStore = vi.hoisted(() => ({ current: {} as any }));

vi.mock("convex/react", () => ({ useQuery: () => null }));
vi.mock("../src/app/store", () => ({ CONVEX_SITE_URL: "", useStore: () => mockStore.current }));

import { RoomHome } from "../src/ui/room/RoomHome";

const me: Actor = { kind: "user", id: "u1", name: "Maya" };

function mkJob(id: string, status: string, entrypoint = "room_work"): AgentJobTelemetry {
  return { id, status, entrypoint, attempts: 1, maxAttempts: 3, modelPolicy: "scripted", updatedAt: 1, actionSliceCount: 2, queryCount: 1, modelCallCount: 1, toolCallCount: 1 };
}

function storeWith(jobs: AgentJobTelemetry[]): any {
  return {
    mode: "convex",
    activeLongFreeJobs: () => jobs,
    retryLongFreeJob: vi.fn(async () => ({ ok: true })),
    cancelLongFreeJob: vi.fn(async () => ({ ok: true })),
  };
}

/**
 * Room Home "work lanes" — the review's "Started N work lanes" pattern. The Home command center
 * renders ONE lane card per active agent job (running / queued / failed), summarized by state.
 * Completed/cancelled jobs are NOT lanes (their result is the artifact) — they fall off the rail.
 */
describe("RoomHome work lanes", () => {
  it("renders one lane card per active job with a state-summarized count", () => {
    mockStore.current = storeWith([mkJob("j1", "running"), mkJob("j2", "queued")]);
    render(<RoomHome roomId="r1" me={me} />);

    const lanes = screen.getByTestId("room-work-lanes");
    expect(within(lanes).getAllByTestId("agent-lane-card")).toHaveLength(2);
    expect(screen.getByTestId("room-work-lanes-count").textContent).toBe("1 running · 1 queued");
  });

  it("keeps a failed job on the rail as a 'needs attention' lane with a retry action", () => {
    mockStore.current = storeWith([mkJob("j1", "running"), mkJob("j2", "failed")]);
    render(<RoomHome roomId="r1" me={me} />);

    expect(screen.getAllByTestId("agent-lane-card")).toHaveLength(2);
    expect(screen.getByTestId("room-work-lanes-count").textContent).toBe("1 running · 1 needs attention");
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("shows no work-lanes rail when there are no active jobs", () => {
    mockStore.current = storeWith([]);
    render(<RoomHome roomId="r1" me={me} />);

    expect(screen.queryByTestId("room-work-lanes")).toBeNull();
  });

  it("tolerates a store without activeLongFreeJobs (optional selector → no rail)", () => {
    mockStore.current = { mode: "memory" };
    render(<RoomHome roomId="r1" me={me} />);

    expect(screen.queryByTestId("room-work-lanes")).toBeNull();
  });
});
