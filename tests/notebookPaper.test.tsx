// @vitest-environment jsdom
/**
 * THE NOTEBOOK IS PAPER — the NodeRoom notebook design on the shipped editors.
 *
 * Scenario: Maya reviews an agent-enriched diligence note in a dark-shell
 * room. The note must read ink-on-neutral paper (.nbk-frame re-pins the light
 * tokens), the .nbk-bar shows the artifact title plus block / needs-review
 * meta chips, agent-authored blocks carry the lighter .nbk-agent ink with the
 * terracotta margin dot, needs_review blocks get the amber chip, agent
 * evidence links become .nbk-sup citation superscripts that resolve to a
 * .nb-footnote list at doc end (cap 12, never fabricated), and a remote agent
 * write flashes exactly the changed blocks with wet ink.
 *
 * Angles: happy path (legacy + synced lanes both framed), sad path (no
 * evidence → no superscripts, empty docs), adversarial (hostile HTML stays
 * sanitized inside the frame; javascript:/data: URLs are never citations),
 * burst (agent rewrite wets only changed blocks, bounded), and sustained
 * scale (5k stacked links stay capped at 12; 800-block docs count fast).
 *
 * Same harness as tests/evidencePopover.test.tsx: convex/react + store are
 * mocked; the sync lane mocks useTiptapSync; real Tiptap editors mount in
 * jsdom so the sanitizer pipeline and PM decorations are the real thing.
 */
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Extension } from "@tiptap/core";
import type { Actor, Artifact as Art } from "../src/engine/types";

const mockStore = vi.hoisted(() => ({ current: {} as any }));
const mockConvex = vi.hoisted(() => ({
  notebookDoc: undefined as unknown,
  blocks: [] as unknown[],
  plans: [] as unknown[],
  mutation: vi.fn(() => Promise.resolve()),
}));
const mockSync = vi.hoisted(() => ({ current: null as any }));

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const a = (args ?? {}) as Record<string, unknown>;
    if ("kind" in a) return mockConvex.plans; // listAgentArtifacts
    if ("limit" in a) return mockConvex.blocks; // listNotebookBlocks
    return mockConvex.notebookDoc; // getNotebookDoc
  },
  useMutation: () => mockConvex.mutation,
}));
vi.mock("../src/app/store", () => ({ useStore: () => mockStore.current }));
vi.mock("@convex-dev/prosemirror-sync/tiptap", () => ({ useTiptapSync: () => mockSync.current }));

import {
  Note,
  SyncedNote,
  NotebookPaperFrame,
  NotebookFootnotes,
  notebookCitationModel,
  combinedNotebookFootnotes,
  notebookPaperMeta,
  blockTextsFromHtml,
  diffWetBlockIds,
  NOTEBOOK_FOOTNOTE_CAP,
} from "../src/ui/panels/Artifact";

const MAYA: Actor = { kind: "user", id: "u_maya", name: "Maya" };
const PROOF = { actorId: "u_maya", secret: "s" } as never;

function makeStore() {
  return {
    lockFor: () => null,
    listPresence: () => [],
    getArtifact: () => undefined,
    applyEdit: vi.fn(async () => ({ ok: true })),
  };
}

/** Agent section exactly as src/notebook/blockOps.ts emits it (data-* attrs in
 *  the data, never inferred), plus Maya's own human paragraph with a link. */
const DOC_HTML = [
  '<h1 data-blockid="b-title">CardioNova diligence</h1>',
  '<p data-blockid="b-human">Maya wrote this herself with a <a href="https://example.com/human-link">human link</a>.</p>',
  '<h2 data-agent-root="true" data-author-kind="agent" data-blockid="b-root">Agent notes</h2>',
  '<h4 data-blockid="b-sec" data-author-kind="agent" data-run-id="run1">Funding</h4>',
  '<ul>',
  '<li data-blockid="b-claim" data-author-kind="agent" data-run-id="run1"><p data-blockid="b-claim-p" data-author-kind="agent">Raised $14M Series A <a href="https://crunchbase.com/org/cardionova">Crunchbase</a></p></li>',
  '<li data-blockid="b-nr" data-author-kind="agent" data-status="needs_review"><p data-blockid="b-nr-p" data-author-kind="agent" data-status="needs_review">Runway ~14 months (unsourced claim)</p></li>',
  '</ul>',
].join("");

const AGENT_NOTES_HTML = [
  '<h2 data-agent-root="true" data-author-kind="agent">Agent notes</h2>',
  '<p data-blockid="an-1" data-author-kind="agent">Q3 revenue reconciles <a href="https://netsuite.example.com/close/q3">NetSuite close</a></p>',
].join("");

function makeNoteArt(over: { doc?: string; agent?: string; title?: string } = {}): Art {
  const elements: Record<string, unknown> = {
    doc: { value: over.doc ?? DOC_HTML, version: 3, updatedAt: 1_000, updatedBy: MAYA },
  };
  if (over.agent) {
    elements["doc:agent"] = {
      value: over.agent,
      version: 2,
      updatedAt: 1_000,
      updatedBy: { kind: "agent", id: "a_nodeagent", name: "NodeAgent", scope: "public" },
    };
  }
  return {
    id: "a_note1",
    roomId: "r1",
    kind: "note",
    title: over.title ?? "CardioNova — diligence brief",
    version: 3,
    elements,
    order: ["doc"],
    updatedAt: 1_000,
  } as unknown as Art;
}

function renderLegacyNote(art: Art) {
  mockStore.current = makeStore();
  return render(<Note roomId="r1" me={MAYA} art={art} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("paper frame — Maya opens the diligence note on the dark shell (legacy lane)", () => {
  it("wraps the editor in .nbk-frame with bar mark, artifact title, and block/needs-review meta chips", async () => {
    renderLegacyNote(makeNoteArt({ agent: AGENT_NOTES_HTML }));
    const frame = await screen.findByTestId("notebook-paper-frame");
    expect(frame.classList.contains("nbk-frame")).toBe(true);

    // The editor and the agent notes both live INSIDE the frame (paper, not dark panel).
    await waitFor(() => expect(within(frame).getByTestId("note-editor").querySelector(".ProseMirror")).toBeTruthy());
    expect(within(frame).getByTestId("agent-notes-block")).toBeTruthy();

    // Top chrome: room mark + title + meta chips.
    const bar = frame.querySelector(".nbk-bar")!;
    expect(bar).toBeTruthy();
    expect(bar.querySelector(".nbk-mark")?.textContent).toBe("N");
    expect(bar.querySelector(".nbk-bar-title")?.textContent).toBe("CardioNova — diligence brief");
    const blocksChip = screen.getByTestId("nbk-meta-blocks");
    expect(blocksChip.classList.contains("nbk-chip")).toBe(true);
    expect(Number(blocksChip.querySelector("b")?.textContent)).toBeGreaterThanOrEqual(5);
    const review = screen.getByTestId("nbk-meta-review");
    expect(review.classList.contains("nbk-st")).toBe(true);
    expect(review.classList.contains("needs_review")).toBe(true);
    expect(review.textContent).toContain("1 needs_review");
  });

  it("re-pins neutral Cloud paper tokens inside .nbk-frame on the dark shell", () => {
    // jsdom does not cascade external stylesheets, so the token contract is
    // asserted against the shipped CSS itself: the re-pin block must scope the
    // light values under .nbk-frame (class presence is asserted in the DOM test
    // above — no exact-color claims about a rendered browser here).
    const css = readFileSync(resolve(process.cwd(), "src/ui/panels/notebook-paper.css"), "utf8");
    // Comment terminators must balance: a stray "*/" inside a comment (e.g. a
    // "--text-*/" glob) closes it early and silently swallows the next rule —
    // this exact bug ate the whole token re-pin block in a real Chromium once.
    expect(css.match(/\*\//g)?.length).toBe(css.match(/\/\*/g)?.length);
    const framePin = css.slice(css.indexOf(".nbk-frame {"), css.indexOf("}", css.indexOf(".nbk-frame {")));
    expect(framePin).toContain("--bg-notebook: #F7F8FA");
    expect(framePin).toContain("--text-primary: #111827");
    expect(framePin).toContain("--text-secondary: #374151");
    expect(framePin).toContain("--accent: #D97757");
    // The frame paints itself with the neutral paper token and the wet-ink pass
    // respects prefers-reduced-motion (the CSS handles it).
    expect(css).toContain("background: var(--bg-notebook)");
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)[\s\S]*nbk-wet/);
  });

  it("gives agent-authored blocks the .nbk-agent margin-dot ink while Maya's own paragraph stays plain", async () => {
    renderLegacyNote(makeNoteArt());
    const frame = await screen.findByTestId("notebook-paper-frame");
    await waitFor(() => expect(frame.querySelector(".ProseMirror")).toBeTruthy());
    const agentPara = frame.querySelector('p[data-author-kind="agent"]');
    expect(agentPara).toBeTruthy();
    await waitFor(() => expect(agentPara!.classList.contains("nbk-agent")).toBe(true));
    const humanPara = frame.querySelector('p[data-blockid="b-human"]');
    expect(humanPara).toBeTruthy();
    expect(humanPara!.classList.contains("nbk-agent")).toBe(false);
  });

  it("renders the amber chip treatment on needs_review blocks (attribution lives in the data)", async () => {
    renderLegacyNote(makeNoteArt());
    const frame = await screen.findByTestId("notebook-paper-frame");
    await waitFor(() => {
      const flagged = frame.querySelector('[data-status="needs_review"]');
      expect(flagged).toBeTruthy();
      expect(flagged!.classList.contains("nbk-review")).toBe(true);
    });
    // Honest scoping: the accepted claim bullet is NOT flagged.
    expect(frame.querySelector('p[data-blockid="b-claim-p"]')?.classList.contains("nbk-review")).toBe(false);
  });

  it("mints citation superscripts ONLY from agent evidence urls and continues numbering into the footnotes", async () => {
    renderLegacyNote(makeNoteArt({ agent: AGENT_NOTES_HTML }));
    const frame = await screen.findByTestId("notebook-paper-frame");
    // Doc evidence link -> sup 1; agent-notes evidence link continues as sup 2.
    await waitFor(() => {
      const sups = Array.from(frame.querySelectorAll(".nbk-sup")).map((s) => s.textContent);
      expect(sups).toEqual(["1", "2"]);
    });
    // Maya's human link minted NOTHING (never fabricated, never over-claimed).
    const editor = within(frame).getByTestId("note-editor");
    const humanPara = editor.querySelector('p[data-blockid="b-human"]');
    expect(humanPara?.querySelector(".nbk-sup")).toBeNull();
    // Footnote list at doc end matches the superscripts 1:1.
    const rows = within(frame).getAllByTestId("notebook-footnote");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".n")?.textContent).toBe("1");
    expect(rows[0].querySelector(".m")?.textContent).toBe("crunchbase.com");
    expect(rows[0].querySelector("a.t")?.getAttribute("href")).toBe("https://crunchbase.com/org/cardionova");
    expect(rows[0].querySelector("a.t")?.getAttribute("rel")).toBe("noreferrer");
    expect(rows[1].querySelector(".n")?.textContent).toBe("2");
    expect(rows[1].querySelector(".m")?.textContent).toBe("netsuite.example.com");
  });

  it("renders NO superscripts and NO footnote list when agent bullets carry no evidence urls (sad path)", async () => {
    const doc = [
      '<h2 data-agent-root="true" data-author-kind="agent" data-blockid="b-root">Agent notes</h2>',
      '<p data-blockid="b-1" data-author-kind="agent" data-status="needs_review">Unsourced claim, downgraded honestly</p>',
    ].join("");
    renderLegacyNote(makeNoteArt({ doc }));
    const frame = await screen.findByTestId("notebook-paper-frame");
    await waitFor(() => expect(frame.querySelector(".ProseMirror")).toBeTruthy());
    expect(frame.querySelectorAll(".nbk-sup")).toHaveLength(0);
    expect(screen.queryByTestId("notebook-footnotes")).toBeNull();
  });

  it("keeps hostile agent HTML sanitized inside the frame (existing schema pipeline, adversarial)", async () => {
    const hostile = [
      '<h2 data-agent-root="true" data-author-kind="agent">Agent notes</h2>',
      '<script>window.__pwned = true;</script>',
      '<img src="x" onerror="window.__pwned = true;">',
      '<p data-blockid="h-1" data-author-kind="agent" onclick="window.__pwned = true;">safe text survives <a href="javascript:alert(1)">poisoned link</a></p>',
    ].join("");
    // Doc without evidence so any footnote could ONLY come from the hostile payload.
    renderLegacyNote(makeNoteArt({ doc: '<p data-blockid="d-clean">clean human doc</p>', agent: hostile }));
    const frame = await screen.findByTestId("notebook-paper-frame");
    const notes = within(frame).getByTestId("agent-notes-block");
    await waitFor(() => expect(notes.textContent).toContain("safe text survives"));
    expect(notes.querySelector("script")).toBeNull();
    expect(notes.querySelector("img")).toBeNull();
    expect(notes.querySelector("[onerror]")).toBeNull();
    expect(notes.querySelector("[onclick]")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    // The javascript: link is never a citation — no sup, no footnote.
    expect(notes.querySelectorAll(".nbk-sup")).toHaveLength(0);
    expect(screen.queryByTestId("notebook-footnotes")).toBeNull();
  });

  it("wet-inks exactly the blocks a remote agent write changed (elements.doc version bump)", async () => {
    const art1 = makeNoteArt();
    mockStore.current = makeStore();
    const view = render(<Note roomId="r1" me={MAYA} art={art1} />);
    const frame = await screen.findByTestId("notebook-paper-frame");
    await waitFor(() => expect(frame.querySelector(".ProseMirror")).toBeTruthy());
    expect(frame.querySelectorAll(".nbk-wet")).toHaveLength(0); // opening a doc is dry ink

    // The agent revises ONE bullet; everything else is untouched.
    const art2 = makeNoteArt({ doc: DOC_HTML.replace("Raised $14M Series A", "Raised $14M Series A (post-audit)") });
    view.rerender(<Note roomId="r1" me={MAYA} art={art2} />);
    await waitFor(() => expect(frame.querySelector('p[data-blockid="b-claim-p"]')?.classList.contains("nbk-wet")).toBe(true));
    expect(frame.querySelector('h1[data-blockid="b-title"]')?.classList.contains("nbk-wet")).toBe(false);
    expect(frame.querySelector('p[data-blockid="b-nr-p"]')?.classList.contains("nbk-wet")).toBe(false);
  });
});

describe("paper frame — the synced (live Convex) lane gets the same paper, no flag", () => {
  it("wraps SyncedNote in .nbk-frame and moves the read model + work plan into the quiet frame footer", async () => {
    mockStore.current = makeStore();
    mockConvex.notebookDoc = { prosemirrorDocId: "pmdoc-1" };
    mockConvex.blocks = [{ blockId: "b1", blockIndex: 0, blockType: "paragraph", text: "Synced paragraph", sourceSnapshotVersion: 3 }];
    mockConvex.plans = [{
      _id: "plan1", artifactId: "a_note1", status: "proposed", title: "Research CardioNova",
      payload: { goal: "Verify funding with sources" }, planHash: "abc123def456", updatedAt: 2_000,
    }];
    mockSync.current = {
      isLoading: false,
      extension: Extension.create({ name: "mockSyncExt" }),
      initialContent: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { blockId: "s-p1" }, content: [{ type: "text", text: "Synced paragraph" }] },
          { type: "paragraph", attrs: { blockId: "s-p2", authorKind: "agent", status: "needs_review" }, content: [{ type: "text", text: "Agent claim pending review" }] },
        ],
      },
    };
    render(<SyncedNote roomId="r1" me={MAYA} proof={PROOF} art={makeNoteArt({ agent: AGENT_NOTES_HTML })} />);

    const frame = await screen.findByTestId("notebook-paper-frame");
    await waitFor(() => expect(within(frame).getByTestId("note-editor").querySelector(".ProseMirror")).toBeTruthy());

    // Read model + plan card render inside the frame footer as paper chips.
    const foot = frame.querySelector(".nbk-foot")!;
    expect(foot).toBeTruthy();
    const readModel = within(foot as HTMLElement).getByTestId("notebook-read-model");
    expect(readModel.querySelector(".r-tag.nbk-chip")).toBeTruthy();
    expect(within(foot as HTMLElement).getByTestId("agent-work-plan-card")).toBeTruthy();

    // The synced doc's agent ink + review chip come from the SAME decorations.
    await waitFor(() => {
      const agentPara = frame.querySelector('p[data-author-kind="agent"]');
      expect(agentPara?.classList.contains("nbk-agent")).toBe(true);
      expect(agentPara?.classList.contains("nbk-review")).toBe(true);
    });

    // Meta chips populated from the lifted editor HTML + agent notes.
    await waitFor(() => expect(Number(screen.getByTestId("nbk-meta-blocks").querySelector("b")?.textContent)).toBeGreaterThanOrEqual(3));
    expect(screen.getByTestId("nbk-meta-review").textContent).toContain("needs_review");
  });
});

describe("citation model, meta, and wet diff — bounds and honesty (pure)", () => {
  const agentLink = (i: number, href?: string) =>
    `<p data-blockid="p${i}" data-author-kind="agent">claim ${i} <a href="${href ?? `https://source${i}.example/page`}">src ${i}</a></p>`;

  it("caps footnotes at 12 when an agent burst stacks 20 distinct sources", () => {
    const html = Array.from({ length: 20 }, (_, i) => agentLink(i)).join("");
    const model = notebookCitationModel(html);
    expect(model).toHaveLength(NOTEBOOK_FOOTNOTE_CAP);
    expect(model[11].n).toBe(12);
  });

  it("dedupes repeat citations of the same url into one footnote", () => {
    const html = agentLink(1, "https://crunchbase.com/org/x") + agentLink(2, "https://crunchbase.com/org/x");
    expect(notebookCitationModel(html)).toHaveLength(1);
  });

  it("rejects non-http(s) schemes and non-agent links — a citation is never fabricated", () => {
    const html = [
      agentLink(1, "javascript:alert(1)"),
      agentLink(2, "data:text/html,<script>1</script>"),
      agentLink(3, "vbscript:evil"),
      '<p data-blockid="ph">human <a href="https://human.example/x">link</a></p>',
      '<p data-blockid="pt" data-author-kind="agent">no link at all</p>',
    ].join("");
    expect(notebookCitationModel(html)).toHaveLength(0);
    expect(combinedNotebookFootnotes(html, "")).toHaveLength(0);
  });

  it("renumbers combined doc + agent-notes footnotes 1..N under the global cap", () => {
    const docHtml = Array.from({ length: 8 }, (_, i) => agentLink(i)).join("");
    const agentHtml = Array.from({ length: 8 }, (_, i) => agentLink(100 + i)).join("");
    const combined = combinedNotebookFootnotes(docHtml, agentHtml);
    expect(combined).toHaveLength(NOTEBOOK_FOOTNOTE_CAP);
    expect(combined.map((c) => c.n)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(combined[8].host).toBe("source100.example");
  });

  it("stays bounded when a runaway agent loop stacked 5,000 links (sustained)", () => {
    const html = Array.from({ length: 5_000 }, (_, i) => agentLink(i)).join("");
    const started = Date.now();
    expect(notebookCitationModel(html)).toHaveLength(NOTEBOOK_FOOTNOTE_CAP);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("counts nested block identity once and needs_review flags for the meta chips", () => {
    const meta = notebookPaperMeta(DOC_HTML, AGENT_NOTES_HTML);
    // b-title, b-human, b-root, b-sec, b-claim (li+p = 1), b-nr (li+p = 1) + an-1 (h2 has no id -> tag fallback not used)
    expect(meta.blocks).toBe(7);
    expect(meta.needsReview).toBe(1); // li + nested p carry the flag but it is ONE review item, not two
  });

  it("falls back to block tags for legacy human notes that predate block ids", () => {
    expect(notebookPaperMeta("<p>one</p><p>two</p><h2>three</h2>").blocks).toBe(3);
    expect(notebookPaperMeta(undefined, "").blocks).toBe(0);
  });

  it("wet diff: first snapshot is dry, only changed/new blocks wet, bounded at 40 for full rewrites", () => {
    const before = blockTextsFromHtml(DOC_HTML);
    expect(diffWetBlockIds(null, before)).toEqual([]); // opening a doc is not news
    expect(diffWetBlockIds(before, before)).toEqual([]);

    const after = blockTextsFromHtml(DOC_HTML.replace("Raised $14M Series A", "Raised $14M Series A (post-audit)"));
    const wet = diffWetBlockIds(before, after);
    expect(wet).toContain("b-claim-p");
    expect(wet).not.toContain("b-title");

    const rewrite = blockTextsFromHtml(Array.from({ length: 200 }, (_, i) => `<p data-blockid="w${i}">v2 ${i}</p>`).join(""));
    expect(diffWetBlockIds(before, rewrite).length).toBeLessThanOrEqual(40);
  });
});

describe("frame + footnote leaf components (render contract)", () => {
  it("hides the needs-review chip at zero and pluralizes the block chip", () => {
    const { rerender } = render(<NotebookPaperFrame title="t" meta={{ blocks: 1, needsReview: 0 }}>x</NotebookPaperFrame>);
    expect(screen.getByTestId("nbk-meta-blocks").textContent).toBe("1 block");
    expect(screen.queryByTestId("nbk-meta-review")).toBeNull();
    rerender(<NotebookPaperFrame title="t" meta={{ blocks: 2, needsReview: 3 }}>x</NotebookPaperFrame>);
    expect(screen.getByTestId("nbk-meta-blocks").textContent).toBe("2 blocks");
    expect(screen.getByTestId("nbk-meta-review").textContent).toBe("3 needs_review");
  });

  it("renders nothing for an empty footnote list (calm by default)", () => {
    const { container } = render(<NotebookFootnotes notes={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
