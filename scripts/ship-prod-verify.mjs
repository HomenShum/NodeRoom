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
let url = "https://noderoom.live";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--url") url = args[++i];
  else if (args[i] === "--signal") signals.push(args[++i]);
}

if (signals.length === 0) {
  console.error("[ship-prod-verify] FAIL (usage): at least one --signal \"<string expected in raw prod HTML>\" is required — pick a string your change adds (testid, copy, slug).");
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
