// @vitest-environment edge-runtime
/**
 * Pure notebook block-engine scenarios — no backend, no editor.
 *
 * Persona: Maya (analyst) types diligence notes; the nodeagent parses a call
 * transcript into a structured report and appends it. These tests cover the
 * behavior angles the live lanes depend on: identity inheritance, merge
 * idempotency (re-run = merge, never duplicate), the claim-without-evidence
 * honesty downgrade, transform-retry exactly-once semantics, caps (BOUND),
 * and the HTML lane's attribution round-trip.
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_SECTION_TITLE,
  OUTLINE_CAPS,
  buildAgentRootNode,
  buildOutlineNodes,
  docContainsBlockId,
  ensureStableBlockIds,
  filterBuiltOutlineNodesForExistingTitles,
  findAgentRootHeading,
  headingTitlesFrom,
  normalizeTitle,
  outlineToHtml,
  readNotebookBlocks,
  type OutlineInput,
  type PmNodeJson,
} from "../src/notebook/blockOps";

function mintSequence(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const mayaDoc: PmNodeJson = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1, blockId: "blk-title" }, content: [{ type: "text", text: "CardioNova diligence" }] },
    { type: "paragraph", attrs: { blockId: "blk-runway" }, content: [{ type: "text", text: "Need to verify runway — founder said 14 months." }] },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          attrs: { blockId: "blk-li-1" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Series B lead unconfirmed" }] }],
        },
      ],
    },
    { type: "paragraph", content: [{ type: "text", text: "Legacy paragraph typed before block identity shipped." }] },
  ],
};

describe("readNotebookBlocks — identity + inheritance", () => {
  it("yields ordered leaves with stable ids, inherited listItem identity, and derived fallbacks", async () => {
    const blocks = await readNotebookBlocks(mayaDoc);
    expect(blocks.map((b) => b.text)).toEqual([
      "CardioNova diligence",
      "Need to verify runway — founder said 14 months.",
      "Series B lead unconfirmed",
      "Legacy paragraph typed before block identity shipped.",
    ]);
    expect(blocks[0].blockId).toBe("blk-title");
    expect(blocks[1].blockId).toBe("blk-runway");
    // The listItem's paragraph has no own id — it inherits the listItem's (a
    // bullet is addressed by its item, the same unit a human sees).
    expect(blocks[2].blockId).toBe("blk-li-1");
    expect(blocks[2].depth).toBeGreaterThan(0);
    // Pre-identity content degrades to the position-derived read-model id.
    expect(blocks[3].blockId).toBeNull();
    expect(blocks[3].derivedId).toMatch(/^b3-[0-9a-f]{12}$/);
    // textHash is the CAS token — deterministic for identical text.
    const again = await readNotebookBlocks(mayaDoc);
    expect(again[1].textHash).toBe(blocks[1].textHash);
  });
});

describe("buildOutlineNodes — the /parse port", () => {
  const outline: OutlineInput = {
    title: "Report: CardioNova call",
    sections: [
      { title: "Funding", bullets: [{ text: "Raised $32M Series B", claim: true, evidence: [{ kind: "source", label: "TechCrunch", url: "https://techcrunch.com/x" }] }] },
      { title: "Risks", bullets: [{ text: "Runway is 14 months", claim: true }, "Follow up with CFO"] },
    ],
    runId: "run-7",
  };

  it("mints every block id, attributes agent authorship in data, and downgrades unevidenced claims", () => {
    const built = buildOutlineNodes({ outline, mintId: mintSequence(), mode: "append" });
    expect(built.mintedBlockIds.length).toBeGreaterThan(0);
    const flat = JSON.stringify(built.nodes);
    expect(flat).toContain('"authorKind":"agent"');
    expect(flat).toContain('"runId":"run-7"');
    // Honesty gate: the evidenced claim stays clean; the unevidenced one is
    // flagged needs_review — never silently complete, never invented.
    expect(built.needsReviewCount).toBe(1);
    const paragraphs = JSON.stringify(built.nodes);
    expect(paragraphs).toContain('"status":"needs_review"');
    // The evidenced bullet's paragraph must NOT carry the flag.
    const funding = built.nodes.find((n) => JSON.stringify(n).includes("Raised $32M"));
    expect(JSON.stringify(funding)).not.toContain("needs_review");
  });

  it("merge mode dedupes by normalized section title — a re-run merges instead of duplicating", () => {
    const first = buildOutlineNodes({ outline, mintId: mintSequence("a"), mode: "merge", existingTitles: new Set() });
    expect(first.dedupedSections).toBe(0);
    const existingTitles = new Set([normalizeTitle(outline.title!), ...first.sectionTitles]);
    const rerun = buildOutlineNodes({
      outline,
      mintId: mintSequence("b"),
      mode: "merge",
      existingTitles,
    });
    expect(rerun.dedupedSections).toBe(2);
    expect(rerun.sectionTitles).toEqual([]);
    expect(rerun.nodes).toEqual([]);
    expect(rerun.mintedBlockIds).toEqual([]);
    // append mode ignores the dedupe set on purpose.
    const appended = buildOutlineNodes({ outline, mintId: mintSequence("c"), mode: "append", existingTitles });
    expect(appended.dedupedSections).toBe(0);
    expect(appended.nodes.length).toBeGreaterThan(0);
  });

  it("requires usable evidence, not just a placeholder object", () => {
    const built = buildOutlineNodes({
      outline: {
        sections: [{
          title: "Evidence",
          bullets: [
            { text: "This claim has an empty evidence shell", claim: true, evidence: [{}] },
            { text: "This claim points to a source id", claim: true, evidence: [{ sourceId: "src-1" }] },
          ],
        }],
      },
      mintId: mintSequence("e"),
      mode: "append",
    });
    expect(built.needsReviewCount).toBe(1);
    const flat = JSON.stringify(built.nodes);
    expect(flat).toContain("This claim has an empty evidence shell");
    expect(flat).toContain('"status":"needs_review"');
    const paragraphs: PmNodeJson[] = [];
    const walk = (node: PmNodeJson) => {
      if (node.type === "paragraph") paragraphs.push(node);
      for (const child of node.content ?? []) walk(child);
    };
    for (const node of built.nodes) walk(node);
    const sourceBacked = paragraphs.find((n) => JSON.stringify(n).includes("This claim points to a source id"));
    expect(JSON.stringify(sourceBacked)).not.toContain("needs_review");
  });

  it("post-build filtering removes duplicate report title and sections after a transform retry", () => {
    const built = buildOutlineNodes({ outline, mintId: mintSequence("r"), mode: "merge", existingTitles: new Set() });
    const filtered = filterBuiltOutlineNodesForExistingTitles({
      nodes: built.nodes,
      existingTitles: new Set([normalizeTitle(outline.title!), ...outline.sections.map((section) => normalizeTitle(section.title))]),
      mode: "merge",
    });
    expect(filtered.nodes).toEqual([]);
    expect(filtered.blockIds).toEqual([]);
    expect(filtered.dedupedSections).toBe(2);
    expect(filtered.skippedTitle).toBe(true);
  });

  it("enforces caps: oversized outlines are bounded, not unbounded splats", () => {
    const huge: OutlineInput = {
      sections: Array.from({ length: 40 }, (_, i) => ({
        title: `Section ${i}`,
        bullets: Array.from({ length: 300 }, (_, j) => `bullet ${j} ${"x".repeat(600)}`),
      })),
    };
    const built = buildOutlineNodes({ outline: huge, mintId: mintSequence(), mode: "append" });
    const headings = built.nodes.filter((n) => n.type === "heading");
    expect(headings.length).toBeLessThanOrEqual(OUTLINE_CAPS.maxSections);
    for (const list of built.nodes.filter((n) => n.type === "bulletList")) {
      expect((list.content ?? []).length).toBeLessThanOrEqual(OUTLINE_CAPS.maxBulletsPerSection);
    }
    const anyText = JSON.stringify(built.nodes.find((n) => n.type === "bulletList"));
    expect(anyText).not.toContain("x".repeat(OUTLINE_CAPS.maxTextChars + 10));
  });
});

describe("agent section + transform-retry idempotency", () => {
  it("mints stable ids into legacy docs exactly once", () => {
    const doc: PmNodeJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "legacy paragraph" }] },
        { type: "heading", attrs: { level: 2, blockId: "keep-me" }, content: [{ type: "text", text: "Existing" }] },
      ],
    };
    const migrated = ensureStableBlockIds(doc, mintSequence("legacy"));
    expect(migrated.changed).toBe(true);
    expect(migrated.docJson.content?.[0].attrs?.blockId).toBe("legacy-1");
    expect(migrated.docJson.content?.[1].attrs?.blockId).toBe("keep-me");
    const again = ensureStableBlockIds(migrated.docJson, mintSequence("again"));
    expect(again.changed).toBe(false);
    expect(again.docJson.content?.[0].attrs?.blockId).toBe("legacy-1");
  });

  it("finds the agent root by ATTRIBUTE, never by title text", () => {
    const doc: PmNodeJson = {
      type: "doc",
      content: [
        // A human typed a heading with the same TITLE — must not match.
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: AGENT_SECTION_TITLE }] },
        buildAgentRootNode(mintSequence("root")),
      ],
    };
    const hit = findAgentRootHeading(doc);
    expect(hit?.topLevelIndex).toBe(1);
    expect(hit?.blockId).toBe("root-1");
  });

  it("docContainsBlockId is the exactly-once sentinel for transform retries", () => {
    const mint = mintSequence("m");
    const built = buildOutlineNodes({ outline: { sections: [{ title: "S", bullets: ["b"] }] }, mintId: mint, mode: "append" });
    const docBefore: PmNodeJson = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] };
    expect(docContainsBlockId(docBefore, new Set(built.mintedBlockIds))).toBe(false);
    const docAfter: PmNodeJson = { type: "doc", content: [...(docBefore.content ?? []), ...built.nodes] };
    // A rebase-retry sees its own minted ids and becomes a no-op.
    expect(docContainsBlockId(docAfter, new Set(built.mintedBlockIds))).toBe(true);
  });

  it("headingTitlesFrom scopes dedupe to the agent section onward", () => {
    const doc: PmNodeJson = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Funding" }] }, // human heading before the section
        buildAgentRootNode(mintSequence("r")),
        { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Risks" }] },
      ],
    };
    const rootIdx = findAgentRootHeading(doc)!.topLevelIndex;
    const titles = headingTitlesFrom(doc, rootIdx);
    expect(titles.has(normalizeTitle("Risks"))).toBe(true);
    // The HUMAN "Funding" heading (before the agent section) must not suppress
    // an agent section of the same name.
    expect(titles.has(normalizeTitle("Funding"))).toBe(false);
  });
});

describe("outlineToHtml — the memory/review HTML lane", () => {
  it("preserves attribution + review flags and escapes member text", () => {
    const outline: OutlineInput = {
      title: "Report",
      sections: [{ title: "Risks <script>", bullets: [{ text: 'Burn "high" & rising', claim: true }] }],
    };
    const built = buildOutlineNodes({ outline, mintId: mintSequence(), mode: "append" });
    const html = outlineToHtml({ built, outline, includeAgentRoot: true });
    expect(html).toContain('data-agent-root="true"');
    expect(html).toContain('data-blockid="id-');
    expect(html).toContain('data-author-kind="agent"');
    expect(html).toContain('data-status="needs_review"');
    expect(html).toContain("Risks &lt;script&gt;");
    expect(html).toContain("Burn &quot;high&quot; &amp; rising");
    expect(html).not.toContain("<script>");
  });
});
