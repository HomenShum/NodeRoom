// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PANEL_LAYOUT_PREF_KEY,
  ResizeHandle,
  panelWidthBounds,
  persistPanelLayout,
  readPersistedPanelLayout,
  setPanelWidth,
  type PanelLayout,
} from "../src/ui/RoomShell";

const DEFAULT_LAYOUT: PanelLayout = { left: 232, stage: 1, right: 340 };

describe("RoomShell desktop panel layout", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => cleanup());

  it("persists and restores only the left and right panel widths", () => {
    persistPanelLayout({ left: 304, stage: 99, right: 448 });

    expect(JSON.parse(window.localStorage.getItem(PANEL_LAYOUT_PREF_KEY) ?? "null")).toEqual({
      left: 304,
      right: 448,
    });
    expect(readPersistedPanelLayout()).toEqual({ left: 304, stage: 1, right: 448 });
  });

  it("falls back safely for corrupt data and clamps out-of-range persisted widths", () => {
    window.localStorage.setItem(PANEL_LAYOUT_PREF_KEY, "not-json");
    expect(readPersistedPanelLayout()).toEqual(DEFAULT_LAYOUT);

    window.localStorage.setItem(PANEL_LAYOUT_PREF_KEY, JSON.stringify({ left: 999, right: -10 }));
    expect(readPersistedPanelLayout()).toEqual({ left: 380, stage: 1, right: 280 });

    expect(readPersistedPanelLayout({ getItem: () => { throw new Error("blocked"); } })).toEqual(DEFAULT_LAYOUT);
    expect(() => persistPanelLayout(DEFAULT_LAYOUT, { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });

  it("uses the same desktop stage-floor bounds for pointer and keyboard resizing", () => {
    expect(panelWidthBounds("left", DEFAULT_LAYOUT, 1440, false, false)).toEqual({ min: 176, max: 310 });
    expect(panelWidthBounds("right", DEFAULT_LAYOUT, 1440, false, false)).toEqual({ min: 280, max: 418 });

    expect(setPanelWidth(DEFAULT_LAYOUT, "left", 500, { min: 176, max: 310 })).toEqual({
      left: 310,
      stage: 1,
      right: 340,
    });
    expect(setPanelWidth(DEFAULT_LAYOUT, "right", 100, { min: 280, max: 418 })).toEqual({
      left: 232,
      stage: 1,
      right: 280,
    });
  });

  it("keeps the right-panel bound independent of the overlay binder on mid and compact layouts", () => {
    const wide = panelWidthBounds("right", DEFAULT_LAYOUT, 1440, false, false);
    const mid = panelWidthBounds("right", DEFAULT_LAYOUT, 1440, false, true);
    const compact = panelWidthBounds("right", DEFAULT_LAYOUT, 1440, true, false);

    expect(wide.max).toBe(418);
    expect(mid.max).toBe(560);
    expect(compact).toEqual(mid);
  });

  it("keeps a restored width inside its exposed ARIA range while only allowing it to shrink", () => {
    const restored = { left: 300, stage: 1, right: 400 };

    expect(panelWidthBounds("left", restored, 1440, false, false).max).toBe(300);
    expect(panelWidthBounds("right", restored, 1440, false, false).max).toBe(400);
  });

  it("exposes a keyboard-adjustable vertical separator with current width semantics", () => {
    const onResize = vi.fn();
    const onPointerDown = vi.fn();
    render(
      <ResizeHandle
        label="Resize files panel"
        value={232}
        min={176}
        max={310}
        onResize={onResize}
        onPointerDown={onPointerDown}
      />,
    );

    const separator = screen.getByRole("separator", { name: "Resize files panel" });
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.getAttribute("aria-valuemin")).toBe("176");
    expect(separator.getAttribute("aria-valuemax")).toBe("310");
    expect(separator.getAttribute("aria-valuenow")).toBe("232");
    expect(separator.getAttribute("aria-valuetext")).toBe("232 pixels");

    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    fireEvent.keyDown(separator, { key: "Home" });
    fireEvent.keyDown(separator, { key: "End" });
    fireEvent.keyDown(separator, { key: "Enter" });

    expect(onResize.mock.calls.map(([width]) => width)).toEqual([216, 248, 176, 310]);

    fireEvent(separator, new MouseEvent("pointerdown", { bubbles: true, clientX: 250 }));
    expect(onPointerDown).toHaveBeenCalledWith(250);
  });
});
