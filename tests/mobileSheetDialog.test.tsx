import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MobileApp } from "../src/ui/mobile/MobileApp";

describe("MobileApp sheet dialogs", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("opens the room sheet as a modal and restores trigger focus after Escape", async () => {
    render(<MobileApp />);
    const trigger = screen.getByRole("button", { name: /Switch room, current room/i });

    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Rooms" });
    expect(dialog.getAttribute("data-open")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rooms" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
