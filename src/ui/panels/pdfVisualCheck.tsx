/**
 * Dev-only visual check harness: renders the real PdfCitation for every manifest case in one page
 * so a Playwright screenshot can confirm the `.r-tracevu-box` lands on the TARGET text. NOT shipped —
 * delete after the acceptance test is codified. Reads public/pdf-fixtures/manifest.json.
 */
import { type JSX } from "react";
import { createRoot } from "react-dom/client";
import { PdfCitation } from "./PdfCitation";
import "../../app/styles.css";
import manifest from "../../pdf-fixtures/manifest.json";

interface Case { name: string; desc: string; url: string; page: number; boxes: Array<{ x: number; y: number; w: number; h: number; page?: number }>; note: string; targetPhrase: string }

function CaseCard({ c }: { c: Case }): JSX.Element {
  return (
    <section className="r-pvc-case" data-testid="pvc-case" data-name={c.name} style={{ margin: "16px 0", padding: "12px", border: "1px solid #444", borderRadius: "8px" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: "13px", fontFamily: "JetBrains Mono, monospace" }}>{c.name}</h3>
      <p style={{ margin: "0 0 2px", fontSize: "11px", color: "#999" }}>{c.desc}</p>
      <p style={{ margin: "0 0 8px", fontSize: "10.5px", color: "#7a7a7a", fontFamily: "JetBrains Mono, monospace" }}>note: {c.note}</p>
      <PdfCitation url={c.url} page={c.page} boxes={c.boxes} label={`${c.name} · page ${c.page}`} renderTextLayer />
      <span className="r-pvc-target" data-testid="pvc-target" data-target={c.targetPhrase} style={{ display: "none" }} />
      <div style={{ marginTop: "6px", fontSize: "10px", color: "#888", fontFamily: "JetBrains Mono, monospace" }}>
        box: x={c.boxes[0].x.toFixed(3)} y={c.boxes[0].y.toFixed(3)} w={c.boxes[0].w.toFixed(3)} h={c.boxes[0].h.toFixed(3)} · target "{c.targetPhrase}"
      </div>
    </section>
  );
}

function Harness(): JSX.Element {
  return (
    <div className="r-pvc-root" style={{ padding: "16px", background: "#151413", color: "#e8e6e3", minHeight: "100vh", fontFamily: "Inter, sans-serif" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>PDF citation box — visual check</h2>
      <p style={{ fontSize: "11px", color: "#999", margin: "0 0 12px" }}>The blue box must sit on the TARGET / PAGE2 TARGET text in each case.</p>
      {(manifest as Case[]).map((c) => <CaseCard key={c.name} c={c} />)}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);

