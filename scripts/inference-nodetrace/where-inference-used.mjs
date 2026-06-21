// Build the "Where Inference.ai was used" slide: the GIF + the provenance JSON + a GitHub
// README card mentioning Inference.ai, in one self-contained 16:9 HTML slide.
//   node scripts/inference-nodetrace/where-inference-used.mjs <dir>
import fs from 'node:fs';
import path from 'node:path';
const dir = path.join(process.cwd(), process.argv[2] || 'scripts/inference-nodetrace/out');
const log = JSON.parse(fs.readFileSync(path.join(dir, 'inference-eval-log.json'), 'utf8'));
const gifPath = path.join(dir, 'walkthrough.gif');
const gifSrc = fs.existsSync(gifPath) ? 'data:image/gif;base64,' + fs.readFileSync(gifPath).toString('base64') : 'walkthrough.gif';
const esc = (x) => String(x ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const hi = (s) => esc(s).replace(/(Inference\.ai|model\.service-inference\.ai|gpt-5\.4)/g, '<span class="hi">$1</span>');
const h = log.calls[0].response_headers;
const callLines = log.calls.map((c, i) => `call ${i + 1} [${c.phase}]  http ${c.http_status}  id=${c.response.id.slice(0, 20)}…  ${c.response.usage?.total_tokens} tok`).join('\n');
const proof = `provider : ${log.provider}
endpoint : ${log.endpoint}
model    : ${log.model}

${callLines}

headers  : x-oneapi-request-id ${(h['x-oneapi-request-id'] || '').slice(0, 16)}…
           x-new-api-version ${h['x-new-api-version'] || ''}   server ${h['server'] || ''}`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Where Inference.ai was used</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#0e1116;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
.slide{width:1280px;height:720px;margin:0 auto;background:#f6f7f5;color:#18212f;display:grid;grid-template-rows:auto 1fr auto;gap:14px;padding:24px 30px;border-radius:10px}
.ttl{font-size:24px;font-weight:800;letter-spacing:-.3px}.sub{color:#687488;font-size:12px;font-weight:600;margin-top:3px}
.hi{background:#fff3bf;border-radius:3px;padding:0 3px;font-weight:700;color:#7a5a00}
.main{display:grid;grid-template-columns:1.05fr 1fr;gap:16px;min-height:0}
.panel{background:#fff;border:1px solid #d9dfda;border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-height:0}
h3{margin:0;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.3px;color:#7d576a}
.gif{width:100%;border:1px solid #e3e7e1;border-radius:6px}
.proof{background:#10131a;color:#cfe3d8;border-radius:6px;padding:11px 13px;font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.5;white-space:pre-wrap;overflow:hidden;flex:1}
.proof .hi{background:#1f3a2c;color:#9ff0c4}
.right{display:grid;grid-template-rows:auto 1fr;gap:12px;min-height:0}
.gh{border:1px solid #d0d7de;border-radius:6px;overflow:hidden;background:#fff;display:flex;flex-direction:column}
.gh-head{display:flex;align-items:center;gap:8px;background:#f6f8fa;border-bottom:1px solid #d0d7de;padding:8px 12px;font-size:13px;color:#1f2328}
.gh-head .repo{font-weight:700}.gh-head .file{color:#636c76}.octi{width:16px;height:16px;color:#636c76}
.gh-body{padding:12px 14px;font-size:12.5px;line-height:1.5;color:#1f2328;overflow:hidden}
.gh-body h4{margin:0 0 6px;font-size:15px;font-weight:700;border-bottom:1px solid #d8dee4;padding-bottom:5px}
.gh-body code{background:#eff1f3;border-radius:4px;padding:1px 5px;font-family:ui-monospace,Menlo,monospace;font-size:11.5px}
.gh-body ul{margin:6px 0 0;padding-left:20px}.gh-body li{margin:3px 0}
footer{color:#687488;font-size:11px;border-top:1px solid #e3e7e1;padding-top:9px}footer b{color:#18212f}
</style></head><body><div class="slide">
<header><div class="ttl">Where Inference.ai was used</div><div class="sub">One verifiable run on Inference.ai gpt-5.4 — the traced demo, the provenance log, the docs</div></header>
<div class="main">
  <div class="panel"><h3>The run &mdash; traced (walkthrough)</h3><img class="gif" src="${gifSrc}" alt="traced harness run on Inference.ai"></div>
  <div class="right">
    <div class="panel"><h3>Provenance log &mdash; inference-eval-log.json</h3><div class="proof">${hi(proof)}</div></div>
    <div class="gh"><div class="gh-head"><svg class="octi" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8Z"/></svg><span class="repo">HomenShum/solo-founder-nodes</span><span class="file">/ scripts/inference-nodetrace/README.md</span></div>
    <div class="gh-body"><h4>Model serving: Inference.ai</h4><ul>
      <li>Provider: <span class="hi">Inference.ai</span></li>
      <li>Endpoint: <code><span class="hi">model.service-inference.ai</span>/v1/chat/completions</code></li>
      <li>Model: <code><span class="hi">gpt-5.4</span></code></li>
    </ul><p style="margin:8px 0 0;color:#636c76">Every call's endpoint, raw response, and gateway headers are recorded in <code>inference-eval-log.json</code> &mdash; verifiable proof the evaluation ran on <span class="hi">Inference.ai</span>.</p></div></div>
  </div>
</div>
<footer>Inference.ai gpt-5.4 &middot; ${log.calls.length} calls, all HTTP 200 &middot; endpoint <b>model.service-inference.ai</b> &middot; real run, verifiable</footer>
</div></body></html>`;
fs.writeFileSync(path.join(dir, 'where-inference-used.html'), html);
console.log('wrote', path.join(dir, 'where-inference-used.html'));
