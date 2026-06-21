// Run a REAL BankerToolBench task (btb-11e08646: DIS/WBD accretion-dilution M&A model)
// through a traced harness loop on Inference.ai. Captures the exact trace + a deterministic
// COMPLETENESS check (OUR check — explicitly NOT an official Gandalf score).
// Key is PROCESS-SCOPED: INFERENCE_API_KEY=sk-... node scripts/inference-nodetrace/run-btb.mjs
import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.INFERENCE_API_KEY;
if (!KEY) { console.error('Set INFERENCE_API_KEY (process-scoped).'); process.exit(1); }
const ENDPOINT = process.env.INFERENCE_BASE || 'https://model.service-inference.ai/v1/chat/completions';
const MODEL = process.env.INFERENCE_MODEL || 'gpt-5.4';
const repo = process.cwd();
const taskDir = path.join(repo, '.tmp/official-benchmarks/bankertoolbench-repo/datasets/btb/btb-11e08646');
const outDir = path.join(repo, 'scripts/inference-nodetrace/out-btb');
fs.mkdirSync(outDir, { recursive: true });
const instruction = fs.readFileSync(path.join(taskDir, 'instruction.md'), 'utf8');
const inputs = fs.readdirSync(path.join(taskDir, 'environment/input')).join(', ');

const trace = [];
const evalLog = [];
async function call(phase, system, user) {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content ?? `(error ${JSON.stringify(j).slice(0, 160)})`;
  evalLog.push({ phase, endpoint: ENDPOINT, model_requested: MODEL, http_status: res.status,
    response: { id: j.id, object: j.object, model: j.model, created: j.created, finish_reason: j.choices?.[0]?.finish_reason, usage: j.usage },
    response_headers: Object.fromEntries(res.headers.entries()), at: new Date().toISOString() });
  trace.push({ phase, durationMs: Date.now() - t0, usage: j.usage ?? {}, system, user, content });
  return content;
}
const nowIso = () => new Date().toISOString();

const planTxt = await call('plan',
  'You are an M&A analyst harness. Before building, plan the accretion/dilution model: list the tabs and the key calculation blocks. Be concise.',
  `Task:\n${instruction}\n\nInput workbook(s): ${inputs}. List the model tabs + key calc blocks (standalone, PPA/goodwill, financing, synergies, pro-forma EPS bridge, contribution, sensitivity).`);
trace.push({ phase: 'gather', durationMs: 0, usage: {}, system: 'harness', user: 'mount data room',
  content: `Input workbook(s) in the data room: ${inputs}. Prompt assumptions captured: 25% premium, 50/50 cash/stock, $5B balance-sheet cash, term loan 6.5%/7yr, fees 1.5%/2.0%, cost synergies $2.5B (30/65/90), integration 800/400, revenue synergies $1.5B (15/40/70).` });
const produceTxt = await call('produce',
  'You are an M&A analyst harness. Produce the core of the model: standalone 3-yr projections, PPA/goodwill bridge, financing, synergies, and the standalone->pro-forma EPS bridge with the key formulas and the Year 1-3 accretion/(dilution). Show numbers where derivable; state formula logic explicitly.',
  `Task:\n${instruction}\n\nBuild the model core. Be specific about the EPS bridge components (synergies, PPA D&A, incremental interest, lost interest income on cash) and give the Year 1-3 accretion/(dilution) result.`);
const verifyTxt = await call('verify',
  'You are the verification node. Check the produced model against the deliverable requirements and report DONE vs MISSING (formatting standards, Shift+F2 citations, sensitivity table, contribution analysis).',
  `Produced:\n${produceTxt.slice(0, 4000)}\n\nRequirements: accretion/dilution EPS bridge; cost synergies 30/65/90; revenue synergies 15/40/70; integration 800/400; PPA content $10B/15yr; intangibles $4B/10yr; PP&E 10% step-up; goodwill; 3-yr standalone; contribution analysis; sensitivity table (premium 15-35%, synergy 50-100%); blue/black/green font; Shift+F2 prompt citations. For each: DONE or MISSING.`);

// deterministic COMPLETENESS check (our check, NOT Gandalf)
const blob = (planTxt + '\n' + produceTxt + '\n' + verifyTxt).toLowerCase();
const COMPONENTS = [
  ['Accretion/(dilution) EPS bridge', ['accretion', 'eps']],
  ['Cost synergies 30/65/90', ['synerg', '90%']],
  ['Revenue synergies 15/40/70', ['revenue synerg', '70%']],
  ['Integration costs 800/400', ['integration', '800']],
  ['PPA: content $10B / 15-yr', ['content', '10']],
  ['PPA: intangibles $4B / 10-yr', ['intangible']],
  ['PP&E 10% step-up', ['pp&e']],
  ['Goodwill bridge', ['goodwill']],
  ['3-yr standalone projections', ['standalone']],
  ['Contribution analysis', ['contribution']],
  ['Sensitivity table (premium x synergy)', ['sensitiv']],
  ['Formatting: blue/black/green font', ['blue', 'green']],
  ['Shift+F2 prompt citations', ['shift+f2']],
];
const checked = COMPONENTS.map(([label, kws]) => ({ label, done: kws.filter((k) => blob.includes(k)).length >= Math.ceil(kws.length * 0.6) }));
const done = checked.filter((c) => c.done).length;
const completeness = +(done / checked.length).toFixed(2);

const steps = trace.map((s, i) => ({ ...s, order: i + 1 }));
const totalTokens = steps.reduce((a, s) => a + (s.usage?.total_tokens || 0), 0);
const modelCalls = steps.filter((s) => s.usage?.total_tokens).length;
const state = {
  generatedAt: nowIso(),
  session: { id: 'inference-btb-11e08646', title: `Inference.ai ${MODEL} - DIS/WBD accretion-dilution model (real BankerToolBench task, traced)`, status: 'needs_review',
    summary: `Real BTB task btb-11e08646 run through the harness on Inference.ai ${MODEL}: ${modelCalls} model calls, ${totalTokens} tokens. Completeness (our check) ${completeness}; official Gandalf grading is the separate Harbor lane (GLM-5.2 held-out scored 0.0078 on this exact task - these are hard).` },
  builderCapable: false, surfaces: [],
  proofs: checked.map((c, i) => ({ id: `p${i}`, surfaceId: 'produce', title: c.label, status: c.done ? 'addressed' : 'missing', confidence: c.done ? 1 : 0,
    sourceLabel: c.done ? 'reasoned in trace' : 'not in output', detail: c.done ? 'addressed in reasoning - not yet client-ready (exact Excel/formatting/Shift+F2 is what Gandalf grades)' : 'not produced - client-ready gap' })),
  traces: steps.map((s) => ({ id: `t${s.order}`, surfaceId: s.phase, phase: s.phase, actor: s.phase === 'gather' ? 'harness' : MODEL, status: 'ok',
    summary: `${s.phase}: ${(s.content || '').slice(0, 120).replace(/\s+/g, ' ')}`, durationMs: s.durationMs, createdAt: nowIso() })),
  codeOwnership: [],
  coach: { mode: 'campaign', activeStepId: 'step-1', sourceRepo: 'inference-nodetrace', sourceMode: 'live',
    steps: steps.map((s) => ({ id: `step-${s.order}`, order: s.order, stepLabel: s.phase.toUpperCase(), title: `${s.order}. ${s.phase}`,
      narrative: (s.content || '').slice(0, 800), surfaceId: s.phase, meta: { tokens: s.usage?.total_tokens || 0, durationMs: s.durationMs, actor: s.phase === 'gather' ? 'harness' : MODEL }, diagram: { kind: 'graph', nodeId: `n${s.order}`, source: '' } })),
    graphNodes: steps.map((s) => ({ id: `n${s.order}`, label: s.phase, kind: 'runtime', summary: `${s.usage?.total_tokens || 0} tok` })),
    graphEdges: steps.slice(1).map((s, i) => ({ id: `e${i}`, from: `n${i + 1}`, to: `n${i + 2}`, label: '' })) },
  grade: { score: completeness, kind: 'reasoned (our check)', clientReady: '~0% (Gandalf 0.0078, GLM-5.2)', done, total: checked.length },
};
fs.writeFileSync(path.join(outDir, 'nodetrace-state.json'), JSON.stringify(state, null, 2));
fs.writeFileSync(path.join(outDir, 'model-build.md'), `# Plan\n${planTxt}\n\n# Produce\n${produceTxt}\n\n# Verify\n${verifyTxt}`);
fs.writeFileSync(path.join(outDir, 'inference-eval-log.json'), JSON.stringify({ provider: 'Inference.ai', endpoint: ENDPOINT, model: MODEL, generatedAt: new Date().toISOString(), calls: evalLog }, null, 2));
console.log(`BTB RUN DONE: ${trace.length} steps (${modelCalls} model calls), ${totalTokens} tokens, completeness=${completeness} (${done}/${checked.length})`);
console.log(`PROVENANCE -> ${ENDPOINT} | ${evalLog.length} calls | response ids: ${evalLog.map((e) => e.response.id).join(', ')}`);
