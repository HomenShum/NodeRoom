#!/usr/bin/env node
/**
 * ship-prod-verify — the live-DOM leg of `npm run ship:prod`.
 *
 * Fetches the production URL's RAW HTML (no JS execution, same view a crawler or
 * LLM agent gets) and asserts every --signal string is present. This is what
 * catches the three deploy landmines: disconnected deploy webhooks, SSR Suspense
 * shells that hydrate for browsers but serve blanks to crawlers, and stale CDN HTML.
 *
 *   node scripts/ship-prod-verify.mjs --signal "data-testid=\"start-demo-room\""
 *   node scripts/ship-prod-verify.mjs --url https://noderoom.live --signal foo --signal bar
 *
 * Exits nonzero naming the failed leg. A ship is not "live" until this passes.
 */

const args = process.argv.slice(2);
const signals = [];
const chunkSignals = [];
const chunkAbsent = [];
let url = "https://noderoom.live";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--url") url = args[++i];
  else if (args[i] === "--signal") signals.push(args[++i]);
  else if (args[i] === "--chunk-signal") chunkSignals.push(args[++i]);
  else if (args[i] === "--chunk-absent") chunkAbsent.push(args[++i]);
}

if (signals.length === 0 && chunkSignals.length === 0 && chunkAbsent.length === 0) {
  console.error("[ship-prod-verify] FAIL (usage): at least one --signal / --chunk-signal / --chunk-absent is required — pick a string your change adds (testid, copy, slug, baked config).");
  process.exit(2);
}

const MAX_BYTES = 5 * 1024 * 1024; // cap the read; landing HTML should be well under this
const TIMEOUT_MS = 30_000;

const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

let res;
try {
  res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "noderoom-ship-prod-verify" } });
} catch (err) {
  console.error(`[ship-prod-verify] FAIL (fetch): ${url} unreachable — ${err?.cause?.code ?? err?.name ?? err}`);
  process.exit(1);
} finally {
  clearTimeout(timer);
}

if (!res.ok) {
  console.error(`[ship-prod-verify] FAIL (status): ${url} returned HTTP ${res.status}`);
  process.exit(1);
}

const reader = res.body.getReader();
let html = "";
let bytes = 0;
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  bytes += value.byteLength;
  if (bytes > MAX_BYTES) {
    console.error(`[ship-prod-verify] FAIL (bound): response exceeded ${MAX_BYTES} bytes — not a normal page`);
    process.exit(1);
  }
  html += decoder.decode(value, { stream: true });
}

const missing = signals.filter((s) => !html.includes(s));
if (missing.length > 0) {
  console.error(`[ship-prod-verify] FAIL (dom-signal): ${url} raw HTML (${bytes} bytes) is missing: ${missing.map((m) => JSON.stringify(m)).join(", ")}`);
  console.error("[ship-prod-verify] The change is NOT live regardless of build/push output. Check: Vercel Ready deployment newer than HEAD? CDN cache? SSR Suspense shell?");
  process.exit(1);
}

console.log(`[ship-prod-verify] OK — ${url} (HTTP ${res.status}, ${bytes} bytes) contains all ${signals.length} signal(s).`);

// ── chunk-graph leg — app content and config ship in hashed JS chunks, not raw HTML.
// --chunk-signal asserts a string exists somewhere in the chunk graph; --chunk-absent
// asserts it exists NOWHERE. The absent check exists because of 2026-08-29: the live
// bundle was baked with VITE_CONVEX_URL pointing at the standby Convex deployment
// (aromatic-bass-102) while every convex deploy targeted zealous-goshawk-766 — a
// split-brain that broke prod sign-in and that no raw-HTML signal could catch.
if (chunkSignals.length > 0 || chunkAbsent.length > 0) {
  const base = new URL(url).origin;
  const absRe = /\/assets\/[A-Za-z0-9._-]+\.js/g;
  const relRe = /["'`]\.\/([A-Za-z0-9._-]+\.js)["'`]/g;
  const found = new Map(chunkSignals.map((s) => [s, null]));
  const absentHits = new Map(chunkAbsent.map((s) => [s, null]));
  const seen = new Set();
  let frontier = [...new Set(html.match(absRe) ?? [])];
  for (let depth = 0; depth < 4 && frontier.length; depth++) {
    const next = [];
    for (const path of frontier) {
      if (seen.has(path)) continue;
      seen.add(path);
      const body = await fetch(base + path).then((r) => (r.ok ? r.text() : "")).catch(() => "");
      for (const s of chunkSignals) if (!found.get(s) && body.includes(s)) found.set(s, path);
      for (const s of chunkAbsent) if (!absentHits.get(s) && body.includes(s)) absentHits.set(s, path);
      next.push(...(body.match(absRe) ?? []));
      for (const m of body.matchAll(relRe)) next.push("/assets/" + m[1]);
    }
    frontier = [...new Set(next)].filter((p) => !seen.has(p));
  }
  const chunkMissing = chunkSignals.filter((s) => !found.get(s));
  const absentViolations = chunkAbsent.filter((s) => absentHits.get(s));
  if (chunkMissing.length > 0 || absentViolations.length > 0) {
    for (const s of chunkMissing) console.error(`[ship-prod-verify] FAIL (chunk-signal): ${JSON.stringify(s)} not found in ${seen.size} chunks`);
    for (const s of absentViolations) console.error(`[ship-prod-verify] FAIL (chunk-absent): ${JSON.stringify(s)} FOUND in ${absentHits.get(s)} — forbidden string is live`);
    console.error("[ship-prod-verify] The change is NOT live (or ships forbidden config). Check the Vercel env + deployment before re-claiming.");
    process.exit(1);
  }
  console.log(`[ship-prod-verify] OK — chunk graph (${seen.size} chunks): ${chunkSignals.length} present, ${chunkAbsent.length} confirmed absent.`);
}
