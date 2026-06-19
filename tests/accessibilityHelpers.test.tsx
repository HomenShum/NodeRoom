// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { focusFirst, keepFocusWithin } from "../src/accessibility/focusManagement";
import { nextGridIndex } from "../src/accessibility/keyboardGrid";
import { LiveRegion } from "../src/accessibility/liveRegion";
import { motionClassName, motionDuration, prefersReducedMotion } from "../src/accessibility/reducedMotion";

describe("accessibility helper primitives", () => {
  it("renders a polite live region for status-level agent updates", () => {
    render(<LiveRegion message="Agent plan ready for review" />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Agent plan ready for review");
  });

  it("keeps spreadsheet-style keyboard movement stable", () => {
    expect(nextGridIndex({ key: "ArrowRight", index: 2, rowCount: 3, columnCount: 3 })).toBe(2);
    expect(nextGridIndex({ key: "ArrowRight", index: 2, rowCount: 3, columnCount: 3, wrapRows: true })).toBe(3);
    expect(nextGridIndex({ key: "ArrowDown", index: 1, rowCount: 3, columnCount: 3 })).toBe(4);
    expect(nextGridIndex({ key: "Home", index: 5, rowCount: 3, columnCount: 3 })).toBe(3);
  });

  it("traps focus inside modal or review surfaces", () => {
    document.body.innerHTML = `<div id="modal"><button id="a">A</button><button id="b">B</button></div>`;
    const modal = document.getElementById("modal") as HTMLElement;
    const first = document.getElementById("a") as HTMLButtonElement;
    const second = document.getElementById("b") as HTMLButtonElement;
    expect(focusFirst(modal)).toBe(true);
    expect(document.activeElement).toBe(first);

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    vi.spyOn(event, "preventDefault");
    expect(keepFocusWithin(modal, event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(second);
  });

  it("respects reduced-motion preferences for agent/status animations", () => {
    const reduceWindow = {
      matchMedia: (query: string) => ({ matches: query.includes("prefers-reduced-motion") }),
    } as Window;
    expect(prefersReducedMotion(reduceWindow)).toBe(true);
    expect(motionDuration(240, reduceWindow)).toBe(0);
    expect(motionClassName("pulse", "pulse-static", reduceWindow)).toBe("pulse pulse-static");
  });
});
