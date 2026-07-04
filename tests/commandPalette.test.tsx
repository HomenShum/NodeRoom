// @vitest-environment jsdom
/**
 * ⌘K command palette — the keyboard layer for a banker working a live room.
 *
 * Scenario: Dana, a banker mid-diligence, keeps her hands on the keyboard —
 * she hits Ctrl/Cmd+K to summon the palette, types a few characters to find an
 * artifact or a shell command (toggle focus mode, copy the invite code, open
 * Trace/Graph, jump to chat), walks the list with j/k or arrows, runs the
 * selection with Enter, and bails with Esc back to exactly where she was.
 *
 * Covers: happy path (open, combobox semantics, filter, Enter runs action /
 * opens artifact), sad paths (Ctrl+K ignored mid-typing, Enter on an empty
 * result set, Esc focus restore), adversarial inputs (200-artifact rooms stay
 * bounded at the 12-row render cap with "+N more", hostile titles render as
 * text, regex-metachar queries don't crash), and sustained use (20 open/close
 * cycles leave no accumulated window listeners).
 */
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockStore = vi.hoisted(() => ({ current: {} as any }));

vi.mock("convex/react", () => ({ useQuery: () => null, useMutation: () => () => Promise.resolve() }));
vi.mock("../src/app/store", () => ({ useStore: () => mockStore.current }));

import {
  CommandPalette,
  filterPaletteEntries,
  COMMAND_PALETTE_MAX_ITEMS,
  type PaletteAction,
} from "../src/ui/CommandPalette";

type ArtifactLite = { id: string; kind: "sheet" | "note" | "wall"; title: string };

const roomArtifacts: ArtifactLite[] = [
  { id: "a1", kind: "sheet", title: "Company research" },
  { id: "a2", kind: "sheet", title: "Q3 variance" },
  { id: "a3", kind: "note", title: "Diligence memo" },
  { id: "a4", kind: "wall", title: "Risk wall" },
];

function makeActions() {
  const spies = {
    focus: vi.fn(),
    autoAllow: vi.fn(),
    invite: vi.fn(),
    trace: vi.fn(),
    graph: vi.fn(),
    chat: vi.fn(),
  };
  // Mirrors the RoomShell wiring: the six core shell actions.
  const list: PaletteAction[] = [
    { id: "toggle-focus-mode", label: "Toggle focus mode", hint: "off", run: spies.focus },
    { id: "toggle-auto-allow", label: "Toggle auto-allow", hint: "review", run: spies.autoAllow },
    { id: "copy-invite", label: "Copy invite code", hint: "QX4T", run: spies.invite },
    { id: "open-trace", label: "Open Trace", hint: "tab", run: spies.trace },
    { id: "open-graph", label: "Open Graph", hint: "tab", run: spies.graph },
    { id: "jump-chat", label: "Jump to chat composer", hint: "/", run: spies.chat },
  ];
  return { spies, list };
}

function renderPalette(arts: ArtifactLite[] = roomArtifacts) {
  mockStore.current = { listArtifacts: () => arts };
  const { spies, list } = makeActions();
  const onOpenArtifact = vi.fn();
  const utils = render(<CommandPalette roomId="room-1" actions={list} onOpenArtifact={onOpenArtifact} />);
  return { spies, onOpenArtifact, ...utils };
}

const pressCmdK = (opts: { meta?: boolean } = {}) =>
  fireEvent.keyDown(window, opts.meta ? { key: "k", metaKey: true } : { key: "k", ctrlKey: true });

const paletteInput = () => screen.getByTestId("command-palette-input") as HTMLInputElement;
const items = () => screen.getAllByTestId("command-palette-item");
const selectedLabel = () => items().find((el) => el.getAttribute("data-selected") === "true")?.textContent;

afterEach(() => cleanup());

describe("CommandPalette — Dana summons and drives it from the keyboard", () => {
  it("stays closed by default, opens on Ctrl+K and Cmd+K with combobox semantics, focus in the filter input", () => {
    renderPalette();
    expect(screen.queryByTestId("command-palette")).toBeNull();

    pressCmdK();
    const dialog = screen.getByTestId("command-palette");
    expect(dialog.getAttribute("role")).toBe("dialog");
    const input = paletteInput();
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-controls")).toBe("r-cmdk-list");
    expect(input.getAttribute("aria-activedescendant")).toBe("r-cmdk-opt-0");
    expect(screen.getByRole("listbox")).toBeTruthy();
    // Empty query: core actions first, then the room's artifacts as "Open <title>".
    const labels = items().map((el) => el.textContent ?? "");
    expect(labels[0]).toContain("Toggle focus mode");
    expect(labels.some((l) => l.includes("Open Company research"))).toBe(true);
    // First row is pre-selected so ↵ works with zero navigation.
    expect(items()[0].getAttribute("aria-selected")).toBe("true");

    // Ctrl+K toggles it back closed; Cmd+K (mac) opens it again.
    pressCmdK();
    expect(screen.queryByTestId("command-palette")).toBeNull();
    pressCmdK({ meta: true });
    expect(screen.getByTestId("command-palette")).toBeTruthy();
  });

  it("does NOT open while Dana is typing in an input (mid-sentence ⌘K is not stolen), but opens once she blurs", () => {
    mockStore.current = { listArtifacts: () => roomArtifacts };
    const { list } = makeActions();
    render(
      <div>
        <input data-testid="outside-input" defaultValue="drafting a memo line" />
        <CommandPalette roomId="room-1" actions={list} onOpenArtifact={vi.fn()} />
      </div>,
    );
    const outside = screen.getByTestId("outside-input") as HTMLInputElement;
    outside.focus();
    pressCmdK();
    expect(screen.queryByTestId("command-palette")).toBeNull();

    outside.blur();
    pressCmdK();
    expect(screen.getByTestId("command-palette")).toBeTruthy();
  });

  it("filters artifacts by case-insensitive substring and shows an honest empty state on zero matches", () => {
    renderPalette();
    pressCmdK();
    fireEvent.change(paletteInput(), { target: { value: "RESEarch" } });
    const labels = items().map((el) => el.textContent ?? "");
    expect(labels).toHaveLength(1);
    expect(labels[0]).toContain("Open Company research");
    expect(labels.some((l) => l.includes("Toggle focus mode"))).toBe(false);

    // Multi-token: every token must hit ("open trace" finds the Trace command).
    fireEvent.change(paletteInput(), { target: { value: "open trace" } });
    expect(items().map((el) => el.textContent ?? "")[0]).toContain("Open Trace");

    // Zero matches: empty state, and Enter is a safe no-op (palette stays up).
    fireEvent.change(paletteInput(), { target: { value: "zzz-nothing" } });
    expect(screen.queryAllByTestId("command-palette-item")).toHaveLength(0);
    expect(screen.getByTestId("command-palette-empty").textContent).toContain("zzz-nothing");
    fireEvent.keyDown(paletteInput(), { key: "Enter" });
    expect(screen.getByTestId("command-palette")).toBeTruthy();
  });

  it("Enter runs the selected core action exactly once and closes the palette", () => {
    const { spies } = renderPalette();
    pressCmdK();
    fireEvent.change(paletteInput(), { target: { value: "invite" } });
    fireEvent.keyDown(paletteInput(), { key: "Enter" });
    expect(spies.invite).toHaveBeenCalledTimes(1);
    expect(spies.focus).not.toHaveBeenCalled();
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });

  it("Enter on an artifact row opens that artifact via the RoomShell callback", () => {
    const { onOpenArtifact } = renderPalette();
    pressCmdK();
    fireEvent.change(paletteInput(), { target: { value: "variance" } });
    fireEvent.keyDown(paletteInput(), { key: "Enter" });
    expect(onOpenArtifact).toHaveBeenCalledTimes(1);
    expect(onOpenArtifact).toHaveBeenCalledWith("a2");
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });

  it("Esc closes and restores focus to the element Dana was on before ⌘K", () => {
    mockStore.current = { listArtifacts: () => roomArtifacts };
    const { list } = makeActions();
    render(
      <div>
        <button data-testid="prev-focus">auto-allow switch</button>
        <CommandPalette roomId="room-1" actions={list} onOpenArtifact={vi.fn()} />
      </div>,
    );
    const prev = screen.getByTestId("prev-focus");
    prev.focus();
    pressCmdK();
    expect(document.activeElement).toBe(paletteInput());
    fireEvent.keyDown(paletteInput(), { key: "Escape" });
    expect(screen.queryByTestId("command-palette")).toBeNull();
    expect(document.activeElement).toBe(prev);
  });

  it("j/k and arrows walk the selection (wrap at the ends); a typed query turns j back into a letter unless Ctrl is held", () => {
    renderPalette();
    pressCmdK();
    expect(selectedLabel()).toContain("Toggle focus mode");
    fireEvent.keyDown(paletteInput(), { key: "j" });
    expect(selectedLabel()).toContain("Toggle auto-allow");
    fireEvent.keyDown(paletteInput(), { key: "j" });
    expect(selectedLabel()).toContain("Copy invite code");
    fireEvent.keyDown(paletteInput(), { key: "k" });
    expect(selectedLabel()).toContain("Toggle auto-allow");
    // ArrowUp twice from index 1 wraps to the last row.
    fireEvent.keyDown(paletteInput(), { key: "ArrowUp" });
    fireEvent.keyDown(paletteInput(), { key: "ArrowUp" });
    expect(selectedLabel()).toContain("Open Risk wall");
    fireEvent.keyDown(paletteInput(), { key: "ArrowDown" });
    expect(selectedLabel()).toContain("Toggle focus mode");

    // With a live query, plain j is TEXT (filtering must win); Ctrl+j still navigates.
    fireEvent.change(paletteInput(), { target: { value: "o" } });
    const before = selectedLabel();
    fireEvent.keyDown(paletteInput(), { key: "j" });
    expect(selectedLabel()).toBe(before);
    fireEvent.keyDown(paletteInput(), { key: "j", ctrlKey: true });
    expect(selectedLabel()).not.toBe(before);
  });

  it("adversarial scale: a 200-artifact room renders at most 12 rows plus an accurate '+N more' line", () => {
    const many: ArtifactLite[] = Array.from({ length: 200 }, (_, i) => ({
      id: `bulk-${i}`,
      kind: "sheet",
      title: `Deal file ${String(i).padStart(3, "0")}`,
    }));
    renderPalette(many);
    pressCmdK();
    expect(items()).toHaveLength(COMMAND_PALETTE_MAX_ITEMS);
    // 200 artifacts + 6 core actions - 12 rendered = 194 hidden behind the bound.
    expect(screen.getByTestId("command-palette-more").textContent).toContain("+194 more");

    // Narrowing the query collapses the overflow and keeps selection in bounds.
    fireEvent.change(paletteInput(), { target: { value: "deal file 007" } });
    expect(items()).toHaveLength(1);
    expect(screen.queryByTestId("command-palette-more")).toBeNull();
    expect(items()[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(paletteInput(), { key: "Enter" });
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });

  it("adversarial inputs: hostile artifact titles render as inert text and regex-metachar queries don't crash the filter", () => {
    renderPalette([{ id: "x1", kind: "note", title: '<img src=x onerror=alert(1)> "pwn"' }]);
    pressCmdK();
    const hostile = items().find((el) => (el.textContent ?? "").includes("onerror"));
    expect(hostile).toBeTruthy();
    expect(hostile!.querySelector("img")).toBeNull();

    fireEvent.change(paletteInput(), { target: { value: "((( [a-z]+ \\" } });
    expect(screen.queryAllByTestId("command-palette-item")).toHaveLength(0);
    expect(screen.getByTestId("command-palette-empty")).toBeTruthy();
  });

  it("sustained use: 20 open/close cycles reuse one window listener and unmount removes everything it added", () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderPalette();
    for (let i = 0; i < 20; i++) {
      pressCmdK();
      fireEvent.keyDown(paletteInput(), { key: "Escape" });
    }
    expect(screen.queryByTestId("command-palette")).toBeNull();
    unmount();
    const addedKeydown = added.mock.calls.filter((c) => c[0] === "keydown").length;
    const removedKeydown = removed.mock.calls.filter((c) => c[0] === "keydown").length;
    expect(addedKeydown).toBeGreaterThan(0);
    expect(removedKeydown).toBe(addedKeydown);
    added.mockRestore();
    removed.mockRestore();
  });
});

describe("filterPaletteEntries — ranking contract", () => {
  const entries = [
    { label: "Open Company research" },
    { label: "Research assignments memo" },
    { label: "Toggle focus mode" },
  ];

  it("ranks earlier matches first (prefix beats mid-string) and preserves order on ties", () => {
    const hits = filterPaletteEntries(entries, "research").map((e) => e.label);
    expect(hits).toEqual(["Research assignments memo", "Open Company research"]);
    expect(filterPaletteEntries(entries, "")).toEqual(entries);
  });

  it("requires every token to match and never throws on oversized queries", () => {
    expect(filterPaletteEntries(entries, "open research").map((e) => e.label)).toEqual(["Open Company research"]);
    expect(filterPaletteEntries(entries, "open zebra")).toEqual([]);
    expect(() => filterPaletteEntries(entries, "x".repeat(10_000))).not.toThrow();
  });
});
