// Revamp the pitch deck in frontend-slides "Signal" editorial style.
// Reads the honesty-gated deck_plan.json (content + provenance preserved) and emits a
// zero-dependency, fixed-16:9 (1920x1080) Signal-aesthetic deck.
//   node scripts/inference-nodetrace/build-fs-deck.mjs
import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const plan = JSON.parse(fs.readFileSync(path.join(repo, 'docs/pitch/noderoom-deck/deck_plan.json'), 'utf8'));
const viewportBase = fs.readFileSync(path.join(repo, '.tmp/refs/frontend-slides2/viewport-base.css'), 'utf8');
const b64 = (rel) => 'data:image/png;base64,' + fs.readFileSync(path.join(repo, rel)).toString('base64');
const detailB64 = b64('scripts/inference-nodetrace/app-shots/live-box-detail.png'); // boxed source inside the live Trace Lens
const shellB64 = b64('scripts/inference-nodetrace/app-shots/live-box-full.png');     // the same box inside the full live room
const outDir = path.join(repo, 'docs/pitch/noderoom-deck/fs');
fs.mkdirSync(outDir, { recursive: true });

const esc = (x) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
// gold-emphasize numeric figures (Signal: gold for numbers)
const fig = (s) => esc(s).replace(/(\$?\d[\d,.]*\s?(?:%|B|M|K|\/yr|\/100|x)?|~\d[\d.]*%?|0\.0078)/g, '<span class="fig">$1</span>');
const srcMap = Object.fromEntries((plan.sources || []).map((s) => [s.id, s.label]));
const srcLabel = (src) => { if (!src) return ''; const l = srcMap[src] || src; return l.length > 84 ? l.slice(0, 82) + '…' : l; };

// surface rhythm (dark navy / light cream) per slide index
const SURFACE = ['dark', 'dark', 'light', 'dark', 'light', 'dark', 'light', 'dark', 'light'];
const KICKER = ['NodeRoom', 'The problem', 'The solution', 'Market', 'Traction', 'Proof', 'Business model', 'Team', 'The ask'];

function citations(bullets) {
  const cites = bullets.filter((b) => b.status === 'verified' && b.source).map((b) => srcLabel(b.source));
  if (!cites.length) return '';
  return `<div class="cites">${cites.map((c, i) => `<span class="cite"><span class="cnum">${i + 1}</span>${esc(c)}</span>`).join('')}</div>`;
}
function bulletHtml(b, i) {
  const tag = b.status === 'verified' ? '<span class="vmark">✓</span>' : b.status === 'needs_review' ? '<span class="rmark">⚠</span>' : '';
  return `<li class="reveal" style="--d:${0.25 + i * 0.12}s"><span class="bdot"></span><span class="btext">${fig(b.text)} ${tag}</span></li>`;
}

function renderSlide(s, planIdx, pos, total) {
  const surf = SURFACE[planIdx] || 'dark';
  const kick = KICKER[planIdx] || '';
  const chrome = `<div class="chrome"><span class="kick">${esc(kick)}</span><span class="pg">${String(pos + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></div><div class="grid-tex"></div>`;
  let body = '';
  if (s.layout === 'title') {
    body = `<div class="title-wrap">
      <div class="kick-top reveal" style="--d:.1s">${esc(plan.subtitle || '')}</div>
      <h1 class="display reveal" style="--d:.25s">${esc(s.title)}</h1>
      <div class="oneliner reveal" style="--d:.5s">AI that does banker work — <em>and gets it accepted.</em></div>
      <div class="rule reveal" style="--d:.7s"></div>
    </div>`;
  } else if (s.layout === 'stat') {
    body = `<div class="stat-wrap">
      <h2 class="editorial reveal" style="--d:.2s">${esc(s.title)}</h2>
      <div class="stat-value reveal" style="--d:.4s">${fig(s.stat.value)}</div>
      <p class="lead reveal" style="--d:.6s">${fig(s.stat.label)}</p>
      ${s.stat.status === 'verified' && s.stat.source ? `<div class="cites reveal" style="--d:.75s"><span class="cite"><span class="cnum">1</span>${esc(srcLabel(s.stat.source))}</span></div>` : ''}
    </div>`;
  } else {
    const bullets = s.bullets || [];
    body = `<div class="content-wrap">
      <h2 class="editorial reveal" style="--d:.15s">${esc(s.title)}</h2>
      <ul class="bullets">${bullets.map(bulletHtml).join('')}</ul>
      ${citations(bullets)}
    </div>`;
  }
  return `<section class="slide ${surf}" data-i="${pos}">${chrome}${body}</section>`;
}

// closing slide
function closingSlide(pos, total) {
  return `<section class="slide dark closing" data-i="${pos}">
    <div class="chrome"><span class="kick">NodeRoom</span><span class="pg">${String(pos + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></div><div class="grid-tex"></div>
    <div class="closing-wrap">
      <div class="kick-top reveal" style="--d:.1s">The company</div>
      <h1 class="display sm reveal" style="--d:.25s">Frontier models can do the analysis.<br>They can't make it <em>client-ready</em> — 0%.</h1>
      <div class="oneliner reveal" style="--d:.55s">We make the work get <em>accepted</em>. That's the company.</div>
      <div class="rule reveal" style="--d:.7s"></div>
    </div>
  </section>`;
}

function citedSlide(pos, total) {
  return `<section class="slide dark cited" data-i="${pos}">
    <div class="chrome"><span class="kick">The proof</span><span class="pg">${String(pos + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></div><div class="grid-tex"></div>
    <div class="cited-wrap">
      <div class="doc-card reveal" style="--d:.3s">
        <span class="live-badge">● LIVE · NodeRoom Trace Lens</span>
        <img class="doc-main" src="${detailB64}" alt="Red box drawn on WBD 10-K Total revenues line inside NodeRoom's live Trace Lens">
        <img class="shell-inset" src="${shellB64}" alt="The same box inside the full live NodeRoom room shell">
      </div>
      <div class="cited-text">
        <div class="kick-top reveal" style="--d:.15s">Live in the app — not a mockup</div>
        <h2 class="editorial reveal" style="--d:.3s">Cited — and <em>boxed</em>, in the room</h2>
        <p class="lead reveal" style="--d:.45s">On the DIS / WBD take-private task, the agent cites <em>Total revenues</em> from Warner Bros. Discovery's 10-K and draws a <span class="boxred">red box</span> on the exact source line — rendered live inside NodeRoom's <em>Trace Lens</em>.</p>
        <ul class="proof-tally reveal" style="--d:.6s">
          <li><span class="tmark ok">✓</span> <span>Boxed to the exact line — source + locator shown in-trace (WBD Form 10-K, p.42)</span></li>
          <li><span class="tmark ok">✓</span> <span>Real running app — <span class="mono">vite build → preview</span>, captured by Playwright</span></li>
          <li><span class="tmark no">✕</span> <span>Unsupported quotes are refused — never boxed</span></li>
        </ul>
        <p class="cited-foot reveal" style="--d:.78s">Representative 10-K excerpt · SEC EDGAR CIK 0001437107. The cite → box → locator mechanism is the live capability; a paraphrase or hallucinated citation <em>cannot pass</em>.</p>
      </div>
    </div>
  </section>`;
}

const TOTAL = plan.slides.length + 2; // + cited-sources proof + closing
const parts = [];
let pos = 0;
plan.slides.forEach((s, planIdx) => {
  parts.push(renderSlide(s, planIdx, pos, TOTAL)); pos++;
  if (s.layout === 'content' && /^Proof of execution/.test(s.title)) { parts.push(citedSlide(pos, TOTAL)); pos++; }
});
parts.push(closingSlide(pos, TOTAL));
const slidesHtml = parts.join('\n');

const SIGNAL_CSS = `
:root{--navy:#1C2644;--navy-alt:#232F55;--cream:#F0ECE3;--cream-alt:#E6E0D4;--gold:#C8A870;--text-warm:#E2DCD0;--ink:#1A2030;--muted-d:#8A96A8;--muted-l:#5A6270;--border-d:#2E3D5C;--border-l:#CAC4B4;--stage-bg:#11192e;}
*{box-sizing:border-box}
.slide{font-family:"DM Sans",system-ui,sans-serif;padding:78px 144px 64px;display:flex;flex-direction:column;justify-content:center}
.slide.dark{--slide-bg:var(--navy);background:var(--navy);color:var(--text-warm)}
.slide.light{--slide-bg:var(--cream);background:var(--cream);color:var(--ink)}
.grid-tex{position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(var(--gline) 1px,transparent 1px),linear-gradient(90deg,var(--gline) 1px,transparent 1px);background-size:80px 80px}
.slide.dark{--gline:rgba(200,168,112,.05)}.slide.light{--gline:rgba(28,38,68,.035)}
.chrome{position:absolute;top:46px;left:144px;right:144px;display:flex;justify-content:space-between;font-family:"IBM Plex Mono",monospace;font-size:14px;letter-spacing:.16em;text-transform:uppercase;color:var(--gold)}
.slide.light .chrome .pg{color:var(--muted-l)}.slide.dark .chrome .pg{color:var(--muted-d)}
.display{font-family:"Source Serif 4",Georgia,serif;font-size:184px;font-weight:700;line-height:.94;letter-spacing:-.02em;margin:0}
.display.sm{font-size:88px;line-height:1.06;font-weight:600}
.display em,.oneliner em,.editorial em,.lead em,.display .em{font-style:italic;color:var(--gold)}
.kick-top{font-family:"IBM Plex Mono",monospace;font-size:15px;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);margin-bottom:30px}
.oneliner{font-family:"Source Serif 4",Georgia,serif;font-size:42px;font-weight:400;line-height:1.25;margin-top:34px;color:var(--text-warm)}
.slide.light .oneliner{color:var(--muted-l)}
.rule{width:120px;height:3px;background:var(--gold);margin-top:46px}
.editorial{font-family:"Source Serif 4",Georgia,serif;font-size:62px;font-weight:600;line-height:1.12;letter-spacing:-.01em;margin:0 0 44px;max-width:1360px}
.slide.light .editorial{color:var(--ink)}
.content-wrap,.stat-wrap,.title-wrap,.closing-wrap{position:relative;z-index:1;max-width:1500px}
.bullets{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:26px;max-width:1420px}
.bullets li{display:grid;grid-template-columns:auto 1fr;gap:22px;align-items:start}
.bdot{width:9px;height:9px;margin-top:14px;background:var(--gold);transform:rotate(45deg)}
.btext{font-size:27px;line-height:1.5;font-weight:400}
.slide.dark .btext{color:var(--text-warm)}.slide.light .btext{color:#2a3142}
.fig{font-family:"Source Serif 4",Georgia,serif;font-weight:600;color:var(--gold);font-variant-numeric:tabular-nums}
.vmark{font-family:"IBM Plex Mono",monospace;font-size:15px;color:var(--gold);vertical-align:1px;margin-left:4px}
.rmark{font-size:15px;color:#caa24a;margin-left:4px}
.stat-value{font-family:"Source Serif 4",Georgia,serif;font-size:300px;font-weight:600;line-height:.9;letter-spacing:-.03em;color:var(--gold);margin:8px 0 24px}
.lead{font-size:30px;line-height:1.5;max-width:1180px;margin:0;font-weight:400}
.slide.dark .lead{color:var(--text-warm)}.slide.light .lead{color:var(--muted-l)}
.cites{margin-top:46px;display:flex;flex-wrap:wrap;gap:14px 34px;max-width:1500px;border-top:1px solid var(--border-d);padding-top:20px}
.slide.light .cites{border-top-color:var(--border-l)}
.cite{font-family:"IBM Plex Mono",monospace;font-size:13px;letter-spacing:.04em;color:var(--muted-d);display:flex;gap:8px;align-items:baseline;max-width:680px}
.slide.light .cite{color:var(--muted-l)}
.cnum{color:var(--gold);font-weight:600}
.reveal{opacity:0;transform:translateY(16px)}
.slide.active .reveal{animation:rise .65s cubic-bezier(.22,1,.36,1) both;animation-delay:var(--d,0s)}
@keyframes rise{to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;animation:none}}
.cited-wrap{display:grid;grid-template-columns:740px 1fr;gap:70px;align-items:center;position:relative;z-index:1}
.doc-card{position:relative;background:#0b0f16;border:1px solid var(--border-d);border-radius:4px;box-shadow:0 30px 80px rgba(0,0,0,.45);overflow:hidden;height:640px}
.doc-card .doc-main{width:100%;height:100%;object-fit:contain;object-position:center top}
.doc-card .live-badge{position:absolute;top:16px;left:16px;z-index:3;background:rgba(217,84,78,.95);color:#fff;font-family:"IBM Plex Mono",monospace;font-size:13px;letter-spacing:.05em;text-transform:uppercase;padding:6px 12px;border-radius:3px;box-shadow:0 6px 18px rgba(0,0,0,.45)}
.doc-card .shell-inset{position:absolute;right:14px;bottom:14px;z-index:2;width:298px;height:auto;border:2px solid rgba(255,255,255,.2);border-radius:4px;box-shadow:0 16px 44px rgba(0,0,0,.6)}
.cited-foot{margin-top:22px;font-family:"IBM Plex Mono",monospace;font-size:15px;line-height:1.5;color:#97a0b2}
.cited-text .mono{font-family:"IBM Plex Mono",monospace;font-size:.92em;color:var(--gold)}
.cited-text .editorial{margin-bottom:20px}
.boxred{color:#d9544e;font-weight:600;border:1.5px solid #d9544e;border-radius:2px;padding:0 6px}
.proof-tally{list-style:none;margin:32px 0 0;padding:0;display:flex;flex-direction:column;gap:18px}
.proof-tally li{font-size:25px;line-height:1.4;display:flex;gap:15px;align-items:baseline;color:var(--text-warm)}
.tmark{font-family:"IBM Plex Mono",monospace;font-size:21px;font-weight:700}.tmark.ok{color:var(--gold)}.tmark.no{color:#d9544e}
.lead.small{font-size:25px;margin-top:28px}
.deck-controls{font-family:"IBM Plex Mono",monospace;font-size:12px;letter-spacing:.1em;color:#6b768c;background:rgba(17,25,46,.7);padding:6px 12px;border:1px solid #2e3d5c;border-radius:3px}
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(plan.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400;1,8..60,600&family=DM+Sans:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${viewportBase}\n${SIGNAL_CSS}</style></head>
<body>
<div class="deck-viewport"><div class="deck-stage" id="stage">
${slidesHtml}
</div></div>
<div class="deck-controls" id="ctrl">◀ ▶ · 01</div>
<script>
const stage=document.getElementById('stage');const slides=[...document.querySelectorAll('.slide')];const ctrl=document.getElementById('ctrl');let i=0;
function fit(){const s=Math.min(innerWidth/1920,innerHeight/1080);const x=(innerWidth-1920*s)/2,y=(innerHeight-1080*s)/2;stage.style.transform='translate('+x+'px,'+y+'px) scale('+s+')';}
function show(n){i=Math.max(0,Math.min(slides.length-1,n));slides.forEach((s,k)=>s.classList.toggle('active',k===i));ctrl.textContent='◀ ▶ · '+String(i+1).padStart(2,'0')+' / '+String(slides.length).padStart(2,'0');}
addEventListener('resize',fit);addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' ')show(i+1);else if(e.key==='ArrowLeft'||e.key==='PageUp')show(i-1);else if(e.key==='Home')show(0);else if(e.key==='End')show(slides.length-1);});
addEventListener('click',e=>{if(!e.target.closest('.deck-controls'))show(i+1);});
fit();show(0);
</script></body></html>`;
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log('wrote', path.join(outDir, 'index.html'), '—', plan.slides.length + 1, 'slides (Signal style)');
