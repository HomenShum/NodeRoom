import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "../src/ui/mobile/MobileTooltip";

describe("MobileTooltip", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reveals on keyboard focus without swallowing the trigger click", async () => {
    const onClick = vi.fn();
    render(
      <Tooltip label="Open actions">
        <button type="button" onClick={onClick}>
          Actions
        </button>
      </Tooltip>,
    );

    const trigger = screen.getByRole("button", { name: "Actions" });
    fireEvent.focus(trigger);
    await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe("Open actions"));

    fireEvent.click(trigger);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses a bounded long-press fallback and closes on touch release", () => {
    vi.useFakeTimers();
    render(
      <Tooltip label="Open actions">
        <button type="button">Actions</button>
      </Tooltip>,
    );

    const wrapper = screen.getByRole("button", { name: "Actions" }).parentElement;
    expect(wrapper).not.toBeNull();
    fireEvent.touchStart(wrapper!);

    act(() => vi.advanceTimersByTime(379));
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("tooltip").textContent).toBe("Open actions");

    fireEvent.touchEnd(wrapper!);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
