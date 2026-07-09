// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../src/engine/types";
import type { MobileLive } from "../src/ui/mobile/mobileTypes";

const captured = vi.hoisted(() => ({ live: null as MobileLive | null }));
const storeRef = vi.hoisted(() => ({ current: null as any }));

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(async () => ({})),
  useQuery: () => [],
}));

vi.mock("../src/app/store", () => ({
  useStore: () => storeRef.current,
}));

vi.mock("../src/ui/mobile/MobileApp", async () => {
  const actual = await vi.importActual<typeof import("../src/ui/mobile/MobileApp")>("../src/ui/mobile/MobileApp");
  return {
    ...actual,
    MobileApp: ({ live }: { live?: MobileLive }) => {
      captured.live = live ?? null;
      return null;
    },
  };
});

import { MobileAppLive } from "../src/ui/mobile/MobileAppLive";
import { mobileAgentModelSelection } from "../src/ui/mobile/MobileApp";

const me: Actor = { kind: "user", id: "u1", name: "Maya" };

function baseStore(): any {
  return {
    getRoom: () => ({ id: "r1", title: "Live Room", code: "R-123", autoAllow: false }),
    listMembers: () => [{ id: "u1", roomId: "r1", name: "Maya", role: "host", anon: false, color: "#111111", lastSeenAt: 1 }],
    listMessages: () => [],
    listArtifacts: () => [],
    getArtifact: () => undefined,
    listProposals: () => [],
    lastLongFreeJob: () => null,
    listSessions: () => [],
    listTraces: () => [],
    postMessage: vi.fn(async () => ({ ok: true })),
    askAgent: vi.fn(async () => undefined),
    askPrivateAgent: vi.fn(async () => undefined),
    applyEdit: vi.fn(async () => ({ ok: true })),
    resolveProposal: vi.fn(async () => ({ ok: true })),
    cancelLongFreeJob: vi.fn(async () => ({ ok: true })),
    retryLongFreeJob: vi.fn(async () => ({ ok: true })),
    toggleAutoAllow: vi.fn(),
    acknowledgeOfflineConflicts: vi.fn(),
  };
}

describe("mobile agent model routing", () => {
  beforeEach(() => {
    captured.live = null;
    storeRef.current = baseStore();
  });

  afterEach(cleanup);

  it("maps the mobile Auto-route chip to the governed adaptive route", () => {
    expect(mobileAgentModelSelection("auto")).toEqual({ mode: "adaptive" });
    expect(mobileAgentModelSelection("z-ai/glm-5.2")).toEqual({ mode: "specific", modelPolicy: "z-ai/glm-5.2" });
  });

  it("forwards selected model routes through the live public room-agent path", async () => {
    render(<MobileAppLive roomId="r1" me={me} />);
    expect(captured.live).toBeTruthy();

    const modelSelection = { mode: "specific" as const, modelPolicy: "z-ai/glm-5.2" };
    await captured.live!.askRoomAgent("review the CardioNova row", modelSelection);

    expect(storeRef.current.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      roomId: "r1",
      channel: "public",
      text: "review the CardioNova row",
      kind: "chat",
    }));
    expect(storeRef.current.askAgent).toHaveBeenCalledWith({
      goal: "review the CardioNova row",
      modelSelection,
    });
  });

  it("keeps private live asks on the private-agent API without a model override", async () => {
    render(<MobileAppLive roomId="r1" me={me} />);
    expect(captured.live).toBeTruthy();

    await captured.live!.askPrivateAgent("summarize privately");

    expect(storeRef.current.askPrivateAgent).toHaveBeenCalledWith({ goal: "summarize privately" });
    expect(storeRef.current.askAgent).not.toHaveBeenCalled();
  });
});
