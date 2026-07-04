// @vitest-environment jsdom
/**
 * PeoplePanel — the room-level rung of the presence ladder: facepile → panel
 * (role groups · live location · Follow).
 *
 * Scenario: Dana (host) runs a live diligence room with Priya and Maya
 * (members), Quinn (an anonymous guest link), and the Room NodeAgent. Priya is
 * deep in the Company research grid; Maya's presence claim expired minutes ago;
 * the agent holds an intent claim. Dana opens the people panel from the
 * facepile, sees everyone grouped by role with an honest live-location line,
 * and hits Follow on Priya — her work surface now tracks Priya's cursor until
 * Dana presses Esc, clicks a tab herself, or Priya leaves the room.
 *
 * Covers: happy path (grouping, freshest-claim location, Follow activates the
 * tab via the palette's DOM contract + focusStage), sad paths (expired claims
 * → idle, empty search), adversarial (followed member vanishes mid-follow →
 * pill clears honestly, no ghost camera), and leak-safety under sustained
 * follow/stop cycles (single interval, everything cleared).
 */
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockStore = vi.hoisted(() => ({ current: {} as any }));

vi.mock("convex/react", () => ({ useQuery: () => null, useMutation: () => () => Promise.resolve() }));
vi.mock("../src/app/store", () => ({ useStore: () => mockStore.current }));

import {
  PeoplePanel,
  groupPeople,
  liveLocationFor,
  statusFor,
  targetLabel,
  FOLLOW_POLL_MS,
  FOLLOW_FRAME_MS,
} from "../src/ui/PeoplePanel";
import { onStageFocus, type StageFocusTarget } from "../src/ui/stageFocus";

type AnyClaim = {
  id: string; roomId: string; artifactId?: string; targetKind: string; targetId: string;
  mode: string; actor: { kind: string; id: string; name: string }; color?: string;
  updatedAt: number; expiresAt: number;
};

const ROOM = "room-1";
const LONG_TTL = 1_000_000_000;

function makeFixture() {
  const now = Date.now();
  const members = [
    { id: "u-dana", roomId: ROOM, name: "Dana", role: "host" as const, anon: false, color: "#D97757", lastSeenAt: now },
    { id: "u-priya", roomId: ROOM, name: "Priya", role: "member" as const, anon: false, color: "#5E6AD2", lastSeenAt: now },
    { id: "u-maya", roomId: ROOM, name: "Maya", role: "member" as const, anon: false, color: "#24945F", lastSeenAt: now },
    { id: "u-quinn", roomId: ROOM, name: "Quinn", role: "member" as const, anon: true, color: "#888888", lastSeenAt: now },
  ];
  const sessions = [
    { id: "s1", roomId: ROOM, agentId: "agent-room", agentName: "Room NodeAgent", scope: "public" as const, status: "working" as const, lastAction: "enriching", updatedAt: now },
  ];
  const artifacts = [
    { id: "art-research", roomId: ROOM, kind: "sheet", title: "Company research" },
    { id: "art-variance", roomId: ROOM, kind: "sheet", title: "Q3 variance" },
  ];
  const mkClaim = (actorId: string, name: string, artifactId: string, targetId: string, mode: string, updatedAt: number, expiresAt: number, kind = "user"): AnyClaim => ({
    id: `${actorId}:${targetId}:${mode}`, roomId: ROOM, artifactId, targetKind: "cell", targetId, mode,
    actor: { kind, id: actorId, name }, updatedAt, expiresAt,
  });
  const presence: Record<string, AnyClaim[]> = {
    "art-research": [
      // Priya's FRESHEST claim — the location line and Follow must use this one.
      mkClaim("u-priya", "Priya", "art-research", "sr_0004__owner", "focus", now - 1_000, now + LONG_TTL),
      mkClaim("agent-room", "Room NodeAgent", "art-research", "sr_0005__summary", "agent_intent", now - 2_000, now + LONG_TTL, "agent"),
    ],
    "art-variance": [
      // Priya's OLDER claim on another sheet — must lose to the fresher research claim.
      mkClaim("u-priya", "Priya", "art-variance", "r2__variance", "focus", now - 60_000, now + LONG_TTL),
      // Maya's claim EXPIRED — she must read as idle / "In the room".
      mkClaim("u-maya", "Maya", "art-variance", "r3__variance", "edit", now - 120_000, now - 60_000),
    ],
  };
  const store = {
    listMembers: () => members,
    listSessions: () => sessions,
    listArtifacts: () => artifacts,
    listPresence: (_rid: string, artifactId: string) => presence[artifactId] ?? [],
    getArtifact: (id: string) => artifacts.find((a) => a.id === id),
  };
  return { now, members, sessions, artifacts, presence, store };
}

const me = { kind: "user" as const, id: "u-dana", name: "Dana" };

function renderPanel(opts: { open?: boolean } = {}) {
  const fixture = makeFixture();
  mockStore.current = fixture.store;
  const onClose = vi.fn();
  const onOpenArtifact = vi.fn(() => true);
  const utils = render(
    <div>
      {/* Stand-in for the work-surface tab strip (panels/Artifact.tsx DOM contract). */}
      <div data-testid="artifact-tabs">
        <button type="button" data-testid="artifact-filetab"><span className="r-filetab-name">Company research</span></button>
        <button type="button" data-testid="artifact-filetab"><span className="r-filetab-name">Q3 variance</span></button>
      </div>
      <PeoplePanel roomId={ROOM} me={me} open={opts.open ?? true} onClose={onClose} onOpenArtifact={onOpenArtifact} />
    </div>,
  );
  return { fixture, onClose, onOpenArtifact, ...utils };
}

/** Collect focusStage() emissions for the duration of a test. */
function captureStageFocus() {
  const targets: StageFocusTarget[] = [];
  const off = onStageFocus((t) => targets.push(t));
  return { targets, off };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("groupPeople / liveLocationFor / statusFor — pure derivations", () => {
  it("groups by role (host/members/guests/agents), sorts names deterministically, dedupes agent sessions", () => {
    const { members, sessions } = makeFixture();
    const doubled = [...sessions, { ...sessions[0], id: "s2", updatedAt: sessions[0].updatedAt + 1 }];
    const groups = groupPeople(members as any, doubled as any);
    expect(groups.map((g) => g.key)).toEqual(["host", "member", "guest", "agent"]);
    expect(groups.find((g) => g.key === "host")!.rows.map((r) => r.id)).toEqual(["u-dana"]);
    expect(groups.find((g) => g.key === "member")!.rows.map((r) => r.name)).toEqual(["Maya", "Priya"]);
    expect(groups.find((g) => g.key === "guest")!.rows.map((r) => r.id)).toEqual(["u-quinn"]);
    expect(groups.find((g) => g.key === "agent")!.rows).toHaveLength(1); // deduped by agentId
  });

  it("live location picks the FRESHEST unexpired claim across all artifacts; expired-only actors are idle", () => {
    const { store, now } = makeFixture();
    const priya = liveLocationFor("u-priya", ROOM, store as any, now);
    expect(priya).toMatchObject({ artifactId: "art-research", targetId: "sr_0004__owner", text: "Company research · owner" });
    expect(statusFor(priya)).toBe("viewing");
    expect(liveLocationFor("u-maya", ROOM, store as any, now)).toBeNull(); // her only claim expired
    expect(statusFor(null)).toBe("idle");
    const agent = liveLocationFor("agent-room", ROOM, store as any, now);
    expect(statusFor(agent)).toBe("running");
    expect(targetLabel("sr_0004__owner")).toBe("owner");
    expect(targetLabel("block-17")).toBe("block-17"); // notebook blocks pass through un-mangled
  });
});

describe("PeoplePanel — Dana opens the panel", () => {
  it("renders role groups with honest live-location lines and Follow only where it can act", () => {
    renderPanel();
    expect(screen.getByTestId("people-panel")).toBeTruthy();
    for (const key of ["host", "member", "guest", "agent"]) expect(screen.getByTestId(`people-group-${key}`)).toBeTruthy();

    const rows = screen.getAllByTestId("people-row");
    const rowFor = (id: string) => rows.find((r) => r.getAttribute("data-person-id") === id)!;
    expect(rowFor("u-dana").textContent).toContain("(you)");
    expect(rowFor("u-priya").textContent).toContain("Company research · owner");
    expect(rowFor("u-priya").textContent).toContain("viewing");
    expect(rowFor("u-maya").textContent).toContain("In the room"); // expired claim → idle, no fake location
    expect(rowFor("u-maya").textContent).toContain("idle");
    expect(rowFor("agent-room").textContent).toContain("running");

    // Active-first within the group: Priya (live cursor) floats above idle Maya even though
    // Maya sorts first alphabetically — the panel must not bury followable people.
    const memberIds = Array.from(screen.getByTestId("people-group-member").querySelectorAll('[data-testid="people-row"]'))
      .map((r) => r.getAttribute("data-person-id"));
    expect(memberIds).toEqual(["u-priya", "u-maya"]);

    // Follow: only Priya (a live, other, human member). Not me, not idle Maya, not the agent.
    expect(screen.getByLabelText("Follow Priya")).toBeTruthy();
    expect(screen.queryByLabelText("Follow Dana")).toBeNull();
    expect(screen.queryByLabelText("Follow Maya")).toBeNull();
    expect(screen.queryByLabelText("Follow Room NodeAgent")).toBeNull();
  });

  it("search narrows across groups and shows an honest empty state", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Find people"), { target: { value: "pri" } });
    const rows = screen.getAllByTestId("people-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-person-id")).toBe("u-priya");

    fireEvent.change(screen.getByLabelText("Find people"), { target: { value: "zzz-nobody" } });
    expect(screen.queryAllByTestId("people-row")).toHaveLength(0);
    expect(screen.getByTestId("people-empty").textContent).toContain("zzz-nobody");
  });

  it("Esc and outside pointer-down dismiss the panel (no undismissable chrome)", () => {
    const { onClose } = renderPanel();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
    // Clicking INSIDE the panel does not dismiss it.
    fireEvent.mouseDown(screen.getByTestId("people-panel"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("PeoplePanel — Follow (camera-follow with an honest leash)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("Follow activates Priya's artifact tab (palette DOM contract) + focusStage, then tracks her moves", () => {
    const { fixture, onOpenArtifact } = renderPanel();
    const { targets, off } = captureStageFocus();
    const researchTab = screen.getAllByTestId("artifact-filetab")[0];
    const tabClicks = vi.fn();
    researchTab.addEventListener("click", tabClicks);

    fireEvent.click(screen.getByLabelText("Follow Priya"));
    // (a) tab-state activation through RoomShell.openArtifact…
    expect(onOpenArtifact).toHaveBeenCalledWith("art-research");
    // …then, one settle-frame later, (b) the DOM-contract filetab click + stage focus.
    act(() => { vi.advanceTimersByTime(FOLLOW_FRAME_MS); });
    expect(tabClicks).toHaveBeenCalledTimes(1);
    expect(targets).toEqual([{ artifactId: "art-research", elementId: "sr_0004__owner" }]);
    expect(screen.getByTestId("follow-pill").textContent).toContain("Following Priya");

    // Priya moves to another cell → next poll re-aims the camera exactly once.
    fixture.presence["art-research"][0] = {
      ...fixture.presence["art-research"][0],
      targetId: "sr_0009__funding",
      id: "u-priya:sr_0009__funding:focus",
      updatedAt: Date.now(),
    };
    act(() => { vi.advanceTimersByTime(FOLLOW_POLL_MS + FOLLOW_FRAME_MS); });
    expect(targets).toHaveLength(2);
    expect(targets[1]).toEqual({ artifactId: "art-research", elementId: "sr_0009__funding" });

    // She holds still → polls keep running but the camera does NOT re-fire.
    act(() => { vi.advanceTimersByTime(FOLLOW_POLL_MS * 3); });
    expect(targets).toHaveLength(2);
    off();
  });

  it("Esc stops following: pill clears, the interval dies, no further focus is emitted", () => {
    renderPanel();
    const { targets, off } = captureStageFocus();
    fireEvent.click(screen.getByLabelText("Follow Priya"));
    act(() => { vi.advanceTimersByTime(FOLLOW_FRAME_MS); });
    expect(screen.getByTestId("follow-pill")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("follow-pill")).toBeNull();
    const emitted = targets.length;
    act(() => { vi.advanceTimersByTime(FOLLOW_POLL_MS * 5); });
    expect(targets).toHaveLength(emitted);
    expect(vi.getTimerCount()).toBe(0); // single interval + frame timer both cleared
    off();
  });

  it("a MANUAL tab click stops following, but the follow's own programmatic click does not", () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText("Follow Priya"));
    // The follow's own DOM-contract click happens inside this window — pill must survive it.
    act(() => { vi.advanceTimersByTime(FOLLOW_FRAME_MS); });
    expect(screen.getByTestId("follow-pill")).toBeTruthy();

    // Dana clicks a tab herself → she took the wheel; following stops.
    fireEvent.click(screen.getAllByTestId("artifact-filetab")[1]);
    expect(screen.queryByTestId("follow-pill")).toBeNull();
  });

  it("adversarial: Priya leaves the room mid-follow → the pill clears honestly and the camera never ghosts", () => {
    const { fixture } = renderPanel();
    const { targets, off } = captureStageFocus();
    fireEvent.click(screen.getByLabelText("Follow Priya"));
    act(() => { vi.advanceTimersByTime(FOLLOW_FRAME_MS); });
    expect(screen.getByTestId("follow-pill")).toBeTruthy();
    const emitted = targets.length;

    fixture.members.splice(fixture.members.findIndex((m) => m.id === "u-priya"), 1);
    act(() => { vi.advanceTimersByTime(FOLLOW_POLL_MS); });
    expect(screen.queryByTestId("follow-pill")).toBeNull();
    act(() => { vi.advanceTimersByTime(FOLLOW_POLL_MS * 3); });
    expect(targets).toHaveLength(emitted);
    expect(vi.getTimerCount()).toBe(0);
    off();
  });

  it("sustained: 5 follow/stop cycles + unmount leave zero timers and balanced window listeners", () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderPanel();
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByLabelText("Follow Priya"));
      act(() => { vi.advanceTimersByTime(FOLLOW_FRAME_MS + FOLLOW_POLL_MS); });
      fireEvent.keyDown(window, { key: "Escape" });
    }
    // Unmount mid-follow: the teardown path must also clear the live interval.
    fireEvent.click(screen.getByLabelText("Follow Priya"));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    const addedKeydown = added.mock.calls.filter((c) => c[0] === "keydown").length;
    const removedKeydown = removed.mock.calls.filter((c) => c[0] === "keydown").length;
    expect(addedKeydown).toBeGreaterThan(0);
    expect(removedKeydown).toBe(addedKeydown);
    added.mockRestore();
    removed.mockRestore();
  });
});
