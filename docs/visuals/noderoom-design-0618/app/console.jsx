/* ============================================================================
   Console view — the interactive "run a mission" centerpiece.
   3 panes: collaborative context · answer + notebook · runtime trace + sync lab
   Drives the real window.NA runtime; reveals each step with animation.
   Exports window.NAConsole
   ============================================================================ */
(function () {
  const { useState, useRef, useEffect, useCallback } = React;
  const I = window.NAIcon;
  const NA = window.NA;
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // step kind → icon + accent
  const STEP_ICON = { context: 'chat', synthesis: 'search', notebook: 'file', graph: 'graph', spreadsheet: 'table', privacy: 'shield' };

  // ── Sync engine shared by the mission run and the manual scenario buttons ──
  function fmtKey(k) { return k ? k.slice(0, 9) + '…' + k.slice(-3) : '—'; }

  // Canonical agent delta — fixed payload so idempotency hashing is deterministic
  // regardless of the includePrivate toggle (the demo's duplicate/conflict
  // scenarios depend on byte-identical requests).
  const AGENT_OPS = [
    { type: 'set_cell', rowId: 'r_revenue', columnIndex: 2, value: 0.79 },
    { type: 'insert_row', afterRowId: 'r_revenue', row: { id: 'r_agent_note', cells: ['Agent synthesis', 'NodeAgent synthesis summary', null] } },
  ];
  const agentReq = (prevVersion) => ({
    sheetId: 'sheet_nodeagent_demo', previousVersion: prevVersion,
    source: 'NodeAgent demo provider', actor: 'nodeagent',
    reason: 'Preview a finance delta from synthesis.', providerDeltaId: 'demo_delta_001',
    operations: AGENT_OPS,
  });
  const AGENT_KEY = NA.generateIdempotencyKey(agentReq(41));

  // ── Context pane (left) ────────────────────────────────────────────────────
  function ContextPane({ seed, includePrivate, setIncludePrivate, mission, setMission, contextLit, running, phase }) {
    const tagOf = (m) => m.visibility === 'private' ? ['prv', 'private'] : m.source === 'agent' ? ['agn', '/ask'] : ['pub', 'public'];
    const avOf = (m) => m.source === 'agent' ? 'a' : m.author === 'Homen' ? 'h' : 'u';
    return (
      React.createElement('div', { className: 'na-pane left' },
        React.createElement('div', { className: 'na-pane-h' },
          React.createElement('span', { className: 'na-kicker' }, 'Collaborative context'),
          contextLit && React.createElement('span', { className: 'na-badge applied fade-in' },
            React.createElement('span', { className: 'bd' }),
            (includePrivate ? seed.chatMessages.length : seed.chatMessages.filter((m) => m.visibility !== 'private').length) + ' in pack'),
        ),
        React.createElement('div', { className: 'na-pane-body' },
          seed.chatMessages.map((m) => {
            const [cls, label] = tagOf(m);
            const isPrivate = m.visibility === 'private';
            const dimmed = isPrivate && !includePrivate;
            const lit = contextLit && !dimmed;
            return React.createElement('div', { key: m.id, className: 'na-msg' + (lit ? ' lit' : ''), style: { opacity: dimmed ? 0.4 : 1 } },
              React.createElement('div', { className: 'na-av ' + avOf(m) }, isPrivate ? 'H' : m.source === 'agent' ? 'AI' : 'FL'),
              React.createElement('div', { className: 'na-msg-b' },
                React.createElement('div', { className: 'na-msg-h' },
                  React.createElement('span', { className: 'na-msg-name' }, m.author),
                  React.createElement('span', { className: 'na-tag ' + cls },
                    isPrivate && React.createElement(I.lock, { size: 9 }), label),
                  dimmed && React.createElement('span', { className: 'na-mono-faint' }, 'excluded'),
                ),
                React.createElement('div', { className: 'na-msg-t' + (isPrivate ? ' priv' : '') + (m.source === 'agent' ? ' mono' : '') },
                  m.source === 'agent' ? m.text.replace('/ask ', '') : m.text),
              ),
            );
          }),
          React.createElement('div', { className: 'divider', style: { margin: '14px 0' } }),
          React.createElement('div', { className: 'na-kicker', style: { marginBottom: 8 } }, 'Candidate documents'),
          seed.documents.map((d) => {
            const isPrivate = d.visibility === 'private';
            const dimmed = isPrivate && !includePrivate;
            return React.createElement('div', { key: d.id, className: 'row', style: { gap: 9, padding: '5px 0', opacity: dimmed ? 0.4 : 1 } },
              React.createElement('span', { className: 'na-cite-k mono', style: { width: 30 } }, d.kind),
              React.createElement('span', { className: 'sm', style: { color: 'var(--text-secondary)', flex: 1, lineHeight: 1.3 } }, d.title.split(' — ')[0]),
              isPrivate && React.createElement('span', { className: 'na-tag prv' }, React.createElement(I.lock, { size: 9 }), 'priv'),
            );
          }),
        ),
        React.createElement('div', { className: 'na-pane-foot' },
          React.createElement('div', { className: 'na-composer' },
            React.createElement('div', { className: 'na-kicker', style: { marginBottom: 7 } }, 'Mission'),
            React.createElement('textarea', { value: mission, onChange: (e) => setMission(e.target.value), rows: 3, disabled: running }),
            React.createElement('div', { className: 'na-composer-row' },
              React.createElement('div', { className: 'na-toggle', 'data-on': String(includePrivate), onClick: () => !running && setIncludePrivate((v) => !v) },
                React.createElement('span', { className: 'na-switch' }),
                React.createElement('span', { className: 'na-toggle-l' }, 'includePrivate'),
              ),
              React.createElement('span', { className: 'na-mono-faint' }, running ? 'running…' : 'ready'),
            ),
          ),
        ),
      )
    );
  }

  // ── Center: answer + notebook ──────────────────────────────────────────────
  function CenterPane({ plan, doneSteps, activeStep, includePrivate }) {
    const has = (s) => doneSteps.has(s);
    if (!plan) {
      return React.createElement('div', { className: 'na-center' },
        React.createElement('div', { className: 'na-empty' },
          React.createElement('div', { className: 'na-empty-ico' }, React.createElement(I.bolt, { size: 26 })),
          React.createElement('h3', null, 'Run a mission'),
          React.createElement('p', null, 'NodeAgent gathers collaborative context, searches and synthesizes a grounded answer, writes notebook blocks, then proposes a spreadsheet delta — committed through bounded tools.'),
        ),
      );
    }
    const { answer, notebook, publicSources, privateSources } = plan;
    const privacyDone = has('privacy');
    return (
      React.createElement('div', { className: 'na-center' },
        // answer packet
        has('synthesis') && React.createElement('div', { className: 'na-card fade-in' },
          React.createElement('div', { className: 'na-card-h' },
            React.createElement('div', { className: 'na-card-title' },
              React.createElement('span', { className: 'na-ico-badge', style: { background: '#D97757' } }, React.createElement(I.bolt, { size: 15 })),
              'Agent answer'),
            React.createElement('span', { className: 'na-badge applied' }, React.createElement('span', { className: 'bd' }), 'confidence ' + answer.confidence.toFixed(2)),
          ),
          React.createElement('div', { className: 'na-card-b' },
            React.createElement('div', { className: 'na-answer-txt' },
              'Found ' + answer.sources.length + ' relevant source(s) and synthesized a grounded answer. The response cites the selected source bundle and preserves the public / private boundary',
              React.createElement('span', { className: 'na-sup' }, publicSources.map((_, i) => '[' + (i + 1) + ']').join('')), '.'),
            React.createElement('div', { className: 'na-cites' },
              publicSources.map((s, i) => React.createElement('div', { key: s.id, className: 'na-cite' },
                React.createElement('div', { className: 'na-cite-n' }, i + 1),
                React.createElement('div', { className: 'na-cite-t' }, s.title),
                React.createElement('div', { className: 'na-cite-k' }, s.kind),
              )),
              privateSources.map((s) => React.createElement('div', { key: s.id, className: 'na-cite', style: { opacity: privacyDone ? 0.6 : 1 } },
                React.createElement('div', { className: 'na-cite-n', style: { background: 'rgba(140,110,210,.16)', color: '#B49BE0' } }, React.createElement(I.lock, { size: 11 })),
                React.createElement('div', { className: 'na-cite-t', style: privacyDone ? { textDecoration: 'line-through', color: 'var(--text-faint)' } : null }, s.title),
                React.createElement('div', { className: 'na-cite-k' }, privacyDone ? 'withheld' : 'private'),
              )),
            ),
            privacyDone && privateSources.length > 0 && React.createElement('div', { className: 'row fade-in', style: { gap: 8, marginTop: 12 } },
              React.createElement('span', { className: 'na-badge warn' }, React.createElement('span', { className: 'bd' }), 'boundary'),
              React.createElement('span', { className: 'tiny muted' }, privateSources.length + ' private candidate withheld from public citations — captured as needs_review.'),
            ),
          ),
        ),
        // notebook
        has('notebook') && React.createElement('div', { className: 'na-card fade-in' },
          React.createElement('div', { className: 'na-card-h' },
            React.createElement('div', { className: 'na-card-title' },
              React.createElement('span', { className: 'na-ico-badge', style: { background: '#5E6AD2' } }, React.createElement(I.file, { size: 15 })),
              'Notebook'),
            React.createElement('span', { className: 'na-mono-faint' }, 'tiptap · ' + notebook.id),
          ),
          React.createElement('div', { className: 'na-card-b' },
            React.createElement('div', { className: 'na-nb' },
              notebook.blocks.map((b, i) => React.createElement('div', { key: b.id, className: 'na-block' + (b.type !== 'heading' ? ' agent' : '') + (i === notebook.blocks.length - 1 ? ' wet' : '') },
                b.type === 'heading'
                  ? React.createElement('div', { className: 'na-block-h' }, b.text)
                  : React.createElement('div', { className: 'na-block-p' }, b.text),
                b.type !== 'heading' && React.createElement('div', { className: 'na-block-meta' },
                  React.createElement('span', { className: 'na-badge ' + (b.status === 'needs_review' ? 'warn' : 'applied') },
                    React.createElement('span', { className: 'bd' }), b.status),
                  React.createElement('span', { className: 'na-mono-faint' }, 'sources · ' + (b.sourceIds.join(' · ') || '—')),
                ),
              )),
              // private-derived needs_review block appears once privacy ran
              includePrivate && privacyDone && React.createElement('div', { className: 'na-block agent wet fade-in' },
                React.createElement('div', { className: 'na-block-p', style: { color: 'var(--text-muted)' } }, 'Null cells persist as real blank values through versioned sync.'),
                React.createElement('div', { className: 'na-block-meta' },
                  React.createElement('span', { className: 'na-badge warn' }, React.createElement('span', { className: 'bd' }), 'needs_review'),
                  React.createElement('span', { className: 'na-mono-faint' }, 'from private note · not in public output'),
                ),
              ),
            ),
          ),
        ),
        // graph chip
        has('graph') && React.createElement('div', { className: 'na-card fade-in', style: { padding: '14px 18px' } },
          React.createElement('div', { className: 'row between' },
            React.createElement('div', { className: 'row', style: { gap: 10 } },
              React.createElement('span', { className: 'na-ico-badge', style: { background: 'rgba(217,119,87,.16)', color: '#D97757', width: 24, height: 24 } }, React.createElement(I.graph, { size: 13 })),
              React.createElement('div', null,
                React.createElement('div', { className: 'sm', style: { fontWeight: 600 } }, '@LiveFlow'),
                React.createElement('div', { className: 'na-mono-faint' }, 'company · 1 claim verified · 2 backlinks · depth 1'),
              ),
            ),
            React.createElement('span', { className: 'na-badge idle' }, 'graph notebook'),
          ),
        ),
      )
    );
  }

  // ── Right: runtime trace + sync lab ────────────────────────────────────────
  function TracePane({ steps, stepState, onRun, running, phase, done }) {
    return (
      React.createElement('div', null,
        React.createElement('div', { className: 'na-pane-h' },
          React.createElement('span', { className: 'na-kicker' }, 'Runtime trace'),
          done && React.createElement('span', { className: 'na-badge applied' }, React.createElement('span', { className: 'bd' }), '6 steps'),
        ),
        React.createElement('ul', { className: 'na-trace', style: { padding: '0 4px' } },
          steps.map((s) => {
            const st = stepState[s.id] || 'pending';
            return React.createElement('li', { key: s.id, className: 'na-tstep', 'data-state': st },
              React.createElement('span', { className: 'na-tdot' }),
              React.createElement('div', { className: 'na-tstep-b' },
                React.createElement('div', { className: 'na-tstep-n' }, s.name,
                  st === 'active' && React.createElement('span', { className: 'na-tspin' })),
                React.createElement('div', { className: 'na-tstep-k' }, s.tool ? s.tool : s.kind, st === 'done' ? ' · ok' : st === 'active' ? ' · running' : ''),
              ),
            );
          }),
        ),
      )
    );
  }

  function SyncLab({ lab, fireScenario, resetLab }) {
    const { result, log, store, applied } = lab;
    const sheet = store.sheet;
    const scns = [
      { id: 'apply', cls: 'applied', n: '1', t: 'Agent applies delta', d: 'set_cell confidence + insert agent row. prevVersion = current.', tool: 'apply_spreadsheet_delta', need: false },
      { id: 'retry', cls: 'dup', n: '2', t: 'Provider retries (identical)', d: 'Same request replayed → idempotency returns the saved result.', tool: 'idempotency · duplicate', need: true },
      { id: 'tamper', cls: 'fail', n: '3', t: 'Replay, tampered payload', d: 'Same idempotencyKey, different operations → key conflict.', tool: 'requestHash mismatch', need: true },
      { id: 'stale', cls: 'fail', n: '4', t: 'Stale delta (prevVersion 40)', d: 'Optimistic concurrency rejects an out-of-date write.', tool: 'version_conflict', need: true },
    ];
    return (
      React.createElement('div', null,
        React.createElement('div', { className: 'na-pane-h', style: { paddingTop: 20 } },
          React.createElement('span', { className: 'na-kicker' }, 'Spreadsheet sync · bounded tool'),
          React.createElement('button', { className: 'na-iconbtn', style: { width: 28, height: 28 }, title: 'Reset store', onClick: resetLab },
            React.createElement(I.replay, { size: 14 })),
        ),
        // store + sheet
        React.createElement('div', { style: { padding: '0 4px 4px' } },
          React.createElement('div', { className: 'row between', style: { marginBottom: 10 } },
            React.createElement('span', { className: 'na-vflow' },
              React.createElement('span', { className: 'na-vpill' }, 'v' + (result ? result.previousVersion : sheet.version)),
              React.createElement(I.arrow, { size: 13, style: { color: 'var(--text-faint)' } }),
              React.createElement('span', { className: 'na-vpill next' }, 'v' + sheet.version)),
            React.createElement('span', { className: 'na-mono-faint' }, store.idempotencyRecords.size + ' idem record(s)'),
          ),
          React.createElement('table', { className: 'na-sheet' },
            React.createElement('thead', null, React.createElement('tr', null,
              React.createElement('th', null, 'row'), React.createElement('th', null, 'label'),
              React.createElement('th', { style: { textAlign: 'right' } }, 'value'), React.createElement('th', { style: { textAlign: 'right' } }, 'col 2'))),
            React.createElement('tbody', null,
              sheet.rows.map((r) => {
                const isNew = r.id === 'r_agent_note';
                const changed = r.id === 'r_revenue' && r.cells[2] != null;
                return React.createElement('tr', { key: r.id, className: (isNew ? 'new' : '') + (changed ? ' changed' : '') },
                  React.createElement('td', { className: 'rid' }, r.id),
                  React.createElement('td', null, String(r.cells[0])),
                  React.createElement('td', { className: 'num' }, typeof r.cells[1] === 'number' ? r.cells[1].toLocaleString() : (isNew ? 'synthesis…' : String(r.cells[1]))),
                  r.cells[2] == null ? React.createElement('td', { className: 'nul' }, 'null') : React.createElement('td', { className: 'num' }, String(r.cells[2])),
                );
              }),
            ),
          ),
        ),
        // result envelope
        result && React.createElement('div', { className: 'na-card fade-in', style: { margin: '12px 4px', padding: '12px 14px' }, key: log.length },
          React.createElement('div', { className: 'row between', style: { marginBottom: 10 } },
            React.createElement('span', { className: 'na-mono-faint' }, 'tool result'),
            React.createElement('span', { className: 'na-badge ' + result.status }, React.createElement('span', { className: 'bd' }), result.status),
          ),
          React.createElement('dl', { className: 'na-kv' },
            React.createElement('dt', null, 'previousVersion'), React.createElement('dd', null, result.previousVersion),
            React.createElement('dt', null, 'nextVersion'), React.createElement('dd', { className: 'acc' }, result.nextVersion),
            React.createElement('dt', null, 'idempotencyKey'), React.createElement('dd', null, fmtKey(result.idempotencyKey)),
            React.createElement('dt', null, 'providerDeltaId'), React.createElement('dd', null, result.providerDeltaId || '—'),
            React.createElement('dt', null, 'affectedRange'), React.createElement('dd', null, '[' + result.affectedRange.rowIds.length + ' rows · cols ' + (result.affectedRange.columns.join(',') || '—') + ']'),
          ),
        ),
        // scenarios
        React.createElement('div', { style: { padding: '4px 4px 8px' } },
          React.createElement('div', { className: 'na-kicker', style: { margin: '6px 0 10px' } }, 'Fire a request'),
          React.createElement('div', { className: 'na-scn' },
            scns.map((s) => React.createElement('button', { key: s.id, className: 'na-scn-btn ' + s.cls, disabled: s.need && !applied, onClick: () => fireScenario(s.id) },
              React.createElement('span', { className: 'na-scn-n' }, s.n),
              React.createElement('span', { style: { flex: 1 } },
                React.createElement('div', { className: 'na-scn-t' }, s.t),
                React.createElement('div', { className: 'na-scn-d' }, s.d),
                React.createElement('div', { className: 'na-scn-tool mono' }, s.tool),
              ),
            )),
          ),
        ),
        // log
        log.length > 0 && React.createElement('div', { style: { padding: '4px 4px 16px' } },
          React.createElement('div', { className: 'na-kicker', style: { margin: '8px 0 8px' } }, 'Attempt log'),
          React.createElement('div', { className: 'na-log' },
            log.slice().reverse().map((l, i) => React.createElement('div', { key: log.length - i, className: 'na-logrow' },
              React.createElement('span', { className: 'na-badge ' + l.status, style: { padding: '2px 8px', fontSize: 9.5 } }, React.createElement('span', { className: 'bd' }), l.status),
              React.createElement('span', { className: 'sm', style: { color: 'var(--text-secondary)' } }, l.label),
              React.createElement('span', { className: 'na-log-key' }, 'v' + l.nextVersion),
            )),
          ),
        ),
      )
    );
  }

  // ── Orchestrator ───────────────────────────────────────────────────────────
  function NAConsole({ scope }) {
    const seed = useRef(NA.seedDemoState()).current;
    const [mission, setMission] = useState('Find the right source on live spreadsheet sync, summarize it into the notebook, and preview the spreadsheet impact.');
    const [includePrivate, setIncludePrivate] = useState(scope === 'private');
    useEffect(() => { setIncludePrivate(scope === 'private'); }, [scope]);
    const [plan, setPlan] = useState(null);
    const [stepState, setStepState] = useState({});
    const [doneSteps, setDoneSteps] = useState(new Set());
    const [activeStep, setActiveStep] = useState(null);
    const [running, setRunning] = useState(false);
    const [phase, setPhase] = useState(0);
    const timers = useRef([]);

    // sync lab store (shared)
    const [lab, setLab] = useState(() => ({ store: NA.newStore(JSON.parse(JSON.stringify(seed.sheet))), result: null, log: [], applied: false, savedKey: null }));

    const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
    useEffect(() => () => clearTimers(), []);

    // expose run trigger to parent (top bar button)
    const runStep = (delay) => new Promise((res) => {
      const base = window.__naStepMs || 820;
      const ms = prefersReduced ? 0 : (delay >= 800 ? base : Math.round(base * (delay / 820)));
      const t = setTimeout(res, ms); timers.current.push(t);
    });

    const buildPlan = useCallback(() => {
      const ctx = NA.collectCollaborativeContext({ question: mission, chatMessages: seed.chatMessages, documents: seed.documents, includePrivate });
      const answer = NA.searchAndSynthesize(ctx);
      const notebook = NA.createNotebookFromAnswer(answer);
      const privateSources = answer.sources.filter((s) => s.visibility === 'private');
      const publicSources = answer.sources.filter((s) => s.visibility !== 'private');
      return { ctx, answer, notebook, privateSources, publicSources };
    }, [mission, includePrivate, seed]);

    const run = useCallback(async () => {
      clearTimers();
      const freshSheet = JSON.parse(JSON.stringify(seed.sheet));
      const store = NA.newStore(freshSheet);
      setLab({ store, result: null, log: [], applied: false, savedKey: null });
      const p = buildPlan();
      setPlan(p);
      setDoneSteps(new Set()); setStepState({}); setActiveStep(null);
      setRunning(true); setPhase(1);

      for (let i = 0; i < NA.STEP_DEFS.length; i++) {
        const step = NA.STEP_DEFS[i];
        setActiveStep(step.id);
        setStepState((s) => ({ ...s, [step.id]: 'active' }));
        await runStep(820);
        // side-effect: spreadsheet step commits the agent delta through the tool
        if (step.id === 'spreadsheet') {
          const req = agentReq(store.sheet.version);
          const result = NA.applyVersionedSpreadsheetSync(store, req);
          setLab((L) => ({ ...L, store, result, applied: true, savedKey: AGENT_KEY, log: [...L.log, { status: result.status, label: 'Agent applies delta', nextVersion: result.nextVersion }] }));
        }
        setStepState((s) => ({ ...s, [step.id]: 'done' }));
        setDoneSteps((d) => new Set([...d, step.id]));
        await runStep(180);
      }
      setActiveStep(null); setRunning(false); setPhase(7);
    }, [buildPlan, seed]);

    // register run handler so the top-bar button (in shell) can call it
    useEffect(() => { window.__naRun = run; window.__naRunning = running; }, [run, running]);
    useEffect(() => { window.dispatchEvent(new CustomEvent('na-state', { detail: { running, phase } })); }, [running, phase]);

    // ── manual scenarios on the lab store ────────────────────────────────────
    const fireScenario = useCallback((id) => {
      setLab((L) => {
        const store = L.store;
        let req, label;
        if (id === 'apply') {
          req = agentReq(store.sheet.version); label = 'Agent applies delta';
          const result = NA.applyVersionedSpreadsheetSync(store, req);
          return { ...L, result, applied: true, savedKey: AGENT_KEY, log: [...L.log, { status: result.status, label, nextVersion: result.nextVersion }] };
        }
        if (id === 'retry') {
          // identical request to the original apply (prevVersion 41) → duplicate
          req = agentReq(41); label = 'Provider retries (identical)';
        } else if (id === 'tamper') {
          // same explicit idempotencyKey, different payload → idempotency_key_conflict
          req = { sheetId: 'sheet_nodeagent_demo', previousVersion: 41, source: 'NodeAgent demo provider', actor: 'nodeagent', reason: 'Tampered replay', providerDeltaId: 'demo_delta_001', idempotencyKey: AGENT_KEY, operations: [{ type: 'set_cell', rowId: 'r_revenue', columnIndex: 2, value: 0.99 }] };
          label = 'Replay, tampered payload';
        } else if (id === 'stale') {
          // brand-new key, but prevVersion stale → version_conflict
          req = { sheetId: 'sheet_nodeagent_demo', previousVersion: 40, source: 'External provider', actor: 'provider_sync', reason: 'Stale delta', providerDeltaId: 'delta_stale_x', operations: [{ type: 'set_cell', rowId: 'r_cogs', columnIndex: 1, value: 4200 }] };
          label = 'Stale delta (prevVersion 40)';
        }
        const result = NA.applyVersionedSpreadsheetSync(store, req);
        return { ...L, result, log: [...L.log, { status: result.status, label, nextVersion: result.nextVersion }] };
      });
    }, []);

    const resetLab = useCallback(() => {
      const store = NA.newStore(JSON.parse(JSON.stringify(seed.sheet)));
      setLab({ store, result: null, log: [], applied: false, savedKey: null });
    }, [seed]);

    return (
      React.createElement('div', { className: 'na-console' },
        React.createElement(ContextPane, { seed, includePrivate, setIncludePrivate, mission, setMission, contextLit: doneSteps.has('context'), running, phase }),
        React.createElement('div', { className: 'na-pane' },
          React.createElement(CenterPane, { plan, doneSteps, activeStep, includePrivate }),
        ),
        React.createElement('div', { className: 'na-pane right' },
          React.createElement('div', { className: 'na-pane-body', style: { padding: '0 14px 24px' } },
            React.createElement(TracePane, { steps: NA.STEP_DEFS, stepState, running, phase, done: phase === 7 }),
            React.createElement('div', { className: 'divider', style: { margin: '16px 4px' } }),
            React.createElement(SyncLab, { lab, fireScenario, resetLab }),
          ),
        ),
      )
    );
  }

  window.NAConsole = NAConsole;
})();
