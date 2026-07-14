import type { DeckStoryboard } from "./deckStoryboard";

export interface DeckPreviewExport {
  exportVersion: 1;
  deckId: string;
  planHash: string;
  title: string;
  generatedAt: number;
  slideCount: number;
  needsReviewCount: number;
  sourceArtifactIds: string[];
  traceIds: string[];
  proposalIds: string[];
  integrityHash: string;
  html: string;
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "deck";
}

function slideHtml(storyboard: DeckStoryboard): string {
  return storyboard.slides.map((slide, index) => `
    <section class="slide" data-status="${escapeHtml(slide.status)}">
      <div class="slide-num">${index + 1}</div>
      <div>
        <p class="eyebrow">${escapeHtml(slide.status.replace("_", " "))}</p>
        <h2>${escapeHtml(slide.title)}</h2>
        <p class="purpose">${escapeHtml(slide.purpose)}</p>
        <div class="claims">
          ${slide.claims.slice(0, 5).map((claim) => `
            <article class="claim" data-status="${escapeHtml(claim.status)}">
              <span>${escapeHtml(claim.status.replace("_", " "))}</span>
              <p>${escapeHtml(claim.text)}</p>
            </article>
          `).join("")}
        </div>
        ${slide.unresolvedGaps.length > 0 ? `
          <div class="gaps">
            ${slide.unresolvedGaps.slice(0, 4).map((gap) => `<span>${escapeHtml(gap)}</span>`).join("")}
          </div>
        ` : ""}
      </div>
    </section>
  `).join("\n");
}

export function deckPreviewFileName(title: string, integrityHash: string): string {
  return `${slug(title)}-deck-preview-${integrityHash}.html`;
}

export function buildDeckPreviewExport(storyboard: DeckStoryboard, generatedAt = 0): DeckPreviewExport {
  const needsReviewCount = storyboard.slides.reduce(
    (sum, slide) => sum + slide.unresolvedGaps.length + slide.claims.filter((claim) => claim.status !== "verified").length,
    0,
  );
  const hashBase = {
    deckId: storyboard.deckId,
    planHash: storyboard.planHash,
    slides: storyboard.slides.map((slide) => ({
      id: slide.slideId,
      status: slide.status,
      claims: slide.claims.map((claim) => [claim.claimId, claim.status, claim.evidenceId, claim.traceId, claim.proposalId]),
      gaps: slide.unresolvedGaps,
    })),
  };
  const integrityHash = stableHash(hashBase);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(storyboard.title)}</title>
  <style>
    :root { color-scheme: dark; --bg: #08090b; --surface: #101317; --line: rgba(255,255,255,.09); --text: #f3f6fb; --muted: #99a3af; --accent: #e59579; --ok: #55d49a; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { display: grid; gap: 18px; width: min(1120px, calc(100vw - 32px)); margin: 0 auto; padding: 28px 0 40px; }
    header { display: grid; gap: 8px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
    h1, h2, p { margin: 0; }
    h1 { font-size: clamp(26px, 4vw, 42px); line-height: 1.05; letter-spacing: 0; }
    h2 { font-size: clamp(20px, 3vw, 31px); line-height: 1.1; letter-spacing: 0; }
    .eyebrow, .meta { color: var(--muted); font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-transform: uppercase; letter-spacing: .08em; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; text-transform: none; letter-spacing: 0; }
    .meta span, .gaps span { display: inline-flex; min-height: 24px; align-items: center; padding: 0 8px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.03); }
    .slide { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 18px; min-height: 460px; padding: 26px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); page-break-after: always; }
    .slide[data-status="needs_review"] { border-color: rgba(229,149,121,.34); }
    .slide-num { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 9px; color: var(--accent); background: rgba(229,149,121,.12); font: 800 13px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .purpose { margin-top: 10px; color: var(--muted); max-width: 780px; }
    .claims { display: grid; gap: 9px; margin-top: 22px; }
    .claim { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; align-items: start; padding: 11px 12px; border: 1px solid var(--line); border-radius: 8px; background: rgba(255,255,255,.025); }
    .claim span { color: var(--muted); font: 700 10px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-transform: uppercase; }
    .claim[data-status="verified"] span { color: var(--ok); }
    .claim[data-status="needs_review"] span, .slide[data-status="needs_review"] .eyebrow { color: var(--accent); }
    .gaps { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 18px; color: var(--accent); }
    @media print { body { background: #fff; color: #111; } main { width: 100%; padding: 0; } .slide { min-height: 7in; border-color: #ddd; background: #fff; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">NodeRoom deck preview</p>
      <h1>${escapeHtml(storyboard.title)}</h1>
      <p>${escapeHtml(storyboard.objective)}</p>
      <div class="meta">
        <span>plan ${escapeHtml(storyboard.planHash)}</span>
        <span>${storyboard.slides.length} slides</span>
        <span>${needsReviewCount} review items</span>
        <span>${storyboard.traceIds.length} traces</span>
      </div>
    </header>
    ${slideHtml(storyboard)}
  </main>
</body>
</html>`;

  return {
    exportVersion: 1,
    deckId: storyboard.deckId,
    planHash: storyboard.planHash,
    title: storyboard.title,
    generatedAt,
    slideCount: storyboard.slides.length,
    needsReviewCount,
    sourceArtifactIds: storyboard.sourceArtifactIds,
    traceIds: storyboard.traceIds,
    proposalIds: storyboard.proposalIds,
    integrityHash,
    html,
  };
}
