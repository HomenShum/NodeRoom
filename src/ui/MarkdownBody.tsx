import { Fragment, type HTMLAttributes, type ReactNode } from "react";

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; language: string; code: string }
  | { kind: "table"; headers: string[]; align: Array<"left" | "center" | "right">; rows: string[][] };

type MarkdownBodyProps = HTMLAttributes<HTMLDivElement> & {
  text: string;
  cursor?: ReactNode;
};

export function MarkdownBody({ text, cursor, className = "text", children, ...props }: MarkdownBodyProps) {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div className={`${className} r-md`} {...props}>
      {blocks.map((block, index) => renderBlock(block, `b${index}`))}
      {cursor}
      {children}
    </div>
  );
}

export function parseMarkdownBlocks(markdown: string): Block[] {
  const lines = normalizeInlinePipeTables(markdown).replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index++;
      continue;
    }

    const fence = line.match(/^\s*```([A-Za-z0-9_-]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index++;
      }
      if (index < lines.length) index++;
      blocks.push({ kind: "code", language: fence[1] ?? "", code: code.join("\n") });
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index] ?? "");
      const align = splitTableRow(lines[index + 1] ?? "").map(tableAlign);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isPipeRow(lines[index] ?? "")) {
        rows.push(normalizeCells(splitTableRow(lines[index] ?? ""), headers.length));
        index++;
      }
      blocks.push({ kind: "table", headers, align: normalizeAlign(align, headers.length), rows });
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      index++;
      continue;
    }

    const list = line.match(/^\s{0,3}(([-*+])|(\d+[.)]))\s+(.+)$/);
    if (list) {
      const ordered = !!list[3];
      const items: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^\s{0,3}(([-*+])|(\d+[.)]))\s+(.+)$/);
        if (!item || !!item[3] !== ordered) break;
        items.push(item[4].trim());
        index++;
      }
      blocks.push({ kind: ordered ? "ol" : "ul", items });
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index] ?? "")) {
        quote.push((lines[index] ?? "").replace(/^\s{0,3}>\s?/, ""));
        index++;
      }
      blocks.push({ kind: "quote", text: quote.join("\n") });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length
      && (lines[index] ?? "").trim()
      && !isTableStart(lines, index)
      && !startsNonParagraphBlock(lines[index] ?? "")
    ) {
      paragraph.push(lines[index] ?? "");
      index++;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }

  return blocks;
}

export function normalizeInlinePipeTables(markdown: string): string {
  return markdown
    .replace(/([^\n])\s+(\|[^|\n]+(?:\|[^|\n]+){1,}\|)\s+(?=\|(?:\s*:?-{3,}:?\s*\|){2,})/g, "$1\n\n$2\n")
    .replace(/(\|(?:\s*:?-{3,}:?\s*\|){2,})\s+(?=\|[^|\n]+(?:\|[^|\n]+){1,}\|)/g, "$1\n")
    .replace(/(\|[^|\n]+(?:\|[^|\n]+){1,}\|)\s+(?=\|[^|\n]+(?:\|[^|\n]+){1,}\|)/g, "$1\n");
}

function renderBlock(block: Block, key: string): ReactNode {
  if (block.kind === "heading") {
    const Tag = (`h${block.level}` as const);
    return <Tag key={key}>{renderInline(block.text, `${key}-h`)}</Tag>;
  }
  if (block.kind === "ul") {
    return (
      <ul key={key}>
        {block.items.map((item, index) => <li key={`${key}-${index}`}>{renderInline(item, `${key}-li${index}`)}</li>)}
      </ul>
    );
  }
  if (block.kind === "ol") {
    return (
      <ol key={key}>
        {block.items.map((item, index) => <li key={`${key}-${index}`}>{renderInline(item, `${key}-li${index}`)}</li>)}
      </ol>
    );
  }
  if (block.kind === "quote") {
    return <blockquote key={key}>{renderParagraphLines(block.text.split("\n"), `${key}-q`)}</blockquote>;
  }
  if (block.kind === "code") {
    return <pre key={key}><code>{block.code}</code></pre>;
  }
  if (block.kind === "table") {
    return (
      <div className="r-md-table-wrap" key={key}>
        <table>
          <thead>
            <tr>
              {block.headers.map((cell, index) => (
                <th key={`${key}-h${index}`} style={{ textAlign: block.align[index] }}>{renderInline(cell, `${key}-hc${index}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${key}-r${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${key}-r${rowIndex}c${cellIndex}`} style={{ textAlign: block.align[cellIndex] }}>{renderInline(cell, `${key}-c${rowIndex}-${cellIndex}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.kind === "paragraph") return <p key={key}>{renderParagraphLines(block.lines, `${key}-p`)}</p>;
  return null;
}

function renderParagraphLines(lines: string[], keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) nodes.push(<br key={`${keyPrefix}-br${lineIndex}`} />);
    nodes.push(...renderInline(line, `${keyPrefix}-${lineIndex}`));
  });
  return nodes;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;
  while (index < text.length) {
    const next = nextInlineToken(text, index);
    if (next > index) {
      nodes.push(text.slice(index, next));
      index = next;
      continue;
    }

    if (text.startsWith("**", index)) {
      const end = text.indexOf("**", index + 2);
      if (end > index + 2) {
        nodes.push(<strong key={`${keyPrefix}-s${index}`}>{renderInline(text.slice(index + 2, end), `${keyPrefix}-s${index}`)}</strong>);
        index = end + 2;
        continue;
      }
    }

    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end > index + 1) {
        nodes.push(<code key={`${keyPrefix}-c${index}`}>{text.slice(index + 1, end)}</code>);
        index = end + 1;
        continue;
      }
    }

    if (text[index] === "[") {
      const link = parseLink(text, index);
      if (link) {
        nodes.push(link.href
          ? <a key={`${keyPrefix}-a${index}`} href={link.href} target="_blank" rel="noreferrer">{renderInline(link.label, `${keyPrefix}-a${index}`)}</a>
          : <Fragment key={`${keyPrefix}-a${index}`}>{renderInline(link.label, `${keyPrefix}-a${index}`)}</Fragment>);
        index = link.end;
        continue;
      }
    }

    if (text[index] === "*") {
      const end = text.indexOf("*", index + 1);
      if (end > index + 1 && text[index + 1] !== "*") {
        nodes.push(<em key={`${keyPrefix}-e${index}`}>{renderInline(text.slice(index + 1, end), `${keyPrefix}-e${index}`)}</em>);
        index = end + 1;
        continue;
      }
    }

    nodes.push(text[index]);
    index++;
  }
  return nodes;
}

function nextInlineToken(text: string, start: number): number {
  const candidates = ["**", "`", "[", "*"]
    .map((token) => text.indexOf(token, start))
    .filter((position) => position >= 0);
  return candidates.length ? Math.min(...candidates) : text.length;
}

function parseLink(text: string, start: number): { label: string; href: string | null; end: number } | null {
  const labelEnd = text.indexOf("]", start + 1);
  if (labelEnd <= start + 1 || text[labelEnd + 1] !== "(") return null;
  const hrefEnd = text.indexOf(")", labelEnd + 2);
  if (hrefEnd <= labelEnd + 2) return null;
  const rawHref = text.slice(labelEnd + 2, hrefEnd).trim();
  return {
    label: text.slice(start + 1, labelEnd),
    href: safeHref(rawHref),
    end: hrefEnd + 1,
  };
}

function safeHref(href: string): string | null {
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (/^(#|\/(?!\/))/.test(href)) return href;
  return null;
}

function startsNonParagraphBlock(line: string): boolean {
  return /^\s*```/.test(line)
    || /^\s{0,3}#{1,3}\s+/.test(line)
    || /^\s{0,3}(([-*+])|(\d+[.)]))\s+/.test(line)
    || /^\s{0,3}>\s?/.test(line);
}

function isTableStart(lines: string[], index: number): boolean {
  return isPipeRow(lines[index] ?? "") && isSeparatorRow(lines[index + 1] ?? "");
}

function isPipeRow(line: string): boolean {
  return line.includes("|") && splitTableRow(line).length >= 2;
}

function isSeparatorRow(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(line: string): string[] {
  let normalized = line.trim();
  if (normalized.startsWith("|")) normalized = normalized.slice(1);
  if (normalized.endsWith("|")) normalized = normalized.slice(0, -1);
  return normalized.split("|").map((cell) => cell.trim());
}

function tableAlign(cell: string): "left" | "center" | "right" {
  const trimmed = cell.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.endsWith(":")) return "right";
  return "left";
}

function normalizeAlign(align: Array<"left" | "center" | "right">, length: number): Array<"left" | "center" | "right"> {
  return Array.from({ length }, (_, index) => align[index] ?? "left");
}

function normalizeCells(cells: string[], length: number): string[] {
  return Array.from({ length }, (_, index) => cells[index] ?? "");
}
