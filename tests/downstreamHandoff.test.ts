import { describe, expect, it } from "vitest";
import { buildDownstreamHandoffDraft, type DownstreamHandoffTarget } from "../src/ui/downstreamHandoff";

const artifacts = [
  { id: "a1", title: "Company research", kind: "sheet" as const, order: ["r1__company", "r1__summary"] },
  { id: "a2", title: "CardioNova runway chart", kind: "note" as const, order: ["doc"] },
];

describe("downstream handoff draft previews", () => {
  it("builds approval-gated drafts for external providers without implying a write", () => {
    const targets: DownstreamHandoffTarget[] = ["gmail", "notion", "slack", "linear", "linkedin"];

    for (const target of targets) {
      const draft = buildDownstreamHandoffDraft(target, { roomTitle: "Startup Banking Diligence War Room", artifacts });

      expect(draft.approvalRequired).toBe(true);
      expect(draft.sourceArtifactIds).toEqual(["a1", "a2"]);
      expect(draft.body).toContain("External write status: draft only");
      expect(draft.body).toContain("Company research");
      expect(draft.title.toLowerCase()).toContain(target === "linkedin" ? "linkedin" : target);
    }
  });

  it("renders CRM as a ready CSV export with source coverage", () => {
    const draft = buildDownstreamHandoffDraft("crm", { roomTitle: "Startup Banking Diligence War Room", artifacts });

    expect(draft.approvalRequired).toBe(false);
    expect(draft.title).toContain("CRM CSV");
    expect(draft.body).toContain("package_title,status,source_artifacts,next_action");
    expect(draft.body).toContain("Company research");
  });
});
