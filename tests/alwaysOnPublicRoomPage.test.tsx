// @vitest-environment jsdom
/**
 * Always-On public room page (#rooms/<slug>) — the room view with an injected live bundle.
 *
 * Persona: a reader opens a public read-only room, moves between tabs, filters papers and
 * tries to subscribe. These assertions used to run in e2e/always-on-room.spec.ts against the
 * memory-mode demo bundle; that silent demo fallback is gone, so the same behaviour is pinned
 * here against a bundle built from the seed dataset convex/alwaysOn.ts writes into the room.
 * The page states without data (no backend, loading, missing room, query error) are pinned too.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AO_PAPERS, AO_PROOF, AO_ROOM_META, AO_RUNLOG } from "../src/alwayson/demoData";
import type { PublicRoomBundle } from "../src/alwayson/usePublicRoomData";

const state = vi.hoisted(() => ({
  hasConvex: true,
  bundle: undefined as unknown,
  throwQuery: false,
  subscribe: (async () => ({ ok: true })) as (args: unknown) => Promise<unknown>,
}));

vi.mock("../src/app/store", () => ({ get HAS_CONVEX() { return state.hasConvex; } }));
vi.mock("convex/react", () => ({ useMutation: () => (args: unknown) => state.subscribe(args) }));
vi.mock("../src/alwayson/usePublicRoomData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/alwayson/usePublicRoomData")>()),
  usePublicRoomData: () => {
    if (state.throwQuery) throw new Error("alwaysOn module not deployed");
    return state.bundle;
  },
}));

const { PublicRoomPage } = await import("../src/alwayson/PublicRoomPage");

const seededBundle = (): PublicRoomBundle => ({
  source: "live",
  meta: { ...AO_ROOM_META, viewersWeek: null },
  papers: AO_PAPERS,
  runlog: AO_RUNLOG,
  proof: AO_PROOF,
  briefMarkdown: "",
});

function openRoom(...args: [bundle?: unknown]) {
  state.bundle = args.length ? args[0] : seededBundle(); // openRoom(undefined) = still loading
  return render(<PublicRoomPage slug="expositio-pulse" />);
}

afterEach(() => {
  cleanup();
  state.hasConvex = true;
  state.bundle = undefined;
  state.throwQuery = false;
  state.subscribe = async () => ({ ok: true });
});

const N = AO_PAPERS.length;

describe("public room view — a reader browsing a live room", () => {
  it("frame: five tabs, proof footer, read-only strip, live stamp, no Ops tab without ops=1, nothing editable", () => {
    const { container } = openRoom();
    expect(screen.getByTestId("ao-room")).toBeTruthy();
    expect(container.querySelector(".ao-public")?.getAttribute("data-ao-source")).toBe("live");
    for (const id of ["ao-tab-home", "ao-tab-papers", "ao-tab-topics", "ao-tab-weekly-digest", "ao-tab-trace"]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.queryByTestId("ao-tab-ops")).toBeNull();
    expect(container.textContent).not.toContain("viewers this week");

    const proof = screen.getByTestId("ao-proof-footer");
    for (const row of AO_PROOF) expect(proof.textContent).toContain(row.k);
    expect(screen.getByTestId("ao-change-postit").textContent).toMatch(/What changed/i);
    expect(container.querySelector(".ao-ro .hint")?.textContent).toMatch(/viewing a public room/i);

    const room = screen.getByTestId("ao-room");
    expect(room.querySelectorAll("textarea, input, [contenteditable='true']")).toHaveLength(0);
  });

  it("each tab swaps the main surface: brief → papers sheet → topics → empty digest → run log → brief", () => {
    const { container } = openRoom();
    expect(container.querySelector(".ao-brief h2")?.textContent).toContain(AO_ROOM_META.briefTitle);

    fireEvent.click(screen.getByTestId("ao-tab-papers"));
    expect(screen.getByTestId("ao-paper-tools")).toBeTruthy();
    expect(screen.getByTestId("ao-paper-count").textContent).toContain(`${N} of ${N} papers`);
    expect(container.querySelector(".ao-sheet")?.textContent).toContain(AO_PAPERS[0].title);
    expect(container.querySelector(".ao-brief")).toBeNull();

    fireEvent.click(screen.getByTestId("ao-tab-topics"));
    expect(screen.getByTestId("ao-topics-live").textContent).toContain(`${N} papers`);
    expect(container.querySelector(".ao-sheet")).toBeNull();

    fireEvent.click(screen.getByTestId("ao-tab-weekly-digest"));
    expect(container.querySelector(".ao-empty .h")?.textContent).toContain("No weekly digest yet");

    fireEvent.click(screen.getByTestId("ao-tab-trace"));
    const runlog = container.querySelector(".ao-runlog");
    expect(runlog?.querySelectorAll(".ao-run")).toHaveLength(AO_RUNLOG.length);
    const skipped = AO_RUNLOG.find((r) => r.status === "skipped");
    if (skipped) expect(container.querySelector(".ao-run.skipped")?.textContent).toContain(skipped.cost);

    fireEvent.click(screen.getByTestId("ao-tab-home"));
    expect(container.querySelector(".ao-brief h2")?.textContent).toContain(AO_ROOM_META.briefTitle);
  });

  it("tabs, topic chips, paper filters and the proof link are keyboard/click operable", async () => {
    openRoom();
    const home = screen.getByTestId("ao-tab-home");
    const papers = screen.getByTestId("ao-tab-papers");
    expect(home.getAttribute("role")).toBe("tab");
    expect(home.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(home, { key: "ArrowRight" });
    expect(papers.getAttribute("aria-selected")).toBe("true");

    const target = AO_PAPERS.find((p) => /causal/i.test(p.title)) ?? AO_PAPERS[0];
    const matching = AO_PAPERS.filter((p) => [p.title, p.topic, p.discipline].some((f) => f.toLowerCase().includes("causal"))).length;
    fireEvent.change(screen.getByTestId("ao-paper-search"), { target: { value: "causal" } });
    await waitFor(() => expect(screen.getByTestId("ao-paper-count").textContent).toContain(`${matching} of ${N} papers`));
    expect(screen.getAllByTestId("ao-paper-row").some((row) => row.textContent?.includes(target.title))).toBe(true);
    fireEvent.click(screen.getByTestId("ao-paper-clear"));
    await waitFor(() => expect(screen.getByTestId("ao-paper-count").textContent).toContain(`${N} of ${N} papers`));

    fireEvent.click(screen.getByTestId("ao-tab-topics"));
    const topic = AO_PAPERS[0].topic;
    fireEvent.click(screen.getByTestId(`ao-topic-${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`));
    expect(papers.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("ao-paper-topic").textContent).toContain(topic);

    fireEvent.click(screen.getByTestId("ao-proof-trace"));
    expect(screen.getByTestId("ao-tab-trace").getAttribute("aria-selected")).toBe("true");
  });

  it("subscribe: valid email reaches the server and the success copy never claims an email was sent", async () => {
    const calls: unknown[] = [];
    state.subscribe = async (args) => { calls.push(args); return { ok: true }; };
    openRoom();
    fireEvent.click(screen.getByTestId("ao-subscribe-btn"));
    const modal = screen.getByTestId("ao-subscribe-modal");
    expect(modal.textContent).toContain("Daily brief");
    expect(modal.textContent).not.toMatch(/Check your email/i);
    fireEvent.change(screen.getByTestId("ao-subscribe-email"), { target: { value: "reader@university.edu" } });
    await act(async () => { fireEvent.submit(screen.getByTestId("ao-subscribe-email").closest("form")!); });
    expect(calls).toEqual([{ slug: "expositio-pulse", email: "reader@university.edu", cadence: "daily" }]);
    expect(screen.getByTestId("ao-subscribe-success").textContent).toMatch(/no email has been sent/i);
  });

  it("subscribe: a transport failure is an inline error, never a success state", async () => {
    state.subscribe = async () => { throw new Error("function not deployed"); };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    openRoom();
    fireEvent.click(screen.getByTestId("ao-subscribe-btn"));
    fireEvent.change(screen.getByTestId("ao-subscribe-email"), { target: { value: "reader@university.edu" } });
    await act(async () => { fireEvent.submit(screen.getByTestId("ao-subscribe-email").closest("form")!); });
    expect(screen.getByTestId("ao-subscribe-error").textContent).toMatch(/Nothing was stored/i);
    expect(screen.queryByTestId("ao-subscribe-success")).toBeNull();
  });

  it("subscribe: an invalid email is rejected inline before any server call", async () => {
    const calls: unknown[] = [];
    state.subscribe = async (args) => { calls.push(args); return { ok: true }; };
    openRoom();
    fireEvent.click(screen.getByTestId("ao-subscribe-btn"));
    fireEvent.change(screen.getByTestId("ao-subscribe-email"), { target: { value: "not-an-email" } });
    await act(async () => { fireEvent.submit(screen.getByTestId("ao-subscribe-email").closest("form")!); });
    expect(screen.getByTestId("ao-subscribe-error").textContent).toMatch(/valid email/i);
    expect(calls).toHaveLength(0);
  });
});

describe("public room page — honest states without room data", () => {
  it("no backend configured → setup-required panel, no room and no specimen data", () => {
    state.hasConvex = false;
    openRoom();
    expect(screen.getByTestId("setup-required").textContent).toContain("VITE_CONVEX_URL");
    expect(screen.queryByTestId("ao-room")).toBeNull();
  });

  it("loading → loading state, not a demo room", () => {
    openRoom(undefined);
    expect(screen.getByTestId("ao-room-loading")).toBeTruthy();
    expect(screen.queryByTestId("ao-room")).toBeNull();
  });

  it("missing or malformed room → MissingRoom, never relabeled data", () => {
    openRoom(null);
    expect(screen.getByTestId("ao-room-missing").textContent).toContain("expositio-pulse");
    expect(screen.queryByTestId("ao-room")).toBeNull();
  });

  it("throwing live query → explicit unavailable state with a working retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    state.throwQuery = true;
    openRoom();
    expect(screen.getByTestId("ao-room-unavailable").textContent).toContain("Public room unavailable");
    expect(screen.queryByTestId("ao-room")).toBeNull();
    state.throwQuery = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByTestId("ao-room")).toBeTruthy();
  });
});
