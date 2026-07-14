// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceOverlay, TraceOverlay } from "../src/ui/mobile/MobileOverlay";
import { Composer, RoomChat } from "../src/ui/mobile/MobileChat";
import { projectMobileSheetRow, resolveMobileExperience } from "../src/ui/mobile/MobileAppLive";
import { Home } from "../src/ui/mobile/MobileScreens";
import { EvidenceSheet, PlanSheet } from "../src/ui/mobile/MobileSheets";
import * as D from "../src/ui/mobile/mobileData";
import type { MobileCtx } from "../src/ui/mobile/mobileTypes";
import type { Artifact } from "../src/engine/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function liveCtx(overrides: Partial<MobileCtx> = {}): MobileCtx {
  return {
    isLive: true,
    runState: "plan",
    livePlan: D.PLAN,
    liveEvidence: {
      ...D.EVIDENCE,
      claim: "Live renewal claim",
      answer: "The live room currently has one cited renewal source and one unresolved gap.",
      followups: [],
      fallback: "No live answer is available without a room-agent run.",
    },
    requestRoomAgent: vi.fn(async () => ({ ok: true })),
    closeSheet: vi.fn(),
    closeOverlay: vi.fn(),
    openSheet: vi.fn(),
    openSource: vi.fn(),
    toast: vi.fn(),
    recents: [],
    favorites: [],
    briefings: [],
    loading: false,
    setComposerMode: vi.fn(),
    setAgentLane: vi.fn(),
    setDraft: vi.fn(),
    setTab: vi.fn(),
    ...overrides,
  } as unknown as MobileCtx;
}

describe("mobile live-room honesty", () => {
  it("routes live plan approval through the room agent instead of completing a local sample timer", async () => {
    const requestRoomAgent = vi.fn(async (_goal: string) => ({ ok: true }));
    render(<PlanSheet ctx={liveCtx({ requestRoomAgent })} />);

    fireEvent.click(screen.getByRole("button", { name: /Run with NodeAgent/i }));

    await waitFor(() => expect(requestRoomAgent).toHaveBeenCalledTimes(1));
    expect(requestRoomAgent.mock.calls[0][0]).toMatch(/governed room-agent job/i);
    expect(await screen.findByText(/Live request accepted/i)).toBeTruthy();
    expect(screen.queryByText(/Research complete/i)).toBeNull();
  });

  it("shows the live evidence answer and sends follow-ups through the room agent", async () => {
    const requestRoomAgent = vi.fn(async (_goal: string) => ({ ok: true }));
    render(<EvidenceSheet ctx={liveCtx({ requestRoomAgent })} />);

    expect(screen.getByText(/one cited renewal source/i)).toBeTruthy();
    expect(screen.queryByText(/no primary confirmation of round size/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "What supports this?" }));

    await waitFor(() => expect(requestRoomAgent).toHaveBeenCalledTimes(1));
    expect(requestRoomAgent.mock.calls[0][0]).toMatch(/Live renewal claim/);
    expect(await screen.findByText(/Read the answer in the Agent tab/i)).toBeTruthy();
  });

  it("never substitutes a sample trace when a live trace id collides", () => {
    const sampleId = Object.keys(D.TRACES)[0];
    const sampleTitle = D.TRACES[sampleId].title;
    render(<TraceOverlay id={sampleId} ctx={liveCtx({ traceRows: [{ id: sampleId, kind: "commit", text: "Live collision receipt", time: "now" }] })} />);

    expect(screen.getByTestId("mobile-live-trace-fallback")).toBeTruthy();
    expect(screen.getByText("Live collision receipt")).toBeTruthy();
    expect(screen.queryByText(sampleTitle)).toBeNull();
  });

  it("keeps unavailable live source actions disabled instead of reporting success", () => {
    const toast = vi.fn();
    render(<SourceOverlay src={{ text: "Live excerpt", host: "room artifact", verified: true } as D.SourceRef} ctx={liveCtx({ toast })} />);

    expect(screen.getByRole("button", { name: "Original unavailable" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Attach on desktop" }).hasAttribute("disabled")).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });

  it("guides an empty live room into a room-visible NodeAgent request", () => {
    const setComposerMode = vi.fn();
    const setAgentLane = vi.fn();
    const setDraft = vi.fn();
    const setTab = vi.fn();
    render(<Home ctx={liveCtx({ setComposerMode, setAgentLane, setDraft, setTab })} />);

    fireEvent.click(screen.getByRole("button", { name: /Ask NodeAgent/i }));

    expect(setComposerMode).toHaveBeenCalledWith("agent");
    expect(setAgentLane).toHaveBeenCalledWith("room");
    expect(setDraft).toHaveBeenCalledWith(expect.stringMatching(/first source-backed artifact/i));
    expect(setTab).toHaveBeenCalledWith("agent");
  });

  it("uses live people and generic live prompts instead of CardioNova fixtures", () => {
    const runQuick = vi.fn();
    const { rerender } = render(<RoomChat ctx={liveCtx({
      people: { member_live: { name: "Amina", short: "AM", color: "#345", agent: false } },
      roomMsgs: [{ id: "m-live", who: "member_live", kind: "msg", t: "now", text: "Live room message" }],
      mentionPerson: vi.fn(),
      retryMessage: vi.fn(),
    })} />);

    expect(screen.getByText("Amina")).toBeTruthy();
    rerender(<Composer ctx={liveCtx({
      tab: "agent",
      composerMode: "agent",
      draft: "",
      listening: false,
      runQuick,
      setComposerMode: vi.fn(),
      sendComposer: vi.fn(),
      startVoice: vi.fn(),
      stopVoice: vi.fn(),
    })} />);
    expect(screen.queryByText(/CardioNova/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Plan a source-backed first artifact" }));
    expect(runQuick).toHaveBeenCalledWith(expect.objectContaining({ text: "Plan a source-backed first artifact" }));
  });

  it("projects an arbitrary live sheet without substituting the sample company", () => {
    const artifact = {
      id: "sheet-live",
      roomId: "room-live",
      kind: "sheet",
      title: "Q4 renewal review",
      version: 3,
      order: ["row-1__arr"],
      elements: {
        "row-1__arr": {
          id: "row-1__arr",
          version: 2,
          value: { value: "$240k", status: "needs_review" },
          updatedAt: 1,
          updatedBy: { kind: "user", id: "u1", name: "Amina" },
        },
      },
      updatedAt: 1,
      meta: { dataframe: { columns: [{ id: "arr", label: "Renewal ARR", order: 0 }], rowCount: 1 } },
    } as Artifact;

    const row = projectMobileSheetRow(artifact);
    expect(row.entity).toBe("Q4 renewal review");
    expect(row.fields).toEqual([expect.objectContaining({ k: "Renewal ARR", v: "$240k", elementId: "row-1__arr", version: 2 })]);
    expect(JSON.stringify(row)).not.toContain("CardioNova");
  });

  it("keeps session sample provenance when an older backend omits experience", () => {
    expect(resolveMobileExperience(undefined, "sample")).toBe("sample");
    expect(resolveMobileExperience("workspace", "sample")).toBe("workspace");
    expect(resolveMobileExperience(undefined, undefined)).toBe("workspace");
  });
});
