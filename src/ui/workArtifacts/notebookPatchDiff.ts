export type NotebookPatchDiffKind = "unchanged" | "removed" | "added";

export interface NotebookPatchDiffPart {
  kind: NotebookPatchDiffKind;
  text: string;
}

export interface NotebookPatchDiff {
  before: string;
  after: string;
  changed: boolean;
  addedText: string;
  removedText: string;
  parts: NotebookPatchDiffPart[];
}

export function notebookPatchValueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["value", "text", "content", "html"]) {
    if (key in record) {
      const nested = notebookPatchValueText(record[key]);
      if (nested) return nested;
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function words(value: string): string[] {
  return value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).slice(0, 160);
}

function compact(parts: NotebookPatchDiffPart[]): NotebookPatchDiffPart[] {
  const out: NotebookPatchDiffPart[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (last?.kind === part.kind) {
      last.text = `${last.text} ${part.text}`.trim();
    } else {
      out.push({ ...part });
    }
  }
  return out;
}

export function buildNotebookPatchDiff(beforeValue: string | undefined, afterValue: string | undefined): NotebookPatchDiff {
  const before = (beforeValue ?? "").replace(/\s+/g, " ").trim();
  const after = (afterValue ?? "").replace(/\s+/g, " ").trim();
  const a = words(before);
  const b = words(after);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const parts: NotebookPatchDiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      parts.push({ kind: "unchanged", text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      parts.push({ kind: "removed", text: a[i] });
      i += 1;
    } else {
      parts.push({ kind: "added", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    parts.push({ kind: "removed", text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    parts.push({ kind: "added", text: b[j] });
    j += 1;
  }

  const compacted = compact(parts);
  return {
    before,
    after,
    changed: before !== after,
    addedText: compacted.filter((part) => part.kind === "added").map((part) => part.text).join(" "),
    removedText: compacted.filter((part) => part.kind === "removed").map((part) => part.text).join(" "),
    parts: compacted,
  };
}
