/**
 * PdfCitation — renders one PDF page (react-pdf/PDF.js) with the `.r-tracevu-box` highlight overlay
 * on the exact value the citation points at. The on-screen box is `{x,y,w,h}` 0..1 fractions of the
 * RENDERED page (top-left, y-down) — produced by the pdfBox normalization adapter from the parser's
 * raw box / PDF.js text item, already rotated/CropBox/origin-corrected, so the same % overlay that
 * works over a screenshot works here unchanged.
 *
 * The overlay is pinned to the rendered canvas: react-pdf lays out `<div class=react-pdf__Page><canvas/></div>`,
 * so a `position: relative; display: inline-block` wrapper sizes exactly to the canvas when the text/
 * annotation layers are off, and the absolute `%` boxes map 1:1 onto it. Verified visually (see the
 * acceptance test) — if react-pdf adds chrome we fall back to measuring the canvas via onRenderSuccess.
 */
import { useState, useCallback, type JSX } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { NormBox } from "../../nodeagent/capture/types";

// Vite-resolved worker URL — single pdfjs instance, no CDN fetch.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

/**
 * Guard the react-pdf fetch sink: reject non-http(s) schemes and hostnames resolving to private /
 * loopback / link-local space (client-side SSRF against internal/metadata endpoints). Same-origin
 * dev paths (relative "/…" or localhost) are allowed; absolute URLs must be https.
 */
const PRIVATE_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1|fe80:)/i;

function isAllowedPdfUrl(raw: string): boolean {
  try {
    const u = new URL(raw, window.location.origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.protocol === "http:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return false; // prod: https only
    if (PRIVATE_HOST.test(u.hostname) && u.host !== window.location.host) return false; // dev same-host ok
    return true;
  } catch {
    return false;
  }
}

export function PdfCitation({ url, page, boxes, label, scale = 1.2, renderTextLayer = false }: {
  url: string;
  page: number;
  boxes: NormBox[];
  label?: string;
  scale?: number;
  renderTextLayer?: boolean;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const onLoadError = useCallback((e: Error) => setError(e.message), []);
  const pageBoxes = boxes.filter((b) => b.page == null || b.page === page);
  const safe = isAllowedPdfUrl(url);

  // TextLayer.css is only needed when the text layer renders (dev/e2e harness); load it on demand so
  // it never ships in the production bundle where renderTextLayer is always false.
  if (renderTextLayer) void import("react-pdf/dist/Page/TextLayer.css");

  if (!safe) {
    return (
      <span className="r-tracevu-shotframe r-tracevu-pdfframe" data-testid="pdf-citation">
        {label && <span className="r-tracevu-pdf-label">{label}</span>}
        <span className="r-tracevu-pdf-err">blocked: PDF source URL not allowed</span>
      </span>
    );
  }

  return (
    <span className="r-tracevu-shotframe r-tracevu-pdfframe" data-testid="pdf-citation">
      {label && <span className="r-tracevu-pdf-label">{label}</span>}
      <Document file={url} loading={<span className="r-tracevu-pdf-loading">loading…</span>} onLoadError={onLoadError} error={<span className="r-tracevu-pdf-err">{error ?? "failed to load PDF"}</span>}>
        <div className="r-tracevu-pdf-page-wrap">
          <Page pageNumber={page} scale={scale} renderTextLayer={renderTextLayer} renderAnnotationLayer={false} />
          {pageBoxes.map((b, i) => (
            <span key={i} className="r-tracevu-box" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} aria-hidden="true" />
          ))}
        </div>
      </Document>
    </span>
  );
}
