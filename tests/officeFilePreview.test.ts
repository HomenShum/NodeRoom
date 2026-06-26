import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { isOfficePreviewDoc, officePreviewFromDataUrl } from "../src/ui/panels/officeFilePreview";

async function zipDataUrl(mimeType: string, files: Record<string, string>): Promise<{ dataUrl: string; size: number }> {
  const zip = new JSZip();
  for (const [path, value] of Object.entries(files)) zip.file(path, value);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return {
    dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    size: buffer.byteLength,
  };
}

describe("office file preview", () => {
  it("extracts document text from generated docx data URLs", async () => {
    const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const { dataUrl, size } = await zipDataUrl(mimeType, {
      "word/document.xml": `
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p><w:r><w:t>BTB memo</w:t></w:r></w:p>
            <w:p><w:r><w:t>Enterprise value: 2430000</w:t></w:r></w:p>
            <w:p><w:r><w:t>Share price: value=212.7; unit=$/share; note=Blended SOTP DCF result</w:t></w:r></w:p>
            <w:p><w:r><w:t>Sources &amp; methods are tagged.</w:t></w:r></w:p>
          </w:body>
        </w:document>
      `,
    });
    const doc = { upload: true as const, fileName: "btb-memo.docx", mimeType, size, dataUrl };

    expect(isOfficePreviewDoc(doc)).toBe(true);
    const preview = await officePreviewFromDataUrl(doc);

    expect(preview).toMatchObject({
      kind: "document",
      title: "btb-memo.docx",
      sections: [{
        title: "Document text",
        lines: [
          "BTB memo",
          "Enterprise value: 2430000",
          "Share price — Value: 212.7 · Unit: $/share · Note: Blended SOTP DCF result",
          "Sources & methods are tagged.",
        ],
      }],
    });
  });

  it("extracts slide text from generated pptx data URLs", async () => {
    const mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const { dataUrl, size } = await zipDataUrl(mimeType, {
      "ppt/slides/slide2.xml": `
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:t>DCF sensitivity</a:t>
          <a:t>Terminal growth case</a:t>
        </p:sld>
      `,
      "ppt/slides/slide1.xml": `
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:t>GOOGL sum of the parts</a:t>
          <a:t>Base valuation output</a:t>
        </p:sld>
      `,
    });
    const doc = { upload: true as const, fileName: "btb-deck.pptx", mimeType, size, dataUrl };

    expect(isOfficePreviewDoc(doc)).toBe(true);
    const preview = await officePreviewFromDataUrl(doc);

    expect(preview).toMatchObject({
      kind: "presentation",
      title: "btb-deck.pptx",
      sections: [
        { title: "Slide 1", lines: ["GOOGL sum of the parts", "Base valuation output"] },
        { title: "Slide 2", lines: ["DCF sensitivity", "Terminal growth case"] },
      ],
    });
  });

  it("does not treat PDFs as Office previews", () => {
    expect(isOfficePreviewDoc({
      upload: true,
      fileName: "memo.pdf",
      mimeType: "application/pdf",
      size: 10,
      dataUrl: "data:application/pdf;base64,JVBERg==",
    })).toBe(false);
  });
});
