/* ============================================================================
   Framing views: Pipeline (runtime flow) + Architecture (layered map).
   Mostly presentational; reuse window.NA data so copy stays in sync.
   Exports window.NAPipeline, window.NAArchitecture
   ============================================================================ */
(function () {
  const I = window.NAIcon;
  const NA = window.NA;
  const STEP_ICON = { context: 'chat', synthesis: 'search', notebook: 'file', graph: 'graph', spreadsheet: 'table', privacy: 'shield' };

  // ── Pipeline ───────────────────────────────────────────────────────────────
  function NAPipeline() {
    // split steps around the MCP tool boundary (before 'spreadsheet')
    const pre = NA.STEP_DEFS.filter((s) => ['context', 'synthesis', 'notebook', 'graph'].includes(s.id));
    const post = NA.STEP_DEFS.filter((s) => ['spreadsheet', 'privacy'].includes(s.id));
    const Node = (s, active) => React.createElement('div', { key: s.id, className: 'na-pnode' + (active ? ' active' : ' done'), style: pnodeStyle(active) },
      React.createElement('div', { className: 'row', style: { gap: 7, color: active ? '#E0875F' : 'var(--success)' } },
        React.createElement(I[STEP_ICON[s.id]] || I.dot, { size: 14 }),
        React.createElement('span', { className: 'mono tiny', style: { textTransform: 'uppercase', letterSpacing: '.08em' } }, s.kind)),
      React.createElement('div', { style: { fontWeight: 700, fontSize: 13, letterSpacing: '-.01em' } }, s.name.replace(/^(Gather|Search & |Write TipTap |Graph |Apply |Validate )/, '').replace(/ /, ' ')),
      React.createElement('div', { className: 'tiny muted', style: { lineHeight: 1.4 } }, s.detail),
    );

    return (
      React.createElement('div', { style: { height: '100%', overflowY: 'auto', padding: '34px 40px 48px' } },
        React.createElement('div', { style: { maxWidth: 1120, margin: '0 auto' } },
          React.createElement('div', { className: 'na-kicker' }, 'Runtime'),
          React.createElement('h2', { style: { margin: '6px 0 4px', fontSize: 26, letterSpacing: '-.02em' } }, 'The agent proposes — bounded tools commit'),
          React.createElement('p', { className: 'muted', style: { margin: '0 0 28px', fontSize: 14, maxWidth: 680, lineHeight: 1.6 } },
            'One mission flows left to right. Context, synthesis, and notebook writing are the agent’s reasoning surface. Every state mutation crosses the MCP tool boundary, where idempotency, versioning, and auditability live.'),

          // pipeline row
          React.createElement('div', { className: 'na-pipe-wrap' },
            pre.map((s) => Node(s, false)),
            React.createElement('div', { className: 'na-gate' },
              React.createElement('div', { className: 'na-gate-ico' }, React.createElement(I.gate, { size: 20 })),
              React.createElement('div', { className: 'na-gate-l' }, 'MCP tool boundary'),
            ),
            post.map((s) => Node(s, s.id === 'spreadsheet')),
          ),

          // detail of active stage
          React.createElement('div', { className: 'na-pipe-detail' },
            React.createElement('div', { className: 'na-card', style: { padding: 20 } },
              React.createElement('div', { className: 'row between', style: { marginBottom: 14 } },
                React.createElement('div', { className: 'row', style: { gap: 10 } },
                  React.createElement('span', { className: 'na-ico-badge', style: { background: 'rgba(217,119,87,.16)', color: '#D97757' } }, React.createElement(I.gate, { size: 15 })),
                  React.createElement('div', { style: { fontWeight: 700, fontSize: 14 } }, 'nodeagent.apply_spreadsheet_delta')),
                React.createElement('span', { className: 'na-badge applied' }, React.createElement('span', { className: 'bd' }), 'applied'),
              ),
              React.createElement('div', { className: 'tiny muted', style: { marginBottom: 14 } }, 'The agent proposes the delta; the tool owns the commit.'),
              [['1 · generate / check idempotency key', 'new'], ['2 · previousVersion === 41', 'match'], ['3 · apply delta · stable row ids', 'ok'], ['4 · increment → version 42', 'committed'], ['5 · persist idempotency record', 'saved']].map((r, i) =>
                React.createElement('div', { key: i, className: 'row between', style: { padding: '7px 0', borderTop: i ? '1px solid var(--border-subtle)' : 'none' } },
                  React.createElement('span', { className: 'mono tiny muted' }, r[0]),
                  React.createElement('span', { className: 'na-badge applied', style: { padding: '2px 8px', fontSize: 9.5 } }, React.createElement('span', { className: 'bd' }), r[1]))),
            ),
            React.createElement('div', { className: 'na-card', style: { padding: 20, background: 'var(--bg-secondary)' } },
              React.createElement('div', { className: 'row between', style: { marginBottom: 12 } },
                React.createElement('span', { className: 'na-kicker' }, 'Canonical sheet'),
                React.createElement('span', { className: 'na-vflow' },
                  React.createElement('span', { className: 'na-vpill' }, 'v41'), React.createElement(I.arrow, { size: 12, style: { color: 'var(--text-faint)' } }), React.createElement('span', { className: 'na-vpill next' }, 'v42'))),
              React.createElement('table', { className: 'na-sheet' },
                React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', null, 'row'), React.createElement('th', null, 'label'), React.createElement('th', { style: { textAlign: 'right' } }, 'value'), React.createElement('th', { style: { textAlign: 'right' } }, 'Δ'))),
                React.createElement('tbody', null,
                  React.createElement('tr', { className: 'changed' }, React.createElement('td', { className: 'rid' }, 'r_revenue'), React.createElement('td', null, 'Revenue'), React.createElement('td', { className: 'num' }, '10,000'), React.createElement('td', { className: 'num', style: { color: 'var(--accent-ink)' } }, '0.79')),
                  React.createElement('tr', { className: 'new' }, React.createElement('td', { className: 'rid' }, 'r_agent_note'), React.createElement('td', null, 'Agent synthesis'), React.createElement('td', { className: 'nul' }, 'summary…'), React.createElement('td', { className: 'nul' }, 'null')),
                  React.createElement('tr', null, React.createElement('td', { className: 'rid' }, 'r_cogs'), React.createElement('td', null, 'COGS'), React.createElement('td', { className: 'num' }, '4,000'), React.createElement('td', { className: 'nul' }, '—')),
                ),
              ),
              React.createElement('div', { className: 'na-mono-faint', style: { marginTop: 10 } }, 'affectedRange · rowIds [r_agent_note, r_revenue] · cols [1,2]'),
            ),
          ),
        ),
      )
    );
  }
  function pnodeStyle(active) {
    return {
      flex: 1, minWidth: 0, position: 'relative', padding: '13px 13px', borderRadius: 12,
      background: active ? 'var(--bg-surface)' : 'var(--bg-surface)',
      border: '1px solid ' + (active ? 'var(--accent-primary-border)' : 'var(--border-subtle)'),
      boxShadow: active ? '0 0 0 3px var(--accent-primary-tint), var(--shadow-md)' : 'var(--shadow-sm)',
      display: 'flex', flexDirection: 'column', gap: 7,
    };
  }

  // ── Architecture (layered map) ─────────────────────────────────────────────
  function NAArchitecture() {
    const layers = [
      { t: 'User · Team · Agent', d: 'chat · wall · notebook · spreadsheet', ico: 'chat', tone: 'plain' },
      { t: 'NodeAgent runtime', d: 'context gathering · search · synthesis', ico: 'cpu', tone: 'accent' },
      { t: 'Graph notebook', d: 'sources · @mentions · [[wiki]] · backlinks', ico: 'graph', tone: 'plain' },
      { t: 'MCP tool boundary', d: 'bounded tools — the only writers', ico: 'gate', tone: 'gate' },
      { t: 'State engines', d: 'versioned sheet sync · wall commit · notebook write · output validation', ico: 'layers', tone: 'plain' },
      { t: 'Durable state', d: 'Convex-style source of truth · versions · traces · audit logs', ico: 'db', tone: 'plain' },
      { t: 'Realtime broadcast', d: 'every client sees the canonical update', ico: 'route', tone: 'plain' },
    ];
    const toneStyle = (tone) => tone === 'accent'
      ? { borderColor: 'var(--accent-primary-border)', background: 'var(--accent-primary-tint)' }
      : tone === 'gate'
        ? { borderColor: 'rgba(94,106,210,.4)', background: 'rgba(94,106,210,.08)', borderStyle: 'dashed' }
        : {};
    const iconColor = (tone) => tone === 'accent' ? '#D97757' : tone === 'gate' ? '#8C92E0' : 'var(--text-muted)';

    return (
      React.createElement('div', { style: { height: '100%', overflowY: 'auto', padding: '34px 40px 48px' } },
        React.createElement('div', { style: { maxWidth: 1120, margin: '0 auto', display: 'grid', gridTemplateColumns: '1.15fr .85fr', gap: 40 } },
          // left: the stack
          React.createElement('div', null,
            React.createElement('div', { className: 'na-kicker' }, 'Architecture'),
            React.createElement('h2', { style: { margin: '6px 0 24px', fontSize: 26, letterSpacing: '-.02em' } }, 'Collaborative context → safe action'),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0 } },
              layers.map((l, i) => React.createElement('div', { key: l.t },
                React.createElement('div', { className: 'na-card', style: { padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 13, ...toneStyle(l.tone) } },
                  React.createElement('span', { className: 'na-ico-badge', style: { background: 'var(--bg-secondary)', color: iconColor(l.tone), width: 30, height: 30 } }, React.createElement(I[l.ico] || I.dot, { size: 16 })),
                  React.createElement('div', { style: { flex: 1 } },
                    React.createElement('div', { style: { fontWeight: 700, fontSize: 13.5, letterSpacing: '-.01em' } }, l.t),
                    React.createElement('div', { className: 'tiny muted', style: { marginTop: 1 } }, l.d)),
                  l.tone === 'gate' && React.createElement('span', { className: 'na-badge', style: { color: '#8C92E0', borderColor: 'rgba(94,106,210,.3)', background: 'rgba(94,106,210,.1)' } }, 'mutation gate'),
                ),
                i < layers.length - 1 && React.createElement('div', { style: { display: 'flex', justifyContent: 'center', padding: '5px 0', color: 'var(--text-faint)' } }, React.createElement(I.arrow, { size: 15, style: { transform: 'rotate(90deg)' } })),
              )),
            ),
          ),
          // right: thesis + MCP tools
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
            React.createElement('div', { className: 'na-card', style: { padding: 20, background: 'linear-gradient(180deg, var(--accent-primary-tint), transparent)' } },
              React.createElement('div', { className: 'na-kicker', style: { color: 'var(--accent-ink)' } }, 'Design principle'),
              React.createElement('p', { style: { margin: '10px 0 0', fontSize: 16, lineHeight: 1.5, fontWeight: 600, letterSpacing: '-.01em' } },
                'The agent can gather, reason, and propose — but bounded tools own mutation, versioning, idempotency, privacy, and auditability.'),
            ),
            React.createElement('div', { className: 'na-card', style: { padding: 20 } },
              React.createElement('div', { className: 'row between', style: { marginBottom: 14 } },
                React.createElement('span', { className: 'na-kicker' }, 'MCP tools'),
                React.createElement('span', { className: 'na-mono-faint' }, NA.MCP_TOOLS.length + ' registered')),
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 11 } },
                NA.MCP_TOOLS.map((t) => React.createElement('div', { key: t.name },
                  React.createElement('div', { className: 'mono', style: { fontSize: 11.5, color: 'var(--accent-ink)', fontWeight: 600 } }, t.name),
                  React.createElement('div', { className: 'tiny muted', style: { marginTop: 2, lineHeight: 1.4 } }, t.desc),
                )),
              ),
            ),
            React.createElement('div', { className: 'na-card', style: { padding: '16px 20px', background: 'var(--bg-secondary)' } },
              React.createElement('div', { className: 'na-kicker', style: { marginBottom: 10 } }, 'Production layering'),
              React.createElement('div', { className: 'tiny muted', style: { lineHeight: 1.7 } },
                React.createElement('div', null, React.createElement('b', { style: { color: 'var(--text-secondary)' } }, 'Convex'), ' — durable source of truth'),
                React.createElement('div', null, React.createElement('b', { style: { color: 'var(--text-secondary)' } }, 'Redis'), ' — hot live / session AI layer'),
                React.createElement('div', null, React.createElement('b', { style: { color: 'var(--text-secondary)' } }, 'Typesense'), ' — fast search'),
                React.createElement('div', null, React.createElement('b', { style: { color: 'var(--text-secondary)' } }, 'Linkup'), ' — external fetch when the corpus misses'),
              ),
            ),
          ),
        ),
      )
    );
  }

  window.NAPipeline = NAPipeline;
  window.NAArchitecture = NAArchitecture;
})();
