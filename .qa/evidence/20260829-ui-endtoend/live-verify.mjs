// Live-DOM verification via the chunk graph (index.html has no <link>/inline app code;
// content ships in hashed JS chunks). Usage: node live-verify.mjs <base> <signal> [signal...]
const [base, ...signals] = process.argv.slice(2);
if (!base || !signals.length) { console.error('usage: node live-verify.mjs <base-url> <signal>...'); process.exit(1); }
const seen = new Set();
const found = new Map(signals.map(s => [s, null]));
const html = await (await fetch(base, { headers: { 'user-agent': 'noderoom-live-verify' } })).text();
for (const s of signals) if (html.includes(s)) found.set(s, 'index.html');
// collect chunk urls from index.html, then one level of their static imports
const absRe = /\/assets\/[A-Za-z0-9._-]+\.js/g;
const relRe = /["'`]\.\/([A-Za-z0-9._-]+\.js)["'`]/g;
let frontier = [...new Set(html.match(absRe) ?? [])];
for (let depth = 0; depth < 4 && frontier.length; depth++) {
  const next = [];
  for (const path of frontier) {
    if (seen.has(path)) continue; seen.add(path);
    const body = await (await fetch(base + path)).text().catch(() => '');
    for (const s of signals) if (!found.get(s) && body.includes(s)) found.set(s, path);
    if ([...found.values()].every(Boolean)) break;
    next.push(...(body.match(absRe) ?? []));
    for (const m of body.matchAll(relRe)) next.push('/assets/' + m[1]);
  }
  if ([...found.values()].every(Boolean)) break;
  frontier = [...new Set(next)].filter(p => !seen.has(p));
}
let ok = true;
for (const [s, where] of found) {
  console.log(where ? `OK   "${s}" -> ${where}` : `MISS "${s}" (searched ${seen.size} chunks)`);
  if (!where) ok = false;
}
process.exit(ok ? 0 : 1);
