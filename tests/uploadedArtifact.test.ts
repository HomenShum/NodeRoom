import { describe, expect, it } from "vitest";
import type { CellPayload } from "../src/engine/types";
import { artifactsFromFile } from "../src/app/uploadedArtifact";

function textFile(name: string, body: string, type = ""): File {
  const blob = new Blob([body], { type });
  return Object.assign(blob, { name, lastModified: Date.now() }) as File;
}

function payloadValue(value: unknown) {
  return (value as CellPayload).value;
}

describe("uploaded artifact parsing", () => {
  it("parses key-value text uploads as searchable sheet source artifacts", async () => {
    const [artifact] = await artifactsFromFile(textFile(
      "source_shares.txt",
      "shares_outstanding_millions: 60\n",
      "text/plain",
    ));

    expect(artifact.kind).toBe("sheet");
    expect(artifact.title).toBe("source_shares.txt");
    expect(artifact.meta?.dataframe?.parser).toBe("text:key-value");
    expect(artifact.meta?.dataframe?.columns.map((col) => col.label)).toEqual(["field", "value"]);
    expect(payloadValue(artifact.seed.find((cell) => cell.id === "u1__field")?.value)).toBe("shares_outstanding_millions");
    expect(payloadValue(artifact.seed.find((cell) => cell.id === "u1__value")?.value)).toBe(60);
    expect((artifact.seed.find((cell) => cell.id === "u1__value")?.value as CellPayload).evidence?.[0]).toMatchObject({
      kind: "upload",
      source: "source_shares.txt",
    });
    expect(artifact.sourceFile?.fileName).toBe("source_shares.txt");
  });

  it("keeps unstructured text uploads as notes with inline text", async () => {
    const [artifact] = await artifactsFromFile(textFile(
      "meeting-notes.txt",
      "Discuss the model assumptions before Friday.\nNo key-value table here.\n",
    ));

    expect(artifact.kind).toBe("note");
    expect(artifact.title).toBe("meeting-notes.txt");
    expect((artifact.seed[0]?.value as { text?: string }).text).toContain("Discuss the model assumptions");
  });
});
