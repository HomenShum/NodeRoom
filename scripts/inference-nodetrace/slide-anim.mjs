// Render nodetrace-state.json -> a SELF-ANIMATING walkthrough slide (feature-walkthrough-gif style:
// staggered reveal of flow -> trace -> evidence, a gliding cursor over the flow, a caption ticker,
// ending on the client-ready punch). Loops. Captured to video/GIF by shoot-gif.mjs.
//   node scripts/inference-nodetrace/slide-anim.mjs <dir>
import fs from 'node:fs';
import path from 'node:path';
const dir = path.join(process.cwd(), process.argv[2] || 'scripts/inference-nodetrace/out');
const s = JSON.parse(fs.readFileSync(path.join(dir, 'nodetrace-state.json'), 'utf8'));
const esc = (x) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const PILL = { verified: ['#e4f2ec', '#1f6b52'], addressed: ['#e7eefb', '#385f9d'], needs_review: ['#fdf1dd', '#9a6b1e'], missing: ['#fbe4e4', '#a23a3a'], ready: ['#e7eefb', '#385f9d'] };
const grade = s.grade?.score;
const nodes = s.coach.graphNodes;
const flow = nodes.map((n, i) => `<div class="node" style="--d:${0.5 + i * 0.7}s"><div class="nlabel">${esc(n.label)}</div><div class="nsub">${esc(n.summary)}</div></div>${i < nodes.length - 1 ? '<div class="arrow">&rarr;</div>' : ''}`).join('');
const rows = s.traces.map((t, i) => `<li style="--d:${3.4 + i * 0.35}s"><span class="ph">${esc(t.phase)}</span><div><div class="sum">${esc(t.summary)}</div><div class="meta">${esc(t.actor)} &middot; ${t.durationMs}ms</div></div></li>`).join('');
const proofs = s.proofs.map((p, i) => { const [bg, fg] = PILL[p.status] || PILL.ready; return `<div class="proof" style="--d:${5.2 + i * 0.28}s"><div class="phead"><b>${esc(p.title)}</b><span style="background:${bg};color:${fg}">${esc(p.status)}</span></div><p class="detail">${esc(p.detail)}</p></div>`; }).join('');
const captions = ['Run one task through the harness on Inference.ai', '1 - PLAN the deliverable', '2 - GATHER the data room', '3 - PRODUCE the model', '4 - VERIFY against the rubric', 'Per-metric evidence, with provenance', s.grade?.clientReady ? `Reasoned it all - but client-ready is ${s.grade.clientReady}` : `Graded ${grade} against the golden rubric`];

const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.session.title)}</title><style>
*{box-sizing:border-box}@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes pop{0%{opacity:0;transform:scale(.96)}60%{transform:scale(1.02)}100%{opacity:1;transform:none}}
@keyframes glow{0%,100%{box-shadow:0 0 0 0 rgba(192,83,43,0)}50%{box-shadow:0 0 0 3px rgba(192,83,43,.35)}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes glide{0%{left:7%;top:34%}14%{left:7%;top:34%}30%{left:30%;top:34%}48%{left:54%;top:34%}66%{left:78%;top:34%}80%{left:60%;top:70%}100%{left:60%;top:70%}}
@keyframes ripple{0%,55%{opacity:0;transform:scale(.4)}60%{opacity:.5;transform:scale(1)}75%{opacity:0;transform:scale(1.8)}100%{opacity:0}}
html,body{margin:0;background:#0e1116;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
.slide{position:relative;width:1280px;height:720px;margin:0 auto;background:#f6f7f5;color:#18212f;display:grid;grid-template-rows:auto auto 1fr auto;gap:13px;padding:24px 30px 50px;border-radius:10px;overflow:hidden}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;animation:rise .5s both}
.ttl{font-size:20px;font-weight:800;letter-spacing:-.2px}.sub{color:#687488;font-size:12px;font-weight:600;margin-top:3px}
.badge{border-radius:999px;padding:7px 14px;font-size:13px;font-weight:800;animation:rise .5s 6.4s both,pulse 1s 6.9s 2}
.badge.ok{background:#e4f2ec;color:#1f6b52}.badge.warn{background:#fdf1dd;color:#9a6b1e}
.flow{display:flex;align-items:stretch;gap:8px;background:#fff;border:1px solid #d9dfda;border-radius:8px;padding:12px 14px}
.node{flex:1;display:grid;gap:3px;border:1px solid #d9dfda;border-radius:8px;padding:9px 12px;background:#fbfcfb;opacity:0;animation:pop .5s var(--d) both,glow 1.1s var(--d) 1}
.nlabel{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.3px;color:#7d576a}.nsub{font-size:12px;color:#687488}
.arrow{display:flex;align-items:center;color:#a9b2bd;font-size:20px;font-weight:800}
.cols{display:grid;grid-template-columns:1.15fr 1fr;gap:16px;min-height:0}
.col{background:#fff;border:1px solid #d9dfda;border-radius:8px;padding:12px 14px;overflow:hidden}
h3{margin:0 0 8px;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.3px;color:#7d576a}
.traces{list-style:none;margin:0;padding:0}.traces li{display:grid;grid-template-columns:78px 1fr;gap:4px 10px;border-bottom:1px solid #e8ece6;padding:8px 0;opacity:0;animation:rise .45s var(--d) both}
.ph{font-size:11px;font-weight:900;text-transform:uppercase;color:#385f9d}.sum{font-size:12.5px;line-height:1.3}.meta{font-size:11px;color:#9aa4b0;margin-top:2px}
.proof{display:grid;gap:5px;border:1px solid #d9dfda;border-radius:8px;padding:9px 12px;background:#fbfcfb;margin-bottom:7px;opacity:0;animation:rise .45s var(--d) both}
.phead{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13.5px}.phead span{border-radius:999px;padding:3px 9px;font-size:10px;font-weight:800;text-transform:uppercase}
.detail{margin:0;color:#536175;font-size:11.5px;font-family:ui-monospace,Menlo,monospace}
.cursor{position:absolute;width:20px;height:20px;z-index:9;animation:glide 8s ease-in-out infinite}
.cursor svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.3))}.cursor::after{content:"";position:absolute;left:-12px;top:-12px;width:44px;height:44px;border-radius:50%;background:#c0532b;animation:ripple 8s ease-in-out infinite}
.cap{position:absolute;left:0;right:0;bottom:0;background:#1d2633;color:#fff;font-size:13px;font-weight:700;padding:9px 30px;display:flex;align-items:center;gap:10px}
.cap .dot{width:8px;height:8px;border-radius:50%;background:#c0532b}.cap b{color:#ffd9c7}
</style></head><body><div class="slide">
<header><div><div class="ttl">${esc(s.session.title)}</div><div class="sub">Exact trace of one task through the harness &middot; nodetrace visuals</div></div>
<div class="badge ${s.grade?.clientReady ? 'warn' : grade != null && grade >= 0.99 ? 'ok' : 'warn'}">${esc(s.grade?.kind || 'grade')}: ${grade}${s.grade?.clientReady ? ` &middot; client-ready ${esc(s.grade.clientReady)}` : ''}</div></header>
<section class="flow">${flow}</section>
<div class="cols"><div class="col"><h3>Trace steps (${s.traces.length})</h3><ul class="traces">${rows}</ul></div>
<div class="col"><h3>Evidence &mdash; per-metric proof</h3>${proofs}</div></div>
<div class="cursor"><svg width="20" height="20" viewBox="0 0 20 20"><path d="M2 2 L2 16 L6 12 L9 18 L12 17 L9 11 L15 11 Z" fill="#1d2633" stroke="#fff" stroke-width="1"/></svg></div>
<div class="cap"><span class="dot"></span><span id="cap">Run one task through the harness on Inference.ai</span></div>
</div>
<script>const C=${JSON.stringify(captions)};const el=document.getElementById('cap');let i=0;el.textContent=C[0];setInterval(()=>{i=(i+1)%C.length;el.textContent=C[i];},1450);</script>
</body></html>`;
fs.writeFileSync(path.join(dir, 'slide-anim.html'), html);
console.log('wrote', path.join(dir, 'slide-anim.html'));
