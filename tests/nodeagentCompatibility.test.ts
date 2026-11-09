import { describe, expect, it } from "vitest";
import { parseBulkCompanyIngest, splitBulkCompanyRecords } from "../src/nodeagent/skills/finance/bulkIngest";
import { prepareDownstreamDrafts } from "../src/nodeagent/skills/integration/downstreamPublish";

describe("nodeagent compatibility tree", () => {
  it("parses and batches bulk company ingest rows", () => {
    const companies = parseBulkCompanyIngest([
      "Acme, https://acme.test, T1, outbound",
      "Beta | https://beta.test | T2 | inbound",
      "Gamma\thttps://gamma.test\tT3\twatch",
    ].join("\n"));
    expect(companies).toHaveLength(3);
    expect(companies[0]?.company).toBe("Acme");
    expect(splitBulkCompanyRecords(companies, 2)).toHaveLength(2);
  });

  it("prepares downstream drafts without external side effects", () => {
    const drafts = prepareDownstreamDrafts({
      title: "Series B diligence",
      summary: "The room prepared an IC-ready draft.",
      bullets: ["2 sourced risks", "1 pending review proposal"],
      artifactUrl: "https://noderoom.test/artifacts/123",
    });
    expect(drafts.map((draft) => draft.target)).toEqual(["gmail", "notion", "slack", "linear", "linkedin"]);
    expect(drafts.every((draft) => draft.status === "prepared")).toBe(true);
    expect(drafts[0]?.body).toContain("Artifact: https://noderoom.test/artifacts/123");
  });
});
