/**
 * Minimal, safe markdown: builds React elements only (never innerHTML), links
 * limited to http(s). Supports headings, paragraphs, lists, quotes, fenced code,
 * GFM pipe tables and [src:path#L1-L2] citation tokens.
 */
import type { ReactNode } from "react";

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[src:[^\]\n]+\])|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))|(\*[^*\s\n][^*\n]*\*)/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<span key={k} className="naw-cite" title="Citation">{tok.slice(5, -1)}</span>);
    else if (m[4]) {
      const split = tok.indexOf("](");
      out.push(
        <a key={k} href={tok.slice(split + 2, -1)} target="_blank" rel="noopener noreferrer">
          {tok.slice(1, split)}
        </a>,
      );
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "), `p${blocks.length}`)}</p>);
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*```(\S*)/.exec(line);
    if (fence) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={`c${blocks.length}`} className="naw-code" data-lang={fence[1] || undefined}><code>{body.join("\n")}</code></pre>);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      const k = `t${blocks.length}`;
      blocks.push(
        <div key={k} className="naw-table-wrap">
          <table className="naw-table">
            <thead><tr>{head.map((h, j) => <th key={j}>{inline(h, `${k}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, j) => <td key={j}>{inline(r[j] ?? "", `${k}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      const level = Math.min(heading[1].length + 2, 6);
      const k = `h${blocks.length}`;
      const content = inline(heading[2], k);
      blocks.push(level === 3 ? <h3 key={k}>{content}</h3> : level === 4 ? <h4 key={k}>{content}</h4> : level === 5 ? <h5 key={k}>{content}</h5> : <h6 key={k}>{content}</h6>);
      i++;
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
      const k = `l${blocks.length}`;
      const lis = items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>);
      blocks.push(ordered ? <ol key={k}>{lis}</ol> : <ul key={k}>{lis}</ul>);
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={`q${blocks.length}`}>{inline(quote.join(" "), `q${blocks.length}`)}</blockquote>);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      blocks.push(<hr key={`r${blocks.length}`} />);
      i++;
      continue;
    }
    if (!line.trim()) flushPara();
    else para.push(line.trim());
    i++;
  }
  flushPara();
  return <div className={className ? `naw-md ${className}` : "naw-md"}>{blocks}</div>;
}
