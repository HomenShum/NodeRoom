// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobsSheet } from "../src/ui/mobile/MobileChat";
import { TraceOverlay } from "../src/ui/mobile/MobileOverlay";
import { Inbox } from "../src/ui/mobile/MobileScreens";
import { mobileVisibilityRoute } from "../src/ui/mobile/MobileApp";
import { FirstJoinOverlay } from "../src/ui/mobile/MobileGapSheets";
import { projectMobileJobs } from "../src/ui/mobile/mobileJobProjection";
import type { InboxItem, Job } from "../src/ui/mobile/mobileData";
import type { MobileCtx } from "../src/ui/mobile/mobileTypes";

afterEach(cleanup);

describe("mobile shell adapters", () => {
  it("renders live jobs and routes stop/retry through the existing job adapter", async () => {
    const running: Job = { id: "live-running", status: "running", title: "Live source check", sub: "running", cost: "", trace: "trace-live" };
    const failed: Job = { id: "live-failed", status: "failed", title: "Failed live run", sub: "provider unavailable", cost: "", trace: "trace-failed" };
    const jobAct = vi.fn(async () => ({ ok: true }));
    const ctx = {
      jobs: { running: [running], queued: [], attention: [failed], completed: [] },
      jobAct,
      openTrace: vi.fn(),
      closeSheet: vi.fn(),
      toast: vi.fn(),
    } as unknown as MobileCtx;

    render(<JobsSheet ctx={ctx} />);
    expect(screen.getByText("Live source check")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.queryByText("Research CardioNova funding signal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Stop job" }));
    await waitFor(() => expect(jobAct).toHaveBeenCalledWith("live-running", "cancel"));
    fireEvent.click(screen.getByRole("button", { name: "Retry job" }));
    await waitFor(() => expect(jobAct).toHaveBeenCalledWith("live-failed", "retry"));
  });

  it("preserves canonical job states instead of folding failures into completed or blocked work into queued", () => {
    const project = (status: string) => projectMobileJobs({ id: `job-${status}`, status, modelPolicy: "openrouter/free-auto" });

    expect(project("queued").queued[0]?.status).toBe("queued");
    expect(project("running").running[0]?.status).toBe("running");
    expect(project("retrying").running[0]?.status).toBe("retrying");
    for (const status of ["paused", "blocked", "failed", "cancelled", "mystery"]) {
      expect(project(status).attention[0]?.status).toBe(status === "mystery" ? "unknown" : status);
    }
    expect(project("completed").completed[0]?.status).toBe("completed");
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

  it("shows a fresh phone user the live grant and conservative hold before work", () => {
    render(<FirstJoinOverlay
      people={1}
      agents={1}
      credits={{ availableCredits: 20, availableUsd: 5, reservedCredits: 0, requiredCredits: 8, paused: false }}
      onDismiss={vi.fn()}
    />);

    expect(screen.getByTestId("mobile-firstjoin-credits").textContent).toContain("20.0 credits ($5.00) available");
    expect(screen.getByTestId("mobile-firstjoin-credits").textContent).toContain("8.0 credits may be held");
  });
});
