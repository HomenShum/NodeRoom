// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoryQuickDemo } from "../src/landing/StoryQuickDemo";
import { buildStoryAgentTurn } from "../src/landing/storyQuickDemoModel";

describe("StoryQuickDemo", () => {
  it("lets a visitor edit the spreadsheet and ask the local story agent", () => {
    render(<StoryQuickDemo />);

    fireEvent.change(screen.getByLabelText("Q3 revenue cell C2"), { target: { value: "13,250" } });
    fireEvent.change(screen.getByLabelText("Story agent prompt"), { target: { value: "Recompute the revenue variance" } });
    fireEvent.click(screen.getByTestId("story-agent-send"));

    expect(screen.getByTestId("story-variance-cell").textContent).toBe("3,250");
    expect(screen.getByText("Recompute the revenue variance")).toBeTruthy();
    expect(screen.getByText("Computed D2 = C2 - B2 = 3,250.")).toBeTruthy();
    expect(screen.getByText(/kept the human C2 edit/i)).toBeTruthy();
  });

  it("keeps the demo math deterministic for visual and README captures", () => {
    expect(buildStoryAgentTurn("check", "12,875").variance).toBe("2,875");
  });
});
