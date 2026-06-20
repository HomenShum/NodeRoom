/* ============================================================================
   Panels: LeftRail · CenterChat · RightAgent  →  window.RPanels
   ============================================================================ */
(function () {
  const I = window.RIcon;
  const { Avatar } = window.RFlows;
  const P = window.NAR.PEOPLE;
  const FILE_ICON = { sheet: 'sheet', note: 'note', wall: 'wall', doc: 'doc' };

  // ── Left rail: files + people ──────────────────────────────────────────────
  function LeftRail({ files, activeFile, onSelectFile, people }) {
    return React.createElement('div', { className: 'r-panel left' },
      React.createElement('div', { className: 'r-panel-head' },
        React.createElement(I.folder, { size: 15, style: { color: 'var(--text-muted)' } }),
        React.createElement('span', { className: 'h-title' }, 'Room')),
      React.createElement('div', { className: 'r-rail' },
        React.createElement('div', { className: 'r-rail-section kicker' }, 'Files'),
        files.map((f) => React.createElement('button', {
          key: f.id, className: 'r-file', 'data-active': String(activeFile === f.id),
          onClick: () => onSelectFile(f.id),
        },
          React.createElement('span', { className: 'fi' }, React.createElement(I[FILE_ICON[f.kind]], { size: 15 })),
          React.createElement('span', { className: 'grow' },
            React.createElement('div', { className: 'fn' }, f.name),
            React.createElement('div', { className: 'fm' }, f.meta)),
        )),
        React.createElement('div', { className: 'r-rail-section kicker', style: { marginTop: 8 } }, 'People · 3 live'),
        people.map((p) => React.createElement('div', { key: p.id, className: 'r-person' },
          React.createElement(Avatar, { p, size: 'sm' }),
          React.createElement('span', { className: 'grow' },
            React.createElement('div', { className: 'pn' }, p.name),
            React.createElement('div', { className: 'pr' }, p.role)),
          p.kind === 'human' && React.createElement('span', { className: 'r-dot-live' }),
        )),
      ),
    );
  }

  // ── A single chat message ──────────────────────────────────────────────────
  function Message({ m, people }) {
    if (m.activity) {
      return React.createElement('div', { className: 'r-activity' },
        React.createElement('span', { className: 'r-activity-ico' }, React.createElement(I[m.icon] || I.dot, { size: 12 })),
        React.createElement('span', { className: 'r-activity-text' }, m.text),
        React.createElement('span', { className: 'r-activity-time' }, m.t),
      );
    }
    const p = people[m.who] || P[m.who];
    const isAgent = p && p.kind === 'agent';
    return React.createElement('div', { className: 'r-msg' + (isAgent ? ' agent' : '') },
      React.createElement(Avatar, { p, size: 'sm' }),
      React.createElement('div', { className: 'body' },
        React.createElement('div', { className: 'meta' },
          React.createElement('span', { className: 'who', style: isAgent ? { color: 'var(--accent-ink)' } : null }, p.name),
          isAgent && React.createElement('span', { className: 'r-tag agent' }, 'agent'),
          React.createElement('span', { className: 'time' }, m.t)),
        m.ask
          ? React.createElement('div', { className: 'r-bubble-ask' }, m.text)
          : React.createElement('div', { className: 'text' }, m.text),
      ),
    );
  }

  // ── Typing indicator row ───────────────────────────────────────────────────
  function Typing({ p }) {
    return React.createElement('div', { className: 'r-msg agent' },
      React.createElement(Avatar, { p, size: 'sm' }),
      React.createElement('div', { className: 'body' },
        React.createElement('div', { className: 'meta' },
          React.createElement('span', { className: 'who', style: { color: 'var(--accent-ink)' } }, p.name)),
        React.createElement('div', { className: 'r-typing' },
          React.createElement('i'), React.createElement('i'), React.createElement('i')),
      ),
    );
  }

  // ── Center: public chat + room agent ───────────────────────────────────────
  function CenterChat({ messages, people, onSend, typing }) {
    const [val, setVal] = React.useState('');
    const scrollRef = React.useRef(null);
    React.useEffect(() => {
      const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight;
    }, [messages.length, typing]);
    const submit = () => { const v = val.trim(); if (!v) return; onSend(v); setVal(''); };
    return React.createElement('div', { className: 'r-panel center' },
      React.createElement('div', { className: 'r-panel-head' },
        React.createElement(I.chat, { size: 15, style: { color: 'var(--text-muted)' } }),
        React.createElement('span', { className: 'h-title' }, 'Public chat'),
        React.createElement('span', { className: 'r-tag public' }, React.createElement(I.globe, { size: 11 }), 'Everyone'),
        React.createElement('span', { className: 'grow' }),
        React.createElement(Avatar, { p: P.room_na, size: 'sm' }),
        React.createElement('span', { className: 'h-sub' }, 'Room NodeAgent'),
      ),
      React.createElement('div', { className: 'r-chat', ref: scrollRef },
        messages.map((m) => React.createElement(Message, { key: m.id, m, people })),
        typing && React.createElement(Typing, { p: P.room_na }),
      ),
      React.createElement('div', { className: 'r-composer' },
        React.createElement('div', { className: 'r-input-wrap' },
          React.createElement('input', {
            value: val, placeholder: 'Message the room…  try /ask',
            onChange: (e) => setVal(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') submit(); },
          }),
          React.createElement('button', { className: 'r-send', onClick: submit }, React.createElement(I.send, { size: 15 })),
        ),
        React.createElement('div', { className: 'r-composer-hint' },
          React.createElement('span', { className: 'r-chip' }, '/ask reconcile Q3 revenue'),
          React.createElement('span', { className: 'r-chip' }, '/ask flag variance > 15%'),
        ),
      ),
    );
  }

  // ── Right: your private agent ──────────────────────────────────────────────
  function RightAgent({ messages, people, onSend, typing }) {
    const [val, setVal] = React.useState('');
    const scrollRef = React.useRef(null);
    React.useEffect(() => {
      const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight;
    }, [messages.length, typing]);
    const submit = () => { const v = val.trim(); if (!v) return; onSend(v); setVal(''); };
    return React.createElement('div', { className: 'r-panel right' },
      React.createElement('div', { className: 'r-panel-head' },
        React.createElement(Avatar, { p: P.my_na, size: 'sm' }),
        React.createElement('span', { className: 'h-title' }, 'Your NodeAgent'),
        React.createElement('span', { className: 'grow' }),
        React.createElement('span', { className: 'r-tag private' }, React.createElement(I.lock, { size: 11 }), 'Private'),
      ),
      React.createElement('div', { className: 'r-private-banner' },
        React.createElement(I.eye, { size: 13 }),
        'Reads room context · output stays yours until you promote it'),
      React.createElement('div', { className: 'r-chat', ref: scrollRef, style: { padding: '12px 12px 6px' } },
        messages.map((m) => React.createElement(Message, { key: m.id, m, people })),
        typing && React.createElement(Typing, { p: P.my_na }),
      ),
      React.createElement('div', { className: 'r-composer' },
        React.createElement('div', { className: 'r-input-wrap' },
          React.createElement('input', {
            value: val, placeholder: 'Ask privately…',
            onChange: (e) => setVal(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') submit(); },
          }),
          React.createElement('button', { className: 'r-send', onClick: submit }, React.createElement(I.send, { size: 15 })),
        ),
      ),
    );
  }

  window.RPanels = { LeftRail, CenterChat, RightAgent, Message };
})();
