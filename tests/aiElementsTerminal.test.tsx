import { render, screen } from "@testing-library/react";
import Ansi from "ansi-to-react";
import { describe, expect, it } from "vitest";
import { Terminal } from "../src/components/ai-elements/terminal";

describe("AI Elements Terminal dependency contract", () => {
  it("renders ANSI output and linkifies URLs with the patched parser", () => {
    const view = render(<Terminal output={"\u001b[32mPASS\u001b[0m"} />);

    expect(screen.getByText(/PASS/)).toBeTruthy();
    view.unmount();

    render(<Ansi linkify="fuzzy">https://noderoom.live/proof</Ansi>);
    expect(screen.getByRole("link", { name: "https://noderoom.live/proof" }).getAttribute("href"))
      .toBe("https://noderoom.live/proof");
  });
});
