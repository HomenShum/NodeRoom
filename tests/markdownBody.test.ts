import { describe, expect, it } from "vitest";
import { compactGeneratedFileLists, normalizeInlinePipeTables, parseMarkdownBlocks } from "../src/ui/MarkdownBody";

describe("MarkdownBody parsing", () => {
  it("normalizes inline pipe tables into renderable table blocks", () => {
    const text = "Want me to write this? | Row | Q2 | Q3 | Variance % | |---|---:|---:|---:| | Revenue | $10,000 | $12,400 | +24% |";

    const normalized = normalizeInlinePipeTables(text);
    const blocks = parseMarkdownBlocks(text);

    expect(normalized).toContain("\n|---|---:|---:|---:|");
    expect(blocks.some((block) => block.kind === "table")).toBe(true);
  });

  it("compacts generated deliverable filename lists into readable artifact labels", () => {
    const text = "BTB task complete. Files created: btb-a31173e3-alphabet-inc.-googl-dcf-sum-of-the-parts-valuation.xlsx, btb-a31173e3-alphabet-inc.-googl-dcf-sum-of-the-parts-valuation.xlsm, btb-a31173e3-alphabet-inc.-googl-dcf-sum-of-the-parts-valuation.pptx, btb-a31173e3-alphabet-inc.-googl-dcf-sum-of-the-parts-valuation.docx, btb-a31173e3-alphabet-inc.-googl-dcf-sum-of-the-parts-valuation.pdf.";

    const compact = compactGeneratedFileLists(text);
    const blocks = parseMarkdownBlocks(compact);

    expect(compact).toContain("- Valuation model (`.xlsx`)");
    expect(compact).toContain("- Presentation deck (`.pptx`)");
    expect(compact).not.toContain("sum-of-the-parts-valuation.xlsx");
    expect(blocks.some((block) => block.kind === "ul")).toBe(true);
  });
});
