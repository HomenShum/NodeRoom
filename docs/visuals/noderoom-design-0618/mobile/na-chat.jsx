/* ============================================================================
   NodeAgent Mobile — collaboration surfaces
   Room chat (Slack-style) · Agent command convo (ChatGPT-style) · universal
   mode-aware Composer with voice-to-text · Jobs sheet.
   → window.NAChat
   ============================================================================ */
(function () {
  const NAIcon = window.NAIcon;
  const D = window.NAD;
  const { Pill } = window.NAScreens;
  const Ico = (name, props) => React.createElement(NAIcon, Object.assign({ name }, props || {}));

  // highlight @mentions
  function withMentions(text) {
    return text.split(/(@\w+)/).map((part, i) =>
      part[0] === '@'
        ? React.createElement('span', { key: i, className: 'mention' }, part)
        : part);
  }

  // ── ROOM CHAT ─────────────────────────────────────────────────────────────
  function RoomChat({ ctx }) {
    const P = D.PEOPLE;
    const msgs = ctx.roomMsgs;

    const avatar = (who) => React.createElement('span', {
      className: 'na-av', style: { background: (P[who] || {}).color || 'var(--bg-hover)' },
    }, (P[who] || {}).short || '?');

    const head = (who, t) => React.createElement('div', { className: 'na-rmsg-head' },
      React.createElement('strong', { className: P[who] && P[who].agent ? 'who-agent' : '' }, (P[who] || {}).name || who),
      React.createElement('time', null, t));

    return React.createElement('div', { className: 'na-feed' },
      msgs.map((m) => {
        if (m.kind === 'msg') return React.createElement('div', { key: m.id, className: 'na-rmsg' },
          avatar(m.who),
          React.createElement('div', { className: 'na-rmsg-main' }, head(m.who, m.t),
            React.createElement('div', { className: 'na-rmsg-text' }, withMentions(m.text))));

        if (m.kind === 'status') return React.createElement('div', { key: m.id, className: 'na-rmsg agent' },
          avatar(m.who),
          React.createElement('div', { className: 'na-rmsg-main' }, head(m.who, m.t),
            React.createElement('div', { className: 'na-status' },
              React.createElement('span', { className: 'na-pulsedot' }), m.text)));

        if (m.kind === 'summary') return React.createElement('div', { key: m.id, className: 'na-rmsg agent' },
          avatar(m.who),
          React.createElement('div', { className: 'na-rmsg-main' }, head(m.who, m.t),
            React.createElement('div', { className: 'na-rmsg-text' }, m.text),
            React.createElement('div', { className: 'na-stats', style: { marginTop: 9 } },
              m.stats.map((s, i) => React.createElement('div', { key: i, className: 'na-stat' },
                React.createElement('b', { className: 'mono', style: { fontSize: 13 } }, s.v),
                React.createElement('span', null, s.l))))));

        if (m.kind === 'artifact') return React.createElement('div', { key: m.id, className: 'na-rmsg agent' },
          avatar(m.who),
          React.createElement('div', { className: 'na-rmsg-main' }, head(m.who, m.t),
            React.createElement('button', { className: 'na-artlink', onClick: () => ctx.openRow() },
              React.createElement('span', { className: 'ai' }, Ico('table')),
              React.createElement('span', null,
                React.createElement('strong', null, m.title),
                React.createElement('span', null, m.meta)),
              React.createElement('span', { className: 'chevR' }, Ico('chevR')))));
        return null;
      }));
  }

  // ── AGENT CONVERSATION ──────────────────────────────────────────────────
  function AgentChat({ ctx }) {
    const lane = ctx.agentLane;
    const msgs = ctx.agentMsgs[lane];

    return React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'na-lanes' },
        React.createElement('button', { className: 'na-lane priv', 'data-active': lane === 'private', onClick: () => ctx.setAgentLane('private') },
          Ico('lock'), 'Your agent'),
        React.createElement('button', { className: 'na-lane room', 'data-active': lane === 'room', onClick: () => ctx.setAgentLane('room') },
          Ico('users'), 'Room agent')),

      React.createElement('p', { className: 'na-prose', style: { fontSize: 11.5, color: 'var(--text-tertiary)', margin: '2px 2px 0' } },
        lane === 'private'
          ? 'Private to you. Can read your notes if allowed; output stays yours until you promote it.'
          : 'Shared. Uses room-visible context only and proposes every change before it lands.'),

      React.createElement('div', { className: 'na-conv' },
        msgs.map((m) => {
          if (m.role === 'user') return React.createElement('div', { key: m.id, className: 'na-bubble me' }, m.text);
          if (m.variant === 'status') return React.createElement('div', { key: m.id, className: 'na-agent-status' },
            React.createElement('span', { className: 'na-pulsedot' }), m.text);
          if (m.variant === 'summary') return React.createElement('div', { key: m.id, className: 'na-card accent' },
            React.createElement('div', { className: 'na-card-head accent' },
              React.createElement('div', { className: 'na-card-title' },
                React.createElement('strong', null, m.title),
                React.createElement('span', null, m.sub)),
              React.createElement(Pill, { tone: 'accent', icon: 'sparkles' }, 'plan')),
            React.createElement('div', { className: 'na-card-body accent' },
              React.createElement('div', { className: 'na-stats' },
                m.stats.map((s, i) => React.createElement('div', { key: i, className: 'na-stat' },
                  React.createElement('b', { className: s.mono ? 'mono' : '', style: { fontSize: 15 } }, s.v),
                  React.createElement('span', null, s.l)))),
              React.createElement('button', { className: 'na-btn primary full', style: { marginTop: 10 }, onClick: () => ctx.openSheet('plan') },
                Ico('arrowRight'), 'Open work plan')));
          // text
          return React.createElement('div', { key: m.id, className: 'na-bubble agent' },
            React.createElement('div', { className: 'na-bubble-who' },
              React.createElement('span', { className: 'na-av', style: { background: 'var(--na-accent)' } }, 'NA'),
              lane === 'private' ? 'Your NodeAgent' : 'Room NodeAgent'),
            m.text);
        })),
    );
  }

  // ── UNIVERSAL COMPOSER ──────────────────────────────────────────────────
  function Composer({ ctx }) {
    const m = ctx.composerMode;
    const showQuick = ctx.tab === 'agent';
    const modeMeta = {
      note:  { icon: 'pen', label: 'Note', ph: 'Dump a private note…' },
      room:  { icon: 'room', label: 'Room', ph: 'Message the room…  @agent to ask' },
      agent: { icon: 'sparkles', label: 'Agent', ph: 'Ask NodeAgent to do something…' },
    };

    return React.createElement('div', { className: 'na-composer' },
      showQuick && React.createElement('div', { className: 'na-quick' },
        D.QUICK_PROMPTS.map((q, i) => React.createElement('button', { key: i, onClick: () => ctx.runQuick(q) },
          Ico(q.icon), q.text))),

      React.createElement('div', { className: 'na-modes' },
        ['note', 'room', 'agent'].map((id) => React.createElement('button', {
          key: id, className: 'na-mode', 'data-mode': id, 'data-active': m === id,
          onClick: () => ctx.setComposerMode(id),
        }, Ico(modeMeta[id].icon), modeMeta[id].label))),

      ctx.listening
        ? React.createElement('div', { className: 'na-composer-row' },
            React.createElement('div', { className: 'na-listening' },
              React.createElement('span', { className: 'na-wave' },
                React.createElement('i', null), React.createElement('i', null), React.createElement('i', null), React.createElement('i', null), React.createElement('i', null)),
              'Listening…'),
            React.createElement('button', { className: 'na-mic', 'data-listening': 'true', onClick: ctx.stopVoice, 'aria-label': 'Stop' }, Ico('mic')),
            React.createElement('button', { className: 'na-send', disabled: true }, Ico('arrowRight')))
        : React.createElement('div', { className: 'na-composer-row' },
            React.createElement('textarea', {
              className: 'na-composer-field', rows: 1, value: ctx.draft,
              placeholder: modeMeta[m].ph,
              onChange: (e) => ctx.setDraft(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ctx.sendComposer(); } },
            }),
            React.createElement('button', { className: 'na-mic', onClick: ctx.startVoice, 'aria-label': 'Voice to text' }, Ico('mic')),
            React.createElement('button', { className: 'na-send', disabled: !ctx.draft.trim(), onClick: ctx.sendComposer, 'aria-label': 'Send' }, Ico('arrowRight'))));
  }

  // ── JOBS SHEET ────────────────────────────────────────────────────────────
  function JobsSheet({ ctx }) {
    const J = D.JOBS;
    const meta = (m) => React.createElement('span', { className: 'm' }, m);
    const job = (j, kind) => React.createElement('div', { key: j.id, className: 'na-job' },
      React.createElement('div', { className: 'na-job-head' },
        React.createElement('div', null,
          React.createElement('strong', null, j.title),
          React.createElement('span', null, j.sub)),
        React.createElement(Pill, { tone: kind === 'running' ? 'accent' : kind === 'queued' ? 'warn' : 'ok' },
          kind === 'running' ? 'running' : kind === 'queued' ? 'queued' : 'done')),
      React.createElement('div', { className: 'na-job-meta' },
        meta(j.cost), j.eta && meta(j.eta), j.route && meta(j.route), j.trace && meta(j.trace)),
      kind === 'running' && React.createElement('div', { className: 'na-prog' },
        React.createElement('i', { style: { width: (j.pct || 50) + '%' } })),
      kind === 'running' && React.createElement('div', { className: 'na-btn-row', style: { marginTop: 10 } },
        React.createElement('button', { className: 'na-btn', onClick: () => ctx.toast('Job paused') }, Ico('clock'), 'Pause'),
        React.createElement('button', { className: 'na-btn ghost', onClick: () => ctx.toast('Job cancelled') }, Ico('x'), 'Cancel')));

    return React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'na-sheet-head' },
        React.createElement('div', { className: 'st' },
          React.createElement('strong', null, 'Agent jobs'),
          React.createElement('span', null, 'Queue · running · completed')),
        React.createElement('button', { className: 'na-close', onClick: ctx.closeSheet, 'aria-label': 'Close' }, Ico('x'))),
      React.createElement('div', { className: 'na-sheet-body' },
        J.running.length > 0 && React.createElement('div', { className: 'na-kicker' }, 'Running'),
        J.running.map((j) => job(j, 'running')),
        J.queued.length > 0 && React.createElement('div', { className: 'na-kicker' }, 'Queued'),
        J.queued.map((j) => job(j, 'queued')),
        React.createElement('div', { className: 'na-kicker' }, 'Completed'),
        J.completed.map((j) => job(j, 'completed'))));
  }

  window.NAChat = { RoomChat, AgentChat, Composer, JobsSheet };
})();
