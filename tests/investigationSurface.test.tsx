// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Actor, Artifact, CellPayload } from "../src/engine/types";
import {
  buildInvestigationLaunchIntentV1,
  buildInvestigationWorkspaceV1,
  finalizeInvestigationLaunchReceiptV1,
} from "../src/nodeagent/investigation";
import { sealCellEvidence } from "../src/nodeagent/core/evidenceReceipt";

vi.mock("../src/app/store", () => ({
  useStore: () => {
    throw new Error("The pure report test must not access RoomStore.");
  },
}));

import { InvestigationReport } from "../src/ui/investigation/InvestigationReport";

const now = Date.parse("2026-07-28T12:00:00.000Z");
const agent: Actor = { kind: "agent", id: "agent-room", name: "Room NodeAgent", scope: "public" };

function sourced(
  value: string,
  url: string,
  verifiedAt = Date.parse("2026-07-27T12:00:00.000Z"),
): CellPayload {
  const evidence = sealCellEvidence({
    id: `${value}:source`,
    kind: "source" as const,
    label: "Source receipt",
    url,
    confidence: 0.9,
  }, {
    contentDigest: `sha256:${"b".repeat(64)}`,
    verifiedAt,
  });
  return {
    value,
    status: "complete",
    confidence: 0.9,
    evidence: [evidence],
  };
}

function artifact(verifiedAt?: number): Artifact {
  const values: Record<string, unknown> = {
    "row-1__company": "CardioNova",
    "row-1__website": "https://cardionova.example",
    "row-1__summary": sourced("Remote cardiac monitoring platform.", "https://cardionova.example/about", verifiedAt),
    "row-1__funding": sourced("$42M Series B", "https://news.example/funding", verifiedAt),
    "row-1__headcount": sourced("145 employees", "https://cardionova.example/team", verifiedAt),
    "row-1__recent_signal": sourced("Expanded into two hospital systems.", "https://news.example/hospitals", verifiedAt),
    "row-1__last_researched": "2026-07-20",
    "row-1__status": "pending",
  };
  const columnIds = ["company", "website", "summary", "funding", "headcount", "recent_signal", "last_researched", "status"];
  return {
    id: "research-sheet",
    roomId: "room-1",
    kind: "sheet",
    title: "Company research",
    version: 4,
    elements: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, {
      id,
      version: 1,
      value,
      updatedAt: now,
      updatedBy: agent,
    }])),
    order: Object.keys(values),
    updatedAt: now,
    meta: {
      dataframe: {
        columns: columnIds.map((id, order) => ({ id, label: id, order })),
        rowCount: 1,
        parser: "test",
      },
    },
  };
}

function evidencePendingArtifact(): Artifact {
  const next = artifact();
  for (const field of ["summary", "funding", "headcount", "recent_signal"]) {
    const elementId = `row-1__${field}`;
    const element = next.elements[elementId];
    const payload = element.value as CellPayload;
    next.elements[elementId] = { ...element, value: payload.value };
  }
  return next;
}

function workspace() {
  return buildInvestigationWorkspaceV1({
    roomId: "room-1",
    artifacts: [artifact()],
    traces: [],
    now,
  });
}

describe("Investigation report surface", () => {
  it("lets a diligence lead inspect contract-derived trust counts and exact master-detail relationships", () => {
    const current = workspace();
    render(<InvestigationReport workspace={current} mode="memory" />);
    const report = screen.getByTestId("investigation-report");

    expect(screen.getByTestId("analysis-dataset-version").textContent).toContain(current.dataset?.versionId);
    expect(screen.getByTestId("research-plan-status").textContent).toContain("Validated");
    const taskButtons = screen.getAllByTestId("analysis-task-run");
    expect(taskButtons).toHaveLength(5);
    expect(screen.getByTestId("research-pack").textContent).toContain("Evidence-bound claims");
    expect(screen.getByTestId("investigation-workspace-status").textContent).toBe("Plan ready · evidence supported");
    expect(screen.getByTestId("investigation-workspace-status").getAttribute("role")).toBe("status");
    expect(report.getAttribute("data-plan-state")).toBe("valid");
    expect(report.getAttribute("data-runtime-state")).toBe("idle");
    expect(report.getAttribute("data-evidence-state")).toBe("supported");
    expect(report.getAttribute("data-consent-state")).toBe("not_required");

    const sourceRefs = current.researchPack?.sourceRefs ?? current.dataset?.sourceRefs ?? [];
    const verifiedRefs = sourceRefs.filter((source) => source.verificationStatus === "verified");
    const supportedClaims = current.researchPack?.claims.filter((claim) => claim.status === "supported") ?? [];
    expect(screen.getByTestId("investigation-metric-collected-refs").querySelector("strong")?.textContent).toBe(String(sourceRefs.length));
    expect(screen.getByTestId("investigation-metric-verified-refs").querySelector("strong")?.textContent).toBe(String(verifiedRefs.length));
    expect(screen.getByTestId("investigation-metric-supported-claims").querySelector("strong")?.textContent).toBe(String(supportedClaims.length));

    const initiallySelected = taskButtons.find((button) => button.getAttribute("aria-pressed") === "true");
    expect(initiallySelected?.getAttribute("aria-controls")).toBe("nr-investigation-run-detail");
    expect(screen.getByTestId("analysis-task-detail").getAttribute("aria-labelledby")).toBe(initiallySelected?.id);
    fireEvent.click(taskButtons[1]);
    expect(taskButtons[1].getAttribute("aria-pressed")).toBe("true");
    expect(taskButtons[0].getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("analysis-task-detail").getAttribute("aria-labelledby")).toBe(taskButtons[1].id);

    const reportTab = screen.getByRole("tab", { name: "Report" });
    const caseTab = screen.getByRole("tab", { name: "Teaching case" });
    expect(reportTab.getAttribute("aria-selected")).toBe("true");
    expect(reportTab.getAttribute("aria-controls")).toBe("nr-investigation-report-panel");
    fireEvent.keyDown(reportTab, { key: "ArrowRight" });
    expect(caseTab.getAttribute("aria-selected")).toBe("true");
    expect(caseTab.getAttribute("aria-controls")).toBe("nr-investigation-case-panel");
    expect(document.activeElement).toBe(caseTab);

    expect(screen.getByTestId("teaching-case").textContent).toContain("CardioNova");
    expect(screen.getByText("Guided teaching case")).toBeTruthy();
    expect(screen.getByText("Decision prompt")).toBeTruthy();
    fireEvent.keyDown(caseTab, { key: "ArrowRight" });
    expect(reportTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(reportTab);
    fireEvent.keyDown(reportTab, { key: "ArrowLeft" });
    expect(caseTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(caseTab);
    fireEvent.keyDown(caseTab, { key: "Home" });
    expect(reportTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("research-pack")).toBeTruthy();

    const sourceCaption = screen.getByTestId("investigation-source-caption");
    expect(sourceCaption.textContent).toContain("External links open in a new tab");
    const externalLink = screen.getAllByRole("link")[0];
    expect(externalLink.getAttribute("target")).toBe("_blank");
    expect(externalLink.getAttribute("aria-label")).toContain("opens in a new tab");
  });

  it("keeps the consent blocker visible and programmatically bound until a live-source run is approved", () => {
    const runResearch = vi.fn();
    const current = workspace();
    const view = render(
      <InvestigationReport
        workspace={current}
        mode="convex"
        externalApproved={false}
        onRunResearch={runResearch}
      />,
    );

    const runButton = screen.getByTestId("investigation-run-research") as HTMLButtonElement;
    expect(runButton.disabled).toBe(true);
    expect(screen.getByTestId("investigation-report").getAttribute("data-consent-state")).toBe("required");
    const consentReason = screen.getByTestId("investigation-run-consent-reason");
    expect(consentReason.textContent).toContain("approve public-source retrieval");
    expect(runButton.getAttribute("aria-describedby")).toBe(consentReason.id);
    expect(runButton.getAttribute("title")).toBeNull();
    fireEvent.click(runButton);
    expect(runResearch).not.toHaveBeenCalled();

    view.rerender(
      <InvestigationReport
        workspace={current}
        mode="convex"
        externalApproved
        onRunResearch={runResearch}
      />,
    );
    expect((screen.getByTestId("investigation-run-research") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("investigation-report").getAttribute("data-consent-state")).toBe("approved");
    expect(screen.queryByTestId("investigation-run-consent-reason")).toBeNull();
    expect(screen.getByTestId("investigation-run-research").getAttribute("aria-describedby")).toBeNull();
    fireEvent.click(screen.getByTestId("investigation-run-research"));
    expect(runResearch).toHaveBeenCalledTimes(1);
    expect(runResearch).toHaveBeenCalledWith(expect.objectContaining({
      schema: "noderoom.investigation-launch-intent/v1",
      planId: current.plan?.planId,
      planDigest: current.plan?.planDigest,
      datasetId: current.dataset?.datasetId,
      datasetVersionId: current.dataset?.versionId,
      datasetContentHash: current.dataset?.contentHash,
      artifactId: current.dataset?.artifactId,
      artifactVersion: current.dataset?.version,
      consent: {
        publicSourceRetrieval: true,
        approvedAt: expect.any(Number),
      },
    }));
  });

  it("keeps an authorized waiting server job in intervention state and prevents a duplicate launch", () => {
    const runResearch = vi.fn();
    const initial = workspace();
    if (!initial.plan || !initial.dataset) throw new Error("expected a valid investigation workspace");
    const authorization = finalizeInvestigationLaunchReceiptV1(
      buildInvestigationLaunchIntentV1({
        plan: initial.plan,
        dataset: initial.dataset,
        approvedAt: now - 1_000,
      }),
      "host-1",
    );
    const waiting = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [artifact()],
      traces: [],
      now,
      runtime: {
        source: "durable_job",
        jobId: "job-waiting",
        status: "waiting_for_human",
        updatedAt: now,
        authorization,
      },
    });
    expect(waiting.validation.valid).toBe(true);
    expect(waiting.state).toBe("blocked");

    render(
      <InvestigationReport
        workspace={waiting}
        mode="convex"
        externalApproved
        onRunResearch={runResearch}
      />,
    );

    const report = screen.getByTestId("investigation-report");
    const status = screen.getByTestId("investigation-workspace-status");
    const runButton = screen.getByTestId("investigation-run-research") as HTMLButtonElement;
    expect(report.getAttribute("data-plan-state")).toBe("valid");
    expect(report.getAttribute("data-runtime-state")).toBe("intervention");
    expect(status.textContent).toBe("Research waiting for approval");
    expect(status.getAttribute("data-tone")).toBe("review");
    expect(runButton.disabled).toBe(true);
    expect(runButton.textContent).toContain("Research awaiting action");
    expect(runButton.getAttribute("aria-describedby")).toContain("nr-investigation-run-runtime-reason");
    expect(screen.getByTestId("investigation-run-runtime-reason").textContent).toContain("existing research job");
    fireEvent.click(runButton);
    expect(runResearch).not.toHaveBeenCalled();
  });

  it("tells an analyst that a valid plan still has pending evidence instead of declaring the workspace ready", () => {
    const pending = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [evidencePendingArtifact()],
      traces: [],
      now,
    });
    expect(pending.validation.valid).toBe(true);
    expect(pending.researchPack?.claims.some((claim) => claim.status === "needs_review")).toBe(true);

    render(<InvestigationReport workspace={pending} mode="memory" />);

    const status = screen.getByTestId("investigation-workspace-status");
    expect(status.textContent).toBe("Plan ready · evidence pending");
    expect(status.getAttribute("data-tone")).toBe("review");
    expect(screen.getByTestId("investigation-metric-collected-refs").querySelector("strong")?.textContent)
      .toBe(String(pending.researchPack?.sourceRefs.length ?? pending.dataset?.sourceRefs.length ?? 0));
    expect(screen.getByTestId("investigation-metric-verified-refs").querySelector("strong")?.textContent).toBe("0");
    expect(screen.getByTestId("investigation-metric-supported-claims").querySelector("strong")?.textContent).toBe("0");
    expect(screen.getByTestId("investigation-report").getAttribute("data-evidence-state")).toBe("pending_review");
  });

  it("keeps a completed run in review when its once-verified evidence has gone stale", () => {
    const stale = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [artifact(Date.parse("2026-06-01T12:00:00.000Z"))],
      traces: [],
      now,
    });
    expect(stale.researchPack?.claims.some((claim) => claim.status === "stale")).toBe(true);

    render(<InvestigationReport workspace={{ ...stale, state: "complete" }} mode="memory" />);

    const status = screen.getByTestId("investigation-workspace-status");
    expect(status.textContent).toBe("Run complete · review pending");
    expect(status.getAttribute("data-tone")).toBe("review");
    expect(status.textContent).not.toBe("Evidence complete");
  });

  it("shows fail-closed validation and runtime errors without invented progress", () => {
    const blocked = buildInvestigationWorkspaceV1({ roomId: "room-1", artifacts: [], traces: [], now });
    render(<InvestigationReport workspace={blocked} mode="memory" runtimeError="Provider unavailable." />);

    expect(screen.getByTestId("research-plan-status").textContent).toContain("Blocked");
    expect(screen.getByTestId("investigation-runtime-error").textContent).toContain("Provider unavailable.");
    expect(screen.queryAllByTestId("analysis-task-run")).toHaveLength(0);
    expect((screen.getByTestId("investigation-run-research") as HTMLButtonElement).disabled).toBe(true);
  });
});
