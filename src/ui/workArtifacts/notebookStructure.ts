import type { Artifact, CellEvidence, CellPayload, Element, Proposal, TraceEvent } from "../../engine/types";
import type { WorkArtifactStatus } from "./workArtifactTypes";

export type NotebookBlockRole = "human" | "agent" | "unknown";
export type NotebookBlockKind = "heading" | "paragraph" | "list_item" | "quote" | "code" | "unknown";
export type NotebookBlockStatus = "draft" | "accepted" | "needs_review";

export interface NotebookBlockDigest {
  id: string;
  blockId?: string;
  elementId: string;
  index: number;
  kind: NotebookBlockKind;
  role: NotebookBlockRole;
  status: NotebookBlockStatus;
  depth: number;
  text: string;
  traceIds: string[];
  proposalIds: string[];
  sourceIds: string[];
}

export interface NotebookSectionDigest {
  id: string;
  title: string;
  startIndex: number;
  blockCount: number;
  agentBlockCount: number;
  needsReviewCount: number;
}

export interface NotebookArtifactStructure {
  artifactId: string;
  title: string;
  status: WorkArtifactStatus;
  summary: string;
  blockCount: number;
  sectionCount: number;
  agentBlockCount: number;
  humanBlockCount: number;
  needsReviewCount: number;
  citationCount: number;
  evidenceCount: number;
  sourceIds: string[];
  traceIds: string[];
  proposalIds: string[];
  blocks: NotebookBlockDigest[];
  sections: NotebookSectionDigest[];
}

type PmNodeJson = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: PmNodeJson[];
};

const LEAF_PM_TYPES = new Set(["paragraph", "heading", "codeBlock"]);
const CONTAINER_PM_TYPES = new Set(["listItem", "blockquote", "bulletList", "orderedList"]);
const HTML_BLOCK_RE = /<(h[1-6]|p|li|blockquote|pre)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const HREF_RE = /\bhref\s*=\s*["']([^"']+)["']/gi;
const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;
const MAX_NOTEBOOK_BLOCKS = 240;
const MAX_SOURCE_IDS = 80;

function isCellPayload(value: unknown): value is CellPayload {
  return typeof value === "object" && value !== null && ("status" in value || "evidence" in value || "confidence" in value || "error" in value);
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function orderedElements(artifact: Artifact): Element[] {
  const ids = (artifact.order.length ? artifact.order : Object.keys(artifact.elements)).filter((id) => !id.startsWith("notebook_kernel:"));
  const seen = new Set(ids);
  const extras = Object.keys(artifact.elements).filter((id) => !seen.has(id) && !id.startsWith("notebook_kernel:"));
  return [...ids, ...extras].map((id) => artifact.elements[id]).filter((element): element is Element => Boolean(element));
}

function sourceIdsFromEvidence(evidence: CellEvidence[] | undefined): string[] {
  return unique((evidence ?? []).map((item) => item.sourceArtifactId ?? item.sourceStorageId ?? item.providerFileId ?? item.url ?? item.source ?? item.id));
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "-")
    .replace(/&ndash;/g, "-")
    .replace(/&middot;/g, "·")
    .replace(/&hellip;/g, "...")
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, "\"")
    .replace(/&bull;/g, "•")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(html: string): string {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function attr(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i");
  const match = attrs.match(pattern);
  return match?.[1];
}

function pmAttr(node: PmNodeJson | undefined, name: string): string | undefined {
  const value = node?.attrs?.[name];
  return typeof value === "string" && value ? value : undefined;
}

function statusFromRaw(value: unknown): NotebookBlockStatus {
  const raw = typeof value === "string" ? value.toLowerCase() : "";
  if (raw === "needs_review" || raw === "gap" || raw === "failed") return "needs_review";
  if (raw === "accepted" || raw === "synced" || raw === "complete") return "accepted";
  return "draft";
}

function kindFromHtmlTag(tag: string): NotebookBlockKind {
  if (/^h[1-6]$/i.test(tag)) return "heading";
  if (tag === "li") return "list_item";
  if (tag === "blockquote") return "quote";
  if (tag === "pre") return "code";
  if (tag === "p") return "paragraph";
  return "unknown";
}

function kindFromPmType(type: string | undefined): NotebookBlockKind {
  if (type === "heading") return "heading";
  if (type === "listItem") return "list_item";
  if (type === "blockquote") return "quote";
  if (type === "codeBlock") return "code";
  if (type === "paragraph") return "paragraph";
  return "unknown";
}

function roleFromAttrs(authorKind?: string, runId?: string): NotebookBlockRole {
  if (authorKind === "agent" || runId) return "agent";
  if (authorKind === "user" || authorKind === "human") return "human";
  return "human";
}

function sourceIdsFromText(text: string): string[] {
  return unique(text.match(URL_RE) ?? []);
}

function sourceIdsFromHtml(attrs: string, body: string): string[] {
  const hrefs: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = HREF_RE.exec(attrs + body))) hrefs.push(match[1]);
  return unique([...hrefs, ...sourceIdsFromText(stripHtml(body))]).slice(0, MAX_SOURCE_IDS);
}

function looksLikePmDoc(value: unknown): value is PmNodeJson {
  return typeof value === "object" && value !== null && (value as PmNodeJson).type === "doc" && Array.isArray((value as PmNodeJson).content);
}

function inlinePmText(node: PmNodeJson): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(inlinePmText).join("");
}

function relatedTraceIds(traces: TraceEvent[], artifactId: string, elementId: string, blockId?: string): string[] {
  return traces
    .filter((trace) =>
      trace.refs?.artifactId === artifactId &&
      (!trace.refs?.elementId || trace.refs.elementId === elementId || trace.refs.elementId === blockId))
    .map((trace) => trace.id);
}

function relatedProposalIds(proposals: Proposal[], artifactId: string, elementId: string, blockId?: string): string[] {
  return proposals
    .filter((proposal) => proposal.artifactId === artifactId && (!proposal.op.elementId || proposal.op.elementId === elementId || proposal.op.elementId === blockId))
    .map((proposal) => proposal.id);
}

function makeBlock(args: {
  artifact: Artifact;
  element: Element;
  index: number;
  kind: NotebookBlockKind;
  text: string;
  depth?: number;
  blockId?: string;
  role?: NotebookBlockRole;
  status?: NotebookBlockStatus;
  sourceIds?: string[];
  traces: TraceEvent[];
  proposals: Proposal[];
}): NotebookBlockDigest | null {
  const text = decodeHtml(args.text).replace(/\s+/g, " ").trim();
  if (!text) return null;
  const blockId = args.blockId;
  const id = blockId || `${args.element.id}:${stableHash(`${args.index}:${text}`)}`;
  return {
    id,
    blockId,
    elementId: args.element.id,
    index: args.index,
    kind: args.kind,
    role: args.role ?? "human",
    status: args.status ?? "draft",
    depth: args.depth ?? 0,
    text,
    traceIds: relatedTraceIds(args.traces, args.artifact.id, args.element.id, blockId),
    proposalIds: relatedProposalIds(args.proposals, args.artifact.id, args.element.id, blockId),
    sourceIds: unique(args.sourceIds ?? []),
  };
}

function blocksFromPmDoc(args: {
  artifact: Artifact;
  element: Element;
  doc: PmNodeJson;
  startIndex: number;
  inheritedSources: string[];
  traces: TraceEvent[];
  proposals: Proposal[];
}): NotebookBlockDigest[] {
  const blocks: NotebookBlockDigest[] = [];
  const walk = (node: PmNodeJson, depth: number, inherited: { blockId?: string; authorKind?: string; runId?: string; status?: string }) => {
    if (args.startIndex + blocks.length >= MAX_NOTEBOOK_BLOCKS) return;
    const type = node.type ?? "";
    const own = {
      blockId: pmAttr(node, "blockId") ?? inherited.blockId,
      authorKind: pmAttr(node, "authorKind") ?? inherited.authorKind,
      runId: pmAttr(node, "runId") ?? inherited.runId,
      status: pmAttr(node, "status") ?? inherited.status,
    };
    if (LEAF_PM_TYPES.has(type)) {
      const block = makeBlock({
        artifact: args.artifact,
        element: args.element,
        index: args.startIndex + blocks.length,
        kind: kindFromPmType(type),
        text: inlinePmText(node),
        depth,
        blockId: own.blockId,
        role: roleFromAttrs(own.authorKind, own.runId),
        status: statusFromRaw(own.status),
        sourceIds: args.inheritedSources,
        traces: args.traces,
        proposals: args.proposals,
      });
      if (block) blocks.push(block);
      return;
    }
    const nextDepth = CONTAINER_PM_TYPES.has(type) ? depth + 1 : depth;
    const nextInherited = CONTAINER_PM_TYPES.has(type) ? own : inherited;
    for (const child of node.content ?? []) walk(child, nextDepth, nextInherited);
  };
  for (const child of args.doc.content ?? []) walk(child, 0, {});
  return blocks;
}

function blocksFromHtml(args: {
  artifact: Artifact;
  element: Element;
  html: string;
  startIndex: number;
  inheritedSources: string[];
  traces: TraceEvent[];
  proposals: Proposal[];
}): NotebookBlockDigest[] {
  const blocks: NotebookBlockDigest[] = [];
  let match: RegExpExecArray | null;
  while ((match = HTML_BLOCK_RE.exec(args.html)) && args.startIndex + blocks.length < MAX_NOTEBOOK_BLOCKS) {
    const [, tag, attrs, body] = match;
    const text = stripHtml(body);
    const blockId = attr(attrs, "data-blockid");
    const runId = attr(attrs, "data-run-id");
    const authorKind = attr(attrs, "data-author-kind");
    const block = makeBlock({
      artifact: args.artifact,
      element: args.element,
      index: args.startIndex + blocks.length,
      kind: kindFromHtmlTag(tag.toLowerCase()),
      text,
      blockId,
      role: roleFromAttrs(authorKind, runId),
      status: statusFromRaw(attr(attrs, "data-status")),
      sourceIds: unique([...args.inheritedSources, ...sourceIdsFromHtml(attrs, body)]),
      traces: args.traces,
      proposals: args.proposals,
    });
    if (block) blocks.push(block);
  }
  if (blocks.length === 0) {
    const text = stripHtml(args.html);
    const block = makeBlock({
      artifact: args.artifact,
      element: args.element,
      index: args.startIndex,
      kind: "paragraph",
      text,
      sourceIds: unique([...args.inheritedSources, ...sourceIdsFromText(text)]),
      traces: args.traces,
      proposals: args.proposals,
    });
    if (block) blocks.push(block);
  }
  return blocks;
}

function blocksFromElement(args: {
  artifact: Artifact;
  element: Element;
  startIndex: number;
  traces: TraceEvent[];
  proposals: Proposal[];
}): NotebookBlockDigest[] {
  const raw = isCellPayload(args.element.value) ? args.element.value.value : args.element.value;
  const inheritedSources = isCellPayload(args.element.value) ? sourceIdsFromEvidence(args.element.value.evidence) : [];
  if (looksLikePmDoc(raw)) {
    return blocksFromPmDoc({ ...args, doc: raw, inheritedSources });
  }
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text.startsWith("<")) return blocksFromHtml({ ...args, html: text, inheritedSources });
    const block = makeBlock({
      ...args,
      index: args.startIndex,
      kind: "paragraph",
      text,
      sourceIds: unique([...inheritedSources, ...sourceIdsFromText(text)]),
      status: isCellPayload(args.element.value) ? statusFromRaw(args.element.value.status) : "draft",
    });
    return block ? [block] : [];
  }
  if (typeof raw === "object" && raw !== null && "text" in raw && typeof raw.text === "string") {
    const maybe = raw as { text: string; status?: string; authorKind?: string; runId?: string; blockType?: string };
    const block = makeBlock({
      ...args,
      index: args.startIndex,
      kind: kindFromPmType(maybe.blockType) === "unknown" ? "paragraph" : kindFromPmType(maybe.blockType),
      text: maybe.text,
      role: roleFromAttrs(maybe.authorKind, maybe.runId),
      status: statusFromRaw(maybe.status ?? (isCellPayload(args.element.value) ? args.element.value.status : undefined)),
      sourceIds: unique([...inheritedSources, ...sourceIdsFromText(maybe.text)]),
    });
    return block ? [block] : [];
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    const block = makeBlock({
      ...args,
      index: args.startIndex,
      kind: "paragraph",
      text: String(raw),
      sourceIds: inheritedSources,
      status: isCellPayload(args.element.value) ? statusFromRaw(args.element.value.status) : "draft",
    });
    return block ? [block] : [];
  }
  return [];
}

function buildSections(blocks: NotebookBlockDigest[]): NotebookSectionDigest[] {
  const headings = blocks.filter((block) => block.kind === "heading");
  const anchors = headings.length ? headings : blocks.slice(0, 1);
  return anchors.map((heading, index) => {
    const next = anchors[index + 1]?.index ?? blocks.length;
    const sectionBlocks = blocks.filter((block) => block.index >= heading.index && block.index < next);
    return {
      id: heading.blockId ?? heading.id,
      title: heading.kind === "heading" ? heading.text : "Notebook body",
      startIndex: heading.index,
      blockCount: sectionBlocks.length,
      agentBlockCount: sectionBlocks.filter((block) => block.role === "agent").length,
      needsReviewCount: sectionBlocks.filter((block) => block.status === "needs_review").length,
    };
  });
}

export function buildNotebookArtifactStructure(
  artifact: Artifact,
  related: { traces?: TraceEvent[]; proposals?: Proposal[] } = {},
): NotebookArtifactStructure {
  const traces = related.traces ?? [];
  const proposals = related.proposals ?? [];
  const blocks: NotebookBlockDigest[] = [];
  for (const element of orderedElements(artifact)) {
    if (blocks.length >= MAX_NOTEBOOK_BLOCKS) break;
    blocks.push(...blocksFromElement({
      artifact,
      element,
      startIndex: blocks.length,
      traces,
      proposals,
    }).slice(0, MAX_NOTEBOOK_BLOCKS - blocks.length));
  }
  const sections = buildSections(blocks);
  const needsReviewCount = blocks.filter((block) => block.status === "needs_review" || /\b(needs[_\s-]?review|todo|tbd|unknown|gap|missing source|unsupported)\b/i.test(block.text)).length;
  const agentBlockCount = blocks.filter((block) => block.role === "agent").length;
  const sourceIds = unique(blocks.flatMap((block) => block.sourceIds)).slice(0, MAX_SOURCE_IDS);
  const citationCount = sourceIds.filter((sourceId) => /^https?:\/\//i.test(sourceId)).length;
  const traceIds = unique([
    ...traces.filter((trace) => trace.refs?.artifactId === artifact.id).map((trace) => trace.id),
    ...blocks.flatMap((block) => block.traceIds),
  ]);
  const proposalIds = unique([
    ...proposals.filter((proposal) => proposal.artifactId === artifact.id).map((proposal) => proposal.id),
    ...blocks.flatMap((block) => block.proposalIds),
  ]);
  const evidenceCount = sourceIds.length;
  const status: WorkArtifactStatus =
    blocks.length === 0 ? "empty" : needsReviewCount > 0 || proposalIds.length > 0 ? "needs_review" : "ready";
  const parts = [`${blocks.length} block${blocks.length === 1 ? "" : "s"}`];
  if (sections.length > 0) parts.push(`${sections.length} section${sections.length === 1 ? "" : "s"}`);
  if (agentBlockCount > 0) parts.push(`${agentBlockCount} agent`);
  if (evidenceCount > 0) parts.push(`${evidenceCount} sources`);
  if (needsReviewCount > 0) parts.push(`${needsReviewCount} review`);

  return {
    artifactId: artifact.id,
    title: artifact.title,
    status,
    summary: parts.join(" - "),
    blockCount: blocks.length,
    sectionCount: sections.length,
    agentBlockCount,
    humanBlockCount: blocks.filter((block) => block.role === "human").length,
    needsReviewCount,
    citationCount,
    evidenceCount,
    sourceIds,
    traceIds,
    proposalIds,
    blocks,
    sections,
  };
}
