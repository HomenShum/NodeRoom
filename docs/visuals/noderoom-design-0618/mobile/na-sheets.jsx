/* ============================================================================
   NodeAgent Mobile — bottom sheets (Work Plan · Evidence · Coach)
   → window.NASheets
   ============================================================================ */
(function () {
  const { useState } = React;
  const NAIcon = window.NAIcon;
  const { Pill } = window.NAScreens;
  const D = window.NAD;
  const Ico = (name, props) => React.createElement(NAIcon, Object.assign({ name }, props || {}));

  function SheetHead({ title, sub, onClose }) {
    return React.createElement('div', { className: 'na-sheet-head' },
      React.createElement('div', { className: 'st' },
        React.createElement('strong', null, title),
        React.createElement('span', null, sub)),
      React.createElement('button', { className: 'na-close', onClick: onClose, 'aria-label': 'Close' }, Ico('x')));
  }

  function scopeBlock(variant, label, icon, items) {
    return React.createElement('div', { className: 'na-scope' },
      React.createElement('div', { className: 'na-scope-head ' + variant }, Ico(icon), label),
      React.createElement('ul', null, items.map((it, i) =>
        React.createElement('li', { key: i }, Ico(variant === 'wont' ? 'x' : 'check'), it))));
  }

  // ── WORK PLAN / APPROVAL ──────────────────────────────────────────────────
  function PlanSheet({ ctx }) {
    const P = D.PLAN;
    const run = ctx.runState; // 'plan' | 'running' | 'done'

    return React.createElement(React.Fragment, null,
      React.createElement(SheetHead, {
        title: 'Agent work plan',
        sub: P.entity + ' · read-only first',
        onClose: ctx.closeSheet,
      }),
      React.createElement('div', { className: 'na-sheet-body' },
        // status banner
        React.createElement('div', { className: 'na-card accent', 'data-accent-rule': run === 'done' ? 'ok' : null },
          React.createElement('div', { className: 'na-card-head accent' },
            React.createElement('div', { className: 'na-card-title' },
              React.createElement('strong', null,
                run === 'plan' ? 'Ready for review' : run === 'running' ? 'Research running' : 'Read-only run complete'),
              React.createElement('span', null,
                run === 'plan' ? 'Approve before any web read' : run === 'running' ? 'Gathering approved evidence' : 'Evidence attached · review the diff')),
            React.createElement(Pill, { tone: run === 'plan' ? 'warn' : run === 'running' ? 'accent' : 'ok',
              icon: run === 'done' ? 'check' : run === 'running' ? null : 'lock' },
              run === 'plan' ? 'approval' : run === 'running' ? 'running' : 'done')),
          run === 'running' && React.createElement('div', { className: 'na-card-body accent' },
            React.createElement('div', { className: 'na-skel' },
              React.createElement('i', null), React.createElement('i', { className: 's' })))),

        // scope
        scopeBlock('will', 'Will read', 'eye', P.willRead),
        scopeBlock('wont', 'Will not read', 'lock', P.wontRead),
        scopeBlock('create', 'Will create', 'plus', P.willCreate),

        // estimate
        React.createElement('div', { className: 'na-stats' },
          P.stats.map((s, i) => React.createElement('div', { key: i, className: 'na-stat' },
            React.createElement('b', { className: s.mono ? 'mono' : '' }, s.v),
            React.createElement('span', null, s.l)))),

        // plan hash
        React.createElement('div', { className: 'na-row', style: { borderTop: 'none' } },
          React.createElement('span', { className: 'ri' }, Ico('shield')),
          React.createElement('span', { className: 'rm' },
            React.createElement('strong', null, 'Approved plan hash'),
            React.createElement('span', null, 'Locks scope + cost before the job runs')),
          React.createElement('span', { className: 'rt' }, P.hash))),

      // footer actions
      React.createElement('div', { className: 'na-sheet-foot' },
        run === 'plan' && React.createElement(React.Fragment, null,
          React.createElement('button', { className: 'na-btn primary full', onClick: ctx.approveResearch },
            Ico('bolt'), 'Approve research'),
          React.createElement('div', { className: 'na-btn-row' },
            React.createElement('button', { className: 'na-btn', onClick: () => ctx.runReadOnly() }, Ico('eye'), 'Run read-only'),
            React.createElement('button', { className: 'na-btn ghost', onClick: ctx.closeSheet }, 'Edit scope'))),
        run === 'running' && React.createElement('button', { className: 'na-btn full', disabled: true },
          React.createElement('span', { className: 'na-pulsedot' }), 'Working inside approved scope…'),
        run === 'done' && React.createElement('button', { className: 'na-btn primary full', onClick: () => ctx.openSheet('evidence') },
          Ico('file'), 'Review evidence')));
  }

  // ── EVIDENCE PREVIEW ───────────────────────────────────────────────────────
  function EvidenceSheet({ ctx }) {
    const E = D.EVIDENCE;
    return React.createElement(React.Fragment, null,
      React.createElement(SheetHead, { title: 'Evidence', sub: 'Coverage for a single claim', onClose: ctx.closeSheet }),
      React.createElement('div', { className: 'na-sheet-body' },
        React.createElement('div', { className: 'na-card accent', 'data-accent-rule': 'warn' },
          React.createElement('div', { className: 'na-card-head accent' },
            React.createElement('div', { className: 'na-card-title' },
              React.createElement('strong', null, '“' + E.claim + '”'),
              React.createElement('span', null, 'Claim under review')),
            React.createElement(Pill, { tone: 'warn' }, React.createElement('span', { className: 'mono' }, E.status))),
          React.createElement('div', { className: 'na-card-body accent' },
            React.createElement('p', { className: 'na-prose', style: { margin: 0 } },
              'NodeRoom found ', React.createElement('b', null, 'two supporting sources'),
              ' but no primary confirmation of round size or lead investor.'))),

        React.createElement('div', { className: 'na-kicker' }, 'Source support'),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          E.support.map((s, i) => s.kind === 'gap'
            ? React.createElement('div', { key: i, className: 'na-cite gap' }, Ico('gap'), s.text)
            : React.createElement('div', { key: i, className: 'na-cite' },
                React.createElement('sup', null, s.n),
                s.text,
                React.createElement(Pill, { tone: s.verified ? 'ok' : 'mute' }, s.verified ? 'verified' : 'unverified'))))),

      React.createElement('div', { className: 'na-sheet-foot' },
        React.createElement('div', { className: 'na-btn-row' },
          React.createElement('button', { className: 'na-btn primary', onClick: () => { ctx.toast('Source search queued'); } }, Ico('search'), 'Search sources'),
          React.createElement('button', { className: 'na-btn', onClick: () => { ctx.toast('Follow-up created for Maya'); } }, Ico('plus'), 'Follow-up'))));
  }

  // ── COACH ──────────────────────────────────────────────────────────────────
  function CoachSheet({ ctx }) {
    const C = D.COACH;
    const [tab, setTab] = useState('howto');
    const [answer, setAnswer] = useState('');
    const [graded, setGraded] = useState(false);

    return React.createElement(React.Fragment, null,
      React.createElement(SheetHead, { title: 'Coach', sub: 'Review readiness · CardioNova', onClose: ctx.closeSheet }),
      React.createElement('div', { className: 'na-sheet-body' },
        React.createElement('div', { className: 'na-card', 'data-accent-rule': 'priv' },
          React.createElement('div', { className: 'na-card-body', style: { paddingTop: 'var(--na-pad)' } },
            React.createElement('p', { className: 'na-prose', style: { margin: 0 } }, C.question))),

        React.createElement('div', { className: 'na-tabs' },
          [['howto', 'How to answer'], ['answer', 'Your answer'], ['feedback', 'Feedback']].map(([id, lab]) =>
            React.createElement('button', { key: id, className: 'na-tab', 'data-active': tab === id, onClick: () => setTab(id) }, lab))),

        tab === 'howto' && React.createElement('div', { className: 'na-card' },
          React.createElement('div', { className: 'na-card-body', style: { paddingTop: 'var(--na-pad)' } },
            C.howto.map((h, i) => React.createElement('div', { key: i, className: 'na-row' },
              React.createElement('span', { className: 'ri', style: { fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--na-accent)', background: 'var(--na-accent-bg)' } }, i + 1),
              React.createElement('span', { className: 'rm' }, React.createElement('strong', { style: { whiteSpace: 'normal' } }, h)),
              React.createElement('span', null))))),

        tab === 'answer' && React.createElement(React.Fragment, null,
          React.createElement('textarea', {
            className: 'na-field', value: answer, placeholder: 'Explain it in your own words…',
            onChange: (e) => setAnswer(e.target.value),
          }),
          React.createElement('button', { className: 'na-btn primary full', disabled: !answer.trim(), onClick: () => { setGraded(true); setTab('feedback'); } },
            Ico('checkCircle'), 'Get feedback')),

        tab === 'feedback' && (graded
          ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              fbRow('checkCircle', 'ok', 'What went well', C.feedback.well),
              fbRow('target', 'warn', 'What you missed', C.feedback.missed),
              fbRow('link', 'accent', 'Source to cite', C.feedback.cite),
              React.createElement('div', { className: 'na-card', 'data-accent-rule': 'priv' },
                React.createElement('div', { className: 'na-card-head accent' },
                  React.createElement('div', { className: 'na-card-title' }, React.createElement('strong', null, 'Suggested wording')),
                  React.createElement(Pill, { tone: 'priv', icon: 'quote' }, 'model')),
                React.createElement('div', { className: 'na-card-body accent' },
                  React.createElement('p', { className: 'na-prose', style: { margin: 0, fontStyle: 'italic' } }, '“' + C.feedback.wording + '”'))))
          : React.createElement('div', { className: 'na-empty' },
              React.createElement('div', { className: 'eico' }, Ico('coach')),
              React.createElement('strong', null, 'Write an answer first'),
              React.createElement('span', null, 'Feedback compares your answer to the evidence on file.')))),
    );

    function fbRow(icon, tone, title, body) {
      const { riStyle } = window.NAScreens;
      return React.createElement('div', { className: 'na-card' },
        React.createElement('div', { className: 'na-card-body', style: { paddingTop: 'var(--na-pad)' } },
          React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'flex-start' } },
            React.createElement('span', { className: 'ri', style: riStyle(tone) }, Ico(icon)),
            React.createElement('div', { style: { minWidth: 0 } },
              React.createElement('div', { style: { fontSize: 12.5, fontWeight: 700, marginBottom: 3 } }, title),
              React.createElement('p', { className: 'na-prose', style: { margin: 0, fontSize: 13 } }, body)))));
    }
  }

  window.NASheets = { PlanSheet, EvidenceSheet, CoachSheet };
})();
