// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveRegion } from "../src/accessibility/liveRegion";

describe("accessibility helper primitives", () => {
  it("renders a polite live region for status-level agent updates", () => {
    render(<LiveRegion message="Agent plan ready for review" />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Agent plan ready for review");
  });
});
