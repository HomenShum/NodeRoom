import { describe, expect, it } from "vitest";
import { normalizeInlinePipeTables, parseMarkdownBlocks } from "../src/ui/MarkdownBody";

describe("MarkdownBody parsing", () => {
  it("normalizes inline pipe tables into renderable table blocks", () => {
    const text = "Want me to write this? | Row | Q2 | Q3 | Variance % | |---|---:|---:|---:| | Revenue | $10,000 | $12,400 | +24% |";

    const normalized = normalizeInlinePipeTables(text);
    const blocks = parseMarkdownBlocks(text);

    expect(normalized).toContain("\n|---|---:|---:|---:|");
    expect(blocks.some((block) => block.kind === "table")).toBe(true);
  });
});

