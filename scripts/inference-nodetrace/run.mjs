// Run ONE task through a real, traced harness loop on Inference.ai, capture the exact
// trace, grade the output with our deterministic grader, and emit nodetrace-state.json.
//
// Key is PROCESS-SCOPED: set INFERENCE_API_KEY in env. Never hardcode or commit it.
//   INFERENCE_API_KEY=sk-... node scripts/inference-nodetrace/run.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const KEY = process.env.INFERENCE_API_KEY;
if (!KEY) { console.error('Set INFERENCE_API_KEY (process-scoped).'); process.exit(1); }
const ENDPOINT = process.env.INFERENCE_BASE || 'https://model.service-inference.ai/v1/chat/completions';
const MODEL = process.env.INFERENCE_MODEL || 'gpt-5.4';

const repo = process.cwd();
const taskDir = path.join(repo, 'docs/eval/nonbtb/nb-01-company-profile');
const outDir = path.join(repo, 'scripts/inference-nodetrace/out');
fs.mkdirSync(outDir, { recursive: true });
const read = (p) => fs.readFileSync(p, 'utf8');
const prompt = read(path.join(taskDir, 'prompt.md'));
const fin = read(path.join(taskDir, 'source_financials.csv'));
const shares = read(path.join(taskDir, 'source_shares.txt'));
const rubric = JSON.parse(read(path.join(taskDir, 'rubric.json')));

const HONESTY = 'Honesty rules: every number must trace to a provided source; ratio cells must be LIVE FORMULAS (start with "="), not hardcoded literals; if a value is not derivable, omit it — never invent.';
const trace = [];
const evalLog = [];

async function call(phase, system, user) {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, messages: [
      { role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content ?? `(error: ${JSON.stringify(j).slice(0, 200)})`;
  evalLog.push({ phase, endpoint: ENDPOINT, model_requested: MODEL, http_status: res.status,
    response: { id: j.id, object: j.object, model: j.model, created: j.created, finish_reason: j.choices?.[0]?.finish_reason, usage: j.usage },
    response_headers: Object.fromEntries(res.headers.entries()), at: new Date().toISOString() });
  trace.push({ phase, durationMs: Date.now() - t0, usage: j.usage ?? {}, system, user, content });
  return content;
}
function extractJson(s) { const a = s.indexOf('{'), b = s.lastIndexOf('}'); return a >= 0 && b > a ? s.slice(a, b + 1) : s; }
const nowIso = () => new Date().toISOString();

// --- the harness loop: plan -> gather -> produce -> verify (each a real trace step) ---
await call('plan', 'You are a finance-analyst harness. Plan the deliverable before building. ' + HONESTY,
  `Task:\n${prompt}\n\nList the exact metrics to compute and which source each comes from. Be concise.`);

trace.push({ phase: 'gather', durationMs: 0, usage: {}, system: 'harness', user: 'read sources',
  content: `source_financials.csv:\n${fin}\nsource_shares.txt:\n${shares}` });

const produced = await call('produce',
  'You are a finance-analyst harness. Output ONLY a JSON object (no prose) mapping each metric key to {"value": <number>, "formula": "=...", "cite": {"file": "...", "locator": "..."}}. ' + HONESTY,
  `Task:\n${prompt}\n\nSources:\nsource_financials.csv:\n${fin}\nsource_shares.txt:\n${shares}\n\nRequired keys: ${rubric.allowed_keys.join(', ')}. Return the JSON object only.`);
let outputs = {};
try { outputs = JSON.parse(extractJson(produced)); } catch { /* empty -> honest low score */ }
fs.writeFileSync(path.join(outDir, 'outputs.json'), JSON.stringify(outputs, null, 2));

await call('verify', 'You are the verification node. Check each output against the honesty rules.',
  `Outputs:\n${JSON.stringify(outputs, null, 2)}\n\n${HONESTY}\nFor each metric: sourced? live formula? derivable from the sources? Report PASS/FAIL per metric, briefly.`);

// --- deterministic grade (our own grader) ---
let grade = { score: null };
try { grade = JSON.parse(execFileSync('python', ['docs/eval/nonbtb/grade.py', 'docs/eval/nonbtb/nb-01-company-profile', outDir], { encoding: 'utf8' })); }
catch (e) { grade = { score: null, error: String(e).slice(0, 200) }; }

// --- emit nodetrace-state.json (NodeTraceState shape + a few extensions) ---
const steps = trace.map((s, i) => ({ ...s, order: i + 1 }));
const totalTokens = steps.reduce((a, s) => a + (s.usage?.total_tokens || 0), 0);
const modelCalls = steps.filter((s) => s.usage?.total_tokens).length;
const state = {
  generatedAt: nowIso(),
  session: { id: 'inference-nb01', title: `Inference.ai ${MODEL} - nb-01 company profile (traced harness run)`,
    status: grade.score != null && grade.score >= 0.99 ? 'verified' : 'needs_review',
    summary: `One task run through the harness on Inference.ai ${MODEL}: ${modelCalls} model calls, ${totalTokens} tokens. Deterministic grade ${grade.score}.` },
  builderCapable: false, surfaces: [],
  proofs: Object.entries(outputs).map(([k, v], i) => {
    const exp = rubric.expected[k];
    const ok = !!exp && typeof v?.value === 'number' && Math.abs(v.value - exp.value) <= (exp.tol || 0);
    const isFormula = typeof v?.formula === 'string' && v.formula.trim().startsWith('=');
    return { id: `proof-${i}`, surfaceId: 'produce', title: k,
      status: ok && isFormula ? 'verified' : ok ? 'needs_review' : 'missing', confidence: ok ? 1 : 0,
      sourceLabel: v?.cite?.file || '(no cite)', detail: `value=${v?.value} formula=${v?.formula || '(none)'} ${ok ? 'matches golden' : 'differs from golden'}` };
  }),
  traces: steps.map((s) => ({ id: `trace-${s.order}`, surfaceId: s.phase, phase: s.phase,
    actor: s.phase === 'gather' ? 'harness' : MODEL, status: 'ok',
    summary: `${s.phase}: ${(s.content || '').slice(0, 110).replace(/\s+/g, ' ')}`, durationMs: s.durationMs, createdAt: nowIso() })),
  codeOwnership: [],
  coach: { mode: 'campaign', activeStepId: 'step-1', sourceRepo: 'inference-nodetrace', sourceMode: 'live',
    steps: steps.map((s) => ({ id: `step-${s.order}`, order: s.order, stepLabel: s.phase.toUpperCase(),
      title: `${s.order}. ${s.phase}`, narrative: (s.content || '').slice(0, 800), surfaceId: s.phase,
      meta: { tokens: s.usage?.total_tokens || 0, durationMs: s.durationMs, actor: s.phase === 'gather' ? 'harness' : MODEL },
      diagram: { kind: 'graph', nodeId: `n${s.order}`, source: '' } })),
    graphNodes: steps.map((s) => ({ id: `n${s.order}`, label: s.phase, kind: 'runtime', summary: `${s.usage?.total_tokens || 0} tok` })),
    graphEdges: steps.slice(1).map((s, i) => ({ id: `e${i}`, from: `n${i + 1}`, to: `n${i + 2}`, label: '' })) },
  grade,
};
fs.writeFileSync(path.join(outDir, 'nodetrace-state.json'), JSON.stringify(state, null, 2));
fs.writeFileSync(path.join(outDir, 'inference-eval-log.json'), JSON.stringify({ provider: 'Inference.ai', endpoint: ENDPOINT, model: MODEL, generatedAt: new Date().toISOString(), calls: evalLog }, null, 2));
console.log(`RUN DONE: ${trace.length} steps (${modelCalls} model calls), ${totalTokens} tokens, grade=${grade.score}`);
console.log(`PROVENANCE -> ${ENDPOINT} | ${evalLog.length} calls | response ids: ${evalLog.map((e) => e.response.id).join(', ')}`);
