import { describe, expect, it } from "vitest";
import {
  areaForPath,
  missingMentionedAreas,
  missingMentionedPaths,
  parseNameStatus,
  renderChangeList,
  revListArgsForRange,
} from "../scripts/commit-message";

describe("commit message accuracy helpers", () => {
  it("parses added, modified, deleted, and renamed files from git name-status output", () => {
    expect(parseNameStatus("M\tREADME.md\nA\tdocs/X.md\nD\told.txt\nR100\told.ts\tnew.ts\n")).toEqual([
      { status: "M", path: "README.md" },
      { status: "A", path: "docs/X.md" },
      { status: "D", path: "old.txt" },
      { status: "R100", oldPath: "old.ts", path: "new.ts" },
    ]);
  });

  it("renders a commit-body checklist with areas and reference file paths", () => {
    const out = renderChangeList([{ status: "M", path: "scripts/commit-message.ts" }]);
    expect(out).toContain("Changed areas:");
    expect(out).toContain("- scripts - ");
    expect(out).toContain("Changed files (reference):");
    expect(out).toContain("M scripts/commit-message.ts");
  });

  it("maps paths to changed areas", () => {
    expect(areaForPath(".github/workflows/ci.yml")).toBe(".github");
    expect(areaForPath("README.md")).toBe("README");
    expect(areaForPath("package-lock.json")).toBe("package");
    expect(areaForPath("src/app/store.tsx")).toBe("src");
  });

  it("accepts one area mention for many changed files in that area", () => {
    const changes = [
      { status: "M", path: "src/ui/Chat.tsx" },
      { status: "M", path: "src/app/store.tsx" },
      { status: "M", path: "tests/chat.test.ts" },
    ];
    expect(missingMentionedAreas("Update frontend UI and tests for NodeAgent", changes)).toEqual([]);
  });

  it("accepts CI aliases for workflow changes", () => {
    const changes = [{ status: "M", path: ".github/workflows/ci.yml" }];
    expect(missingMentionedAreas("ci: make commit accuracy useful", changes)).toEqual([]);
  });

  it("reports missing areas with paths for debugging", () => {
    const changes = [
      { status: "M", path: "docs/COMMIT_ACCURACY.md" },
      { status: "M", path: "package.json" },
    ];
    expect(missingMentionedAreas("Update docs", changes).map((area) => area.area)).toEqual(["package"]);
  });

  it("flags changed paths missing from the commit body", () => {
    const changes = [
      { status: "M", path: "docs/COMMIT_ACCURACY.md" },
      { status: "M", path: "package.json" },
    ];
    expect(missingMentionedPaths("Updated docs/COMMIT_ACCURACY.md", changes)).toEqual([{ status: "M", path: "package.json" }]);
  });

  it("walks pushed ranges on the branch first-parent path", () => {
    expect(revListArgsForRange("main..HEAD")).toEqual(["rev-list", "--reverse", "--first-parent", "main..HEAD"]);
  });
});
