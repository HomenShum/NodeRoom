import { describe, expect, it } from "vitest";
import type { CellPayload } from "../src/engine/types";
import { artifactsFromFile, MAX_INLINE_PREVIEW_BYTES, MAX_RAW_UPLOAD_BYTES, parseUploadedFiles } from "../src/app/uploadedArtifact";

function textFile(name: string, body: string, type = ""): File {
  const blob = new Blob([body], { type });
  return Object.assign(blob, { name, lastModified: Date.now() }) as File;
}

function binaryFile(name: string, size: number, type = ""): File {
  const blob = new Blob([new Uint8Array(size)], { type });
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

  it("keeps common-size PDF filings storage-backed instead of inlining bytes into room elements", async () => {
    const [artifact] = await parseUploadedFiles([
      binaryFile("Google 10K - 2024.pdf", MAX_INLINE_PREVIEW_BYTES + 1, "application/pdf"),
    ]);

    const doc = artifact.seed[0]?.value as { fileName?: string; dataUrl?: string; text?: string; parse?: { lane?: string } };
    expect(artifact.kind).toBe("note");
    expect(doc.fileName).toBe("Google 10K - 2024.pdf");
    expect(doc.dataUrl).toBeUndefined();
    expect(doc.text).toBeUndefined();
    expect(doc.parse?.lane).toBe("document_layout");
    expect(artifact.sourceFile?.fileName).toBe("Google 10K - 2024.pdf");
  });

  it("keeps oversized document uploads as stored source artifacts without inline preview data", async () => {
    const [artifact] = await parseUploadedFiles([
      binaryFile("CAPRICOR THERAPEUTICS, INC._December 31, 2024 10K.pdf", MAX_INLINE_PREVIEW_BYTES + 1, "application/pdf"),
    ]);

    const doc = artifact.seed[0]?.value as { fileName?: string; dataUrl?: string; text?: string; parse?: { lane?: string } };
    expect(artifact.kind).toBe("note");
    expect(artifact.title).toContain("CAPRICOR THERAPEUTICS");
    expect(doc.fileName).toContain("10K.pdf");
    expect(doc.dataUrl).toBeUndefined();
    expect(doc.text).toBeUndefined();
    expect(doc.parse?.lane).toBe("document_layout");
    expect(artifact.sourceFile?.fileName).toContain("10K.pdf");
    expect(artifact.meta?.upload?.size).toBe(MAX_INLINE_PREVIEW_BYTES + 1);
  });

  it("rejects source files above the raw storage ceiling", async () => {
    const oversized = {
      name: "too-large.pdf",
      type: "application/pdf",
      size: MAX_RAW_UPLOAD_BYTES + 1,
      lastModified: Date.now(),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => "",
      slice: () => new Blob(),
      stream: () => new Blob().stream(),
    } as unknown as File;

    await expect(parseUploadedFiles([oversized])).rejects.toThrow("too-large.pdf is too large for room source upload");
  });
});
