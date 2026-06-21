// Render out/nodetrace-state.json -> a self-contained 16:9 HTML slide with nodetrace visuals.
import fs from 'node:fs';
import path from 'node:path';
const dir = path.join(process.cwd(), process.argv[2] || 'scripts/inference-nodetrace/out');
const s = JSON.parse(fs.readFileSync(path.join(dir, 'nodetrace-state.json'), 'utf8'));
const esc = (x) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const PILL = { verified: ['#e4f2ec', '#1f6b52'], addressed: ['#e7eefb', '#385f9d'], needs_review: ['#fdf1dd', '#9a6b1e'], missing: ['#fbe4e4', '#a23a3a'], ready: ['#e7eefb', '#385f9d'] };
const grade = s.grade?.score;
const nodes = s.coach.graphNodes;
const flow = nodes.map((n, i) =>
  `<div class="node" data-actor="${esc(s.coach.steps[i]?.meta?.actor || '')}"><div class="nlabel">${esc(n.label)}</div><div class="nsub">${esc(n.summary)}</div></div>` +
  (i < nodes.length - 1 ? '<div class="arrow">&rarr;</div>' : '')).join('');
const rows = s.traces.map((t) =>
  `<li><span class="ph">${esc(t.phase)}</span><div><div class="sum">${esc(t.summary)}</div><div class="meta">${esc(t.actor)} &middot; ${t.durationMs}ms</div></div></li>`).join('');
const proofs = (s.proofs.length ? s.proofs : [{ title: '(no outputs parsed)', status: 'missing', detail: 'model returned no valid JSON', sourceLabel: '—' }])
  .map((p) => { const [bg, fg] = PILL[p.status] || PILL.ready;
    return `<div class="proof"><div class="phead"><b>${esc(p.title)}</b><span style="background:${bg};color:${fg}">${esc(p.status)}</span></div><p class="detail">${esc(p.detail)}</p><div class="src">&#8627; ${esc(p.sourceLabel)}</div></div>`; }).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.session.title)}</title>
<style>
*{box-sizing:border-box} html,body{margin:0;background:#0e1116;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
.slide{width:1280px;height:720px;margin:0 auto;background:#f6f7f5;color:#18212f;display:grid;grid-template-rows:auto auto 1fr auto;gap:14px;padding:26px 30px;border-radius:10px}
header{display:flex;align-items:center;justify-content:space-between;gap:16px}
.ttl{font-size:21px;font-weight:800;letter-spacing:-.2px}
.sub{color:#687488;font-size:12px;font-weight:600;margin-top:3px}
.badge{border-radius:999px;padding:7px 14px;font-size:13px;font-weight:800}
.badge.ok{background:#e4f2ec;color:#1f6b52}.badge.warn{background:#fdf1dd;color:#9a6b1e}
.flow{display:flex;align-items:stretch;gap:8px;background:#fff;border:1px solid #d9dfda;border-radius:8px;padding:12px 14px}
.node{flex:1;display:grid;gap:3px;border:1px solid #d9dfda;border-radius:8px;padding:9px 12px;background:#fbfcfb}
.node[data-actor="harness"]{background:#eef1ee}
.nlabel{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.3px;color:#7d576a}
.nsub{font-size:12px;color:#687488}
.arrow{display:flex;align-items:center;color:#a9b2bd;font-size:20px;font-weight:800}
.cols{display:grid;grid-template-columns:1.15fr 1fr;gap:16px;min-height:0}
.col{background:#fff;border:1px solid #d9dfda;border-radius:8px;padding:12px 14px;overflow:auto}
h3{margin:0 0 8px;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.3px;color:#7d576a}
.traces{list-style:none;margin:0;padding:0}
.traces li{display:grid;grid-template-columns:78px 1fr;gap:4px 10px;border-bottom:1px solid #e8ece6;padding:9px 0}
.traces li:last-child{border-bottom:0}
.ph{font-size:11px;font-weight:900;text-transform:uppercase;color:#385f9d}
.sum{font-size:13px;line-height:1.35}.meta{font-size:11px;color:#9aa4b0;margin-top:2px}
.proof{display:grid;gap:6px;border:1px solid #d9dfda;border-radius:8px;padding:10px 12px;background:#fbfcfb;margin-bottom:8px}
.phead{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:14px}
.phead span{border-radius:999px;padding:3px 9px;font-size:10px;font-weight:800;text-transform:uppercase}
.detail{margin:0;color:#536175;font-size:12px;font-family:ui-monospace,Menlo,monospace}
.src{font-size:11px;color:#687488}
footer{color:#687488;font-size:11px;border-top:1px solid #e3e7e1;padding-top:10px}
footer b{color:#18212f}
</style></head><body><div class="slide">
<header><div><div class="ttl">${esc(s.session.title)}</div><div class="sub">Exact trace of one task run through the harness &middot; nodetrace visuals</div></div>
<div class="badge ${s.grade?.clientReady ? 'warn' : (grade != null && grade >= 0.99 ? 'ok' : 'warn')}">${esc(s.grade?.kind || 'deterministic grade')}: ${grade}${s.grade?.clientReady ? ` &middot; client-ready ${esc(s.grade.clientReady)}` : ''}</div></header>
<section class="flow">${flow}</section>
<div class="cols"><div class="col"><h3>Trace steps (${s.traces.length})</h3><ul class="traces">${rows}</ul></div>
<div class="col"><h3>Evidence &mdash; per-metric proof</h3>${proofs}</div></div>
<footer><b>${esc(s.session.summary)}</b> &middot; provenance: every cell graded against the golden rubric &middot; no fabrication</footer>
</div></body></html>`;
fs.writeFileSync(path.join(dir, 'slide.html'), html);
console.log('wrote', path.join(dir, 'slide.html'));
