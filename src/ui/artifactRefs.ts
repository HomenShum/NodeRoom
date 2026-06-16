export type ArtifactRef = {
  id: string;
  title: string;
  kind: string;
};

export const ARTIFACT_REF_MIME = "application/x-noderoom-artifact";
export const ARTIFACT_REF_PREFIX = "References:";

const ARTIFACT_URI_PREFIX = "noderoom-artifact:";

export function encodeArtifactRef(ref: ArtifactRef): string {
  const title = ref.title.replace(/[\]\r\n]/g, " ").trim() || "Artifact";
  const kind = encodeURIComponent(ref.kind || "artifact");
  return `[${title}](${ARTIFACT_URI_PREFIX}${encodeURIComponent(ref.id)}?kind=${kind})`;
}

export function encodeArtifactRefLine(refs: ArtifactRef[]): string {
  return `${ARTIFACT_REF_PREFIX} ${refs.map(encodeArtifactRef).join(" ")}`;
}

export function parseArtifactRefMessage(text: string): { refs: ArtifactRef[]; body: string } {
  const [firstLine, ...rest] = text.split(/\r?\n/);
  if (!firstLine.startsWith(ARTIFACT_REF_PREFIX)) return { refs: [], body: text };
  const refText = firstLine.slice(ARTIFACT_REF_PREFIX.length).trim();
  if (!refText) return { refs: [], body: text };

  const refs: ArtifactRef[] = [];
  const pattern = /\[([^\]]+)\]\(noderoom-artifact:([^)]+)\)/g;
  let cursor = 0;
  for (const match of refText.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (refText.slice(cursor, index).trim()) return { refs: [], body: text };
    const [encodedId, query = ""] = match[2].split("?");
    try {
      const params = new URLSearchParams(query);
      refs.push({ title: match[1], id: decodeURIComponent(encodedId), kind: params.get("kind") || "artifact" });
    } catch {
      return { refs: [], body: text };
    }
    cursor = index + match[0].length;
  }

  if (refs.length === 0 || refText.slice(cursor).trim()) return { refs: [], body: text };
  return { refs, body: rest.join("\n").trimStart() };
}

export function displayArtifactRefMessage(text: string): string {
  const parsed = parseArtifactRefMessage(text);
  if (parsed.refs.length === 0) return text;
  return parsed.body || parsed.refs.map((ref) => ref.title).join(", ");
}

export function readDraggedArtifactRef(dataTransfer: DataTransfer): ArtifactRef | null {
  const raw = dataTransfer.getData(ARTIFACT_REF_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ArtifactRef>;
    if (typeof parsed.id !== "string" || typeof parsed.title !== "string" || typeof parsed.kind !== "string") return null;
    return { id: parsed.id, title: parsed.title, kind: parsed.kind };
  } catch {
    return null;
  }
}

export function hasDraggedArtifactRef(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(ARTIFACT_REF_MIME);
}
