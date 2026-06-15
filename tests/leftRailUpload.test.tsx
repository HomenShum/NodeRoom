// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Actor } from "../src/engine/types";

// LR-1 (B3) / LR-3 (C4) / C2 regression: onUpload used to read-and-commit per file, so a single bad
// file (e.g. over the 5MB cap) committed the earlier files then threw — a half-populated binder with
// a swallowed reason. The fix parses ALL files before committing anything, so a bad file aborts the
// whole drop (no partial commit), names the offending file, and always clears the spinner.

const { uploadSpy } = vi.hoisted(() => ({ uploadSpy: vi.fn(async () => "art_x") }));

vi.mock("../src/app/store", () => ({
  useStore: () => ({
    listArtifacts: () => [],
    listMembers: () => [],
    listSessions: () => [],
    listProposals: () => [],
    listTraces: () => [],
    listMessages: () => [],
    awareness: () => ({ activeLocks: [] }),
    uploadArtifact: uploadSpy,
  }),
}));

import { LeftRail } from "../src/ui/LeftRail";

const me: Actor = { kind: "user", id: "u1", name: "Priya" };

function fileOf(name: string, type: string, bytes: number): File {
  const data: BlobPart = bytes > 8 ? new Uint8Array(bytes) : "hello";
  return new File([data], name, { type });
}

describe("LeftRail upload is all-or-nothing on a bad file (LR-1/LR-3/C2)", () => {
  beforeEach(() => uploadSpy.mockClear());

  it("an over-size 3rd file aborts the whole drop, names it, clears the spinner — no partial commit", async () => {
    const { container } = render(<LeftRail roomId="r1" me={me} artId="" onPick={() => {}} />);
    const input = container.querySelector("input.r-file-input") as HTMLInputElement;

    // Priya drags 3 files at once; the 3rd is over the 5MB spreadsheet cap.
    // valid images parse via the FileReader path; the 3rd is an over-size spreadsheet.
    const files = [
      fileOf("a.png", "image/png", 5),
      fileOf("b.png", "image/png", 5),
      fileOf("big.csv", "text/csv", 6_000_000),
    ];
    fireEvent.change(input, { target: { files } });

    // Honest error that NAMES the bad file and the reason (C2).
    await waitFor(() => expect(screen.getByRole("alert").textContent ?? "").toMatch(/big\.csv/));
    expect(screen.getByRole("alert").textContent ?? "").toMatch(/too large/i);

    // No partial commit — parse-all-first means the commit phase never ran (B3).
    expect(uploadSpy).not.toHaveBeenCalled();

    // The spinner cleared (C4 / BUSY_FINALLY) — the button is back to its idle label.
    expect(screen.getByText("Upload file")).toBeTruthy();
  });
});
