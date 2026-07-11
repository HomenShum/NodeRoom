import JSZip from "jszip";
import type { DeckSlidePlan, DeckStoryboard } from "./deckStoryboard";

export interface DeckPptxExport {
  exportVersion: 1;
  deckId: string;
  planHash: string;
  title: string;
  generatedAt: number;
  slideCount: number;
  needsReviewCount: number;
  integrityHash: string;
  fileName: string;
  bytes: Uint8Array;
}

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const ZIP_DATE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "deck";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clip(value: string, limit: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trim()}...`;
}

export function deckPptxFileName(title: string, integrityHash: string): string {
  return `${slug(title)}-deck-${integrityHash}.pptx`;
}

export function deckPptxMimeType(): string {
  return PPTX_MIME;
}

function paragraph(text: string, size = 1800, color = "F3F6FB", bold = false): string {
  return `<a:p><a:r><a:rPr lang="en-US" sz="${size}"${bold ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${escapeXml(text)}</a:t></a:r></a:p>`;
}

function textShape(id: number, name: string, x: number, y: number, w: number, h: number, paragraphs: string, fill?: string, line?: string): string {
  const fillXml = fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : "<a:noFill/>";
  const lineXml = line ? `<a:ln w="12700"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln>` : "<a:ln><a:noFill/></a:ln>";
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fillXml}${lineXml}</p:spPr>
    <p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="73152" rIns="91440" bIns="73152"/><a:lstStyle/>${paragraphs}</p:txBody>
  </p:sp>`;
}

function claimParagraphs(slide: DeckSlidePlan): string {
  const claims = slide.claims.slice(0, 5);
  if (claims.length === 0) return paragraph("No claims yet.", 1600, "AAB4C2");
  return claims.map((claim) => paragraph(`${claim.status.replace("_", " ")} - ${clip(claim.text, 132)}`, 1500, claim.status === "verified" ? "55D49A" : claim.status === "needs_review" ? "E59579" : "D7DEE9")).join("");
}

function gapParagraphs(slide: DeckSlidePlan): string {
  const gaps = slide.unresolvedGaps.slice(0, 4);
  if (gaps.length === 0) return paragraph("No unresolved gaps on this slide.", 1450, "8E98A7");
  return gaps.map((gap) => paragraph(`Review - ${clip(gap, 120)}`, 1450, "E59579")).join("");
}

function slideXml(slide: DeckSlidePlan, index: number): string {
  const statusColor = slide.status === "needs_review" ? "E59579" : "55D49A";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="08090B"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${textShape(2, "Slide number", 457200, 365760, 548640, 365760, paragraph(String(index + 1).padStart(2, "0"), 1550, "E59579", true), "241713", "5A3529")}
      ${textShape(3, "Status", 1021080, 365760, 2011680, 365760, paragraph(slide.status.replace("_", " ").toUpperCase(), 1180, statusColor, true))}
      ${textShape(4, "Title", 457200, 914400, 8138160, 731520, paragraph(clip(slide.title, 78), 3000, "F3F6FB", true))}
      ${textShape(5, "Purpose", 457200, 1645920, 8138160, 731520, paragraph(clip(slide.purpose, 160), 1650, "AAB4C2"))}
      ${textShape(6, "Claims", 457200, 2552700, 8138160, 1828800, claimParagraphs(slide), "101317", "252A32")}
      ${textShape(7, "Gaps", 457200, 4564380, 8138160, 914400, gapParagraphs(slide), "101317", "252A32")}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function slideRelXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;
}

function presentationXml(storyboard: DeckStoryboard): string {
  const slideIds = storyboard.slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${2 + index}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slideIds}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle/>
</p:presentation>`;
}

function presentationRelsXml(storyboard: DeckStoryboard): string {
  const slideRels = storyboard.slides.map((_, index) => `<Relationship Id="rId${2 + index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slideRels}
</Relationships>`;
}

function contentTypesXml(storyboard: DeckStoryboard): string {
  const slides = storyboard.slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slides}
</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const APP_PROPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>NodeRoom</Application>
  <PresentationFormat>On-screen Show (16:9)</PresentationFormat>
  <Slides>0</Slides>
</Properties>`;

function corePropsXml(storyboard: DeckStoryboard): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(storyboard.title)}</dc:title>
  <dc:creator>NodeRoom</dc:creator>
  <cp:lastModifiedBy>NodeRoom</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">1970-01-01T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">1970-01-01T00:00:00Z</dcterms:modified>
</cp:coreProperties>`;
}

const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>`;

const SLIDE_MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;

const SLIDE_LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="NodeRoom">
  <a:themeElements>
    <a:clrScheme name="NodeRoom"><a:dk1><a:srgbClr val="08090B"/></a:dk1><a:lt1><a:srgbClr val="F3F6FB"/></a:lt1><a:dk2><a:srgbClr val="101317"/></a:dk2><a:lt2><a:srgbClr val="D7DEE9"/></a:lt2><a:accent1><a:srgbClr val="E59579"/></a:accent1><a:accent2><a:srgbClr val="55D49A"/></a:accent2><a:accent3><a:srgbClr val="6AA9FF"/></a:accent3><a:accent4><a:srgbClr val="A78BFA"/></a:accent4><a:accent5><a:srgbClr val="FFD16A"/></a:accent5><a:accent6><a:srgbClr val="AAB4C2"/></a:accent6><a:hlink><a:srgbClr val="6AA9FF"/></a:hlink><a:folHlink><a:srgbClr val="A78BFA"/></a:folHlink></a:clrScheme>
    <a:fontScheme name="NodeRoom"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="NodeRoom"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements>
</a:theme>`;

function addFile(zip: JSZip, path: string, body: string): void {
  zip.file(path, body, { date: ZIP_DATE, createFolders: false });
}

export async function buildDeckPptxExport(storyboard: DeckStoryboard, generatedAt = 0): Promise<DeckPptxExport> {
  const needsReviewCount = storyboard.slides.reduce(
    (sum, slide) => sum + slide.unresolvedGaps.length + slide.claims.filter((claim) => claim.status !== "verified").length,
    0,
  );
  const hashBase = {
    deckId: storyboard.deckId,
    planHash: storyboard.planHash,
    title: storyboard.title,
    slides: storyboard.slides.map((slide) => ({
      id: slide.slideId,
      title: slide.title,
      purpose: slide.purpose,
      status: slide.status,
      claims: slide.claims.map((claim) => [claim.claimId, claim.text, claim.status, claim.evidenceId, claim.traceId, claim.proposalId]),
      gaps: slide.unresolvedGaps,
    })),
  };
  const integrityHash = stableHash(hashBase);
  const zip = new JSZip();

  addFile(zip, "[Content_Types].xml", contentTypesXml(storyboard));
  addFile(zip, "_rels/.rels", ROOT_RELS);
  addFile(zip, "docProps/core.xml", corePropsXml(storyboard));
  addFile(zip, "docProps/app.xml", APP_PROPS.replace("<Slides>0</Slides>", `<Slides>${storyboard.slides.length}</Slides>`));
  addFile(zip, "ppt/presentation.xml", presentationXml(storyboard));
  addFile(zip, "ppt/_rels/presentation.xml.rels", presentationRelsXml(storyboard));
  addFile(zip, "ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER);
  addFile(zip, "ppt/slideMasters/_rels/slideMaster1.xml.rels", SLIDE_MASTER_RELS);
  addFile(zip, "ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT);
  addFile(zip, "ppt/slideLayouts/_rels/slideLayout1.xml.rels", SLIDE_LAYOUT_RELS);
  addFile(zip, "ppt/theme/theme1.xml", THEME);
  storyboard.slides.forEach((slide, index) => {
    addFile(zip, `ppt/slides/slide${index + 1}.xml`, slideXml(slide, index));
    addFile(zip, `ppt/slides/_rels/slide${index + 1}.xml.rels`, slideRelXml());
  });

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: "UNIX",
    streamFiles: false,
  });

  return {
    exportVersion: 1,
    deckId: storyboard.deckId,
    planHash: storyboard.planHash,
    title: storyboard.title,
    generatedAt,
    slideCount: storyboard.slides.length,
    needsReviewCount,
    integrityHash,
    fileName: deckPptxFileName(storyboard.title, integrityHash),
    bytes,
  };
}
