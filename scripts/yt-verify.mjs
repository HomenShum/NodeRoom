#!/usr/bin/env node
/**
 * yt-verify.mjs — confirm the published roster is publicly reachable, and that
 * the superseded uploads are NOT.
 *
 * A script that printed "DONE" is not evidence.
 *
 * Two deliberate changes from the browser-driven version:
 *
 * 1. NO BROWSER. This used connectOverCDP, which meant a verifier could only
 *    run when Chrome happened to be up with a debugging port — and, before the
 *    close-kills-Chrome fix, could take the user's browser down with it. The
 *    oembed endpoint answers the actual question (is this public, and what is
 *    its title) over plain HTTP, with no session and nothing to break.
 *
 * 2. IT CHECKS BOTH DIRECTIONS. Confirming the good ones resolve proves
 *    nothing about the ones that should be gone. A PASS here means the roster
 *    is reachable AND every superseded id is refused — the second half is what
 *    would catch a privatize that silently did nothing.
 *
 *   node scripts/yt-verify.mjs
 */
import { PUBLISHED, SUPERSEDED } from "./yt-roster.mjs";

const oembed = async (id) => {
  const r = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`);
  return { status: r.status, title: r.ok ? (await r.json()).title : null };
};

let bad = 0;

console.log(`published roster — expect HTTP 200 and a matching title (${PUBLISHED.length})`);
for (const v of PUBLISHED) {
  const { status, title } = await oembed(v.id);
  // Both conditions matter: a 200 alone would pass even if the id pointed at
  // some other video, and two of these titles share every word but the product.
  const ok = status === 200 && (title ?? "").includes(v.expect);
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${v.key.padEnd(22)} ${v.id}  HTTP ${status}`);
  if (!ok) console.log(`        expected title to contain: ${v.expect}\n        got: ${title ?? "(not public)"}`);
}

console.log(`\nsuperseded — expect NOT publicly resolvable (${SUPERSEDED.length})`);
for (const v of SUPERSEDED) {
  const { status, title } = await oembed(v.id);
  const ok = status !== 200;
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${v.id}  HTTP ${status}  ${v.why}`);
  if (!ok) console.log(`        STILL PUBLIC as "${title}" — privatize did not take`);
}

console.log(`\n${bad === 0 ? "roster verified — all published reachable, all superseded refused" : `${bad} check(s) FAILED`}`);
process.exitCode = bad === 0 ? 0 : 1;
