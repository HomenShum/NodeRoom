// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobsSheet } from "../src/ui/mobile/MobileChat";
import { TraceOverlay } from "../src/ui/mobile/MobileOverlay";
import { Inbox } from "../src/ui/mobile/MobileScreens";
import { mobileVisibilityRoute } from "../src/ui/mobile/MobileApp";
import type { InboxItem, Job } from "../src/ui/mobile/mobileData";
import type { MobileCtx } from "../src/ui/mobile/mobileTypes";

afterEach(cleanup);

describe("mobile shell adapters", () => {
  it("renders live jobs and routes stop/retry through the existing job adapter", async () => {
    const running: Job = { id: "live-running", title: "Live source check", sub: "running", cost: "", trace: "trace-live" };
    const completed: Job = { id: "live-completed", title: "Completed live run", sub: "failed", cost: "", trace: "trace-completed" };
    const jobAct = vi.fn(async () => ({ ok: true }));
    const ctx = {
      jobs: { running: [running], queued: [], completed: [completed] },
      jobAct,
      openTrace: vi.fn(),
      closeSheet: vi.fn(),
      toast: vi.fn(),
    } as unknown as MobileCtx;

    render(<JobsSheet ctx={ctx} />);
    expect(screen.getByText("Live source check")).toBeTruthy();
    expect(screen.queryByText("Research CardioNova funding signal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Stop job" }));
    await waitFor(() => expect(jobAct).toHaveBeenCalledWith("live-running", "cancel"));
    fireEvent.click(screen.getByRole("button", { name: "Retry job" }));
    await waitFor(() => expect(jobAct).toHaveBeenCalledWith("live-completed", "retry"));
  });

  it("shows an honest live trace summary instead of an empty or sample overlay", () => {
    const ctx = {
      traceRows: [{ id: "trace-live", kind: "commit", text: "Committed live evidence at v44", time: "now" }],
      closeOverlay: vi.fn(),
      toast: vi.fn(),
    } as unknown as MobileCtx;

    render(<TraceOverlay id="trace-live" ctx={ctx} />);
    expect(screen.getByTestId("mobile-live-trace-fallback")).toBeTruthy();
    expect(screen.getByText("Committed live evidence at v44")).toBeTruthy();
    expect(screen.getByText(/No sample steps, costs, or writes are substituted/i)).toBeTruthy();
  });

  it("routes live Inbox approve and reject through the proposal adapter", async () => {
    const item: InboxItem = {
      id: "proposal-live",
      icon: "sparkles",
      tone: "accent",
      title: "Agent edit proposed",
      sub: "Cell runway - approve before it lands",
      status: "approve",
      statusTone: "warn",
      time: "now",
      kind: "plan",
      preview: "doc",
    };
    const resolveProposalById = vi.fn(async () => ({ ok: true }));
    const ctx = {
      isLive: true,
      inboxItems: [item],
      resolved: {},
      canApprove: true,
      resolveProposalById,
      openInbox: vi.fn(),
      toast: vi.fn(),
    } as unknown as MobileCtx;

    render(<Inbox ctx={ctx} />);
    expect(screen.queryByRole("button", { name: "Row view" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(resolveProposalById).toHaveBeenCalledWith("proposal-live", false));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(resolveProposalById).toHaveBeenCalledWith("proposal-live", true));
  });

  it("keeps privacy copy and delivery lane coupled", () => {
    expect(mobileVisibilityRoute("Private")).toEqual({ composerMode: "agent", agentLane: "private" });
    expect(mobileVisibilityRoute("Room")).toEqual({ composerMode: "agent", agentLane: "room" });
  });
});
