/* ============================================================================
   Flows: Landing · Create room · Anonymous join  →  window.RFlows
   ============================================================================ */
(function () {
  const I = window.RIcon;
  const { useState } = React;

  function Avatar({ p, size }) {
    const cls = 'r-avatar' + (size ? ' ' + size : '') + (p.kind === 'agent' ? ' agent' : '');
    return React.createElement('span', { className: cls, style: { background: p.color } }, p.short);
  }

  // ── Landing (scratchnode.live-style) ───────────────────────────────────────
  function Landing({ onCreate, onJoin }) {
    const [code, setCode] = useState('');
    const features = [
      { ic: 'globe', h: 'Public by default', p: 'One room URL. Share a 6-char code and anyone can join — no account, just a display name.' },
      { ic: 'layout', h: 'Up to four panels', p: 'Files & people · public chat + room agent · a live artifact · your own private agent. Open only what you need.' },
      { ic: 'lock', h: 'Locks, not collisions', p: 'When an agent works a range it locks it — read-only for others, still readable. Drafts smart-merge on unlock.' },
    ];
    return React.createElement('div', { className: 'r-screen' },
      React.createElement('div', { className: 'r-landing' },
        React.createElement('div', { className: 'r-eyebrow' },
          React.createElement('span', { className: 'r-dot-live' }),
          'NodeAgent · live collaborative rooms'),
        React.createElement('h1', { className: 'r-h1' },
          'Bring people and ', React.createElement('span', { className: 'accent' }, 'agents'),
          ' into the same room.'),
        React.createElement('p', { className: 'r-lede' },
          'Chat, a shared workspace, and NodeAgents that edit alongside you — public for the room, private for you. The agent proposes; bounded tools commit.'),
        React.createElement('div', { className: 'r-cta-row' },
          React.createElement('button', { className: 'r-btn primary', onClick: onCreate, style: { padding: '11px 18px', fontSize: 14 } },
            React.createElement(I.plus, { size: 17 }), 'Create a room'),
          React.createElement('div', { className: 'r-join-inline' },
            React.createElement('input', {
              value: code, maxLength: 7, placeholder: 'ENTER CODE',
              onChange: (e) => setCode(e.target.value.toUpperCase()),
              onKeyDown: (e) => { if (e.key === 'Enter' && code.length >= 6) onJoin(code); },
            }),
            React.createElement('button', {
              className: 'r-btn', onClick: () => onJoin(code || 'Q3X-7K'), disabled: false,
            }, 'Join', React.createElement(I.arrow, { size: 15 })),
          ),
        ),
        React.createElement('div', { className: 'r-feature-grid' },
          features.map((f) => React.createElement('div', { className: 'r-feature', key: f.h },
            React.createElement('div', { className: 'fi' }, React.createElement(I[f.ic], { size: 18 })),
            React.createElement('h3', null, f.h),
            React.createElement('p', null, f.p),
          )),
        ),
      ),
    );
  }

  // ── Code peek (shared) ─────────────────────────────────────────────────────
  function CodePeek({ file, children }) {
    return React.createElement('div', { className: 'r-codepeek' },
      React.createElement('div', { className: 'cp-head' }, React.createElement(I.code, { size: 12 }), file),
      React.createElement('pre', null, children),
    );
  }
  const span = (cls, t) => React.createElement('span', { className: cls }, t);

  // ── Create room modal ──────────────────────────────────────────────────────
  function CreateModal({ onClose, onEnter }) {
    const [title, setTitle] = useState('Q3 diligence');
    const [code] = useState(() => window.NAR.makeRoomCode());
    const [copied, setCopied] = useState(false);
    const copy = () => { setCopied(true); setTimeout(() => setCopied(false), 1400); };
    return React.createElement('div', { className: 'r-modal-scrim', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); } },
      React.createElement('div', { className: 'r-modal' },
        React.createElement('div', { className: 'r-modal-head' },
          React.createElement('div', { className: 'row between' },
            React.createElement('span', { className: 'kicker' }, 'Host a room'),
            React.createElement('button', { className: 'r-iconbtn', onClick: onClose }, React.createElement(I.x, { size: 16 }))),
          React.createElement('h2', null, 'Create a room'),
          React.createElement('p', { className: 'sub' }, 'You\u2019ll own this room. It mints a room id and a share code — anyone with the code can join.'),
        ),
        React.createElement('div', { className: 'r-modal-body' },
          React.createElement('div', { className: 'r-field' },
            React.createElement('label', null, 'Room title'),
            React.createElement('input', { className: 'r-text-input', value: title, onChange: (e) => setTitle(e.target.value) }),
          ),
          React.createElement('div', { className: 'r-codecard' },
            React.createElement('div', { className: 'lbl' }, 'Share code'),
            React.createElement('div', { className: 'code' }, code),
            React.createElement('button', { className: 'r-btn ghost', onClick: copy, style: { margin: '8px auto 0' } },
              React.createElement(copied ? I.check : I.copy, { size: 14 }), copied ? 'Copied' : 'Copy code'),
          ),
          React.createElement(CodePeek, { file: 'convex/schema.ts · mutation createRoom' },
            span('cm', '// host owns the room; everything is keyed by roomId\n'),
            span('kw', 'const'), ' roomId = ', span('fn', 'makeRoomId'), '();  ', span('cm', '// "room_a1b2c3"'), '\n',
            span('kw', 'const'), ' code   = ', span('fn', 'makeRoomCode'), '();  ', span('cm', '// "'), span('str', code), span('cm', '"'), '\n',
            span('kw', 'await'), ' db.', span('fn', 'insert'), '(', span('str', "'rooms'"), ', { roomId, title, ', span('pr', 'hostId'), ', code });',
          ),
          React.createElement('button', { className: 'r-btn primary', onClick: () => onEnter(code, title), style: { width: '100%', justifyContent: 'center', marginTop: 16, padding: '11px' } },
            'Enter room', React.createElement(I.arrow, { size: 16 })),
        ),
      ),
    );
  }

  // ── Anonymous join modal ───────────────────────────────────────────────────
  function JoinModal({ code, onClose, onEnter }) {
    const [name, setName] = useState('');
    const display = name.trim() || 'quokka';
    return React.createElement('div', { className: 'r-modal-scrim', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); } },
      React.createElement('div', { className: 'r-modal' },
        React.createElement('div', { className: 'r-modal-head' },
          React.createElement('div', { className: 'row between' },
            React.createElement('span', { className: 'kicker' }, 'Join a room'),
            React.createElement('button', { className: 'r-iconbtn', onClick: onClose }, React.createElement(I.x, { size: 16 }))),
          React.createElement('h2', null, 'Join anonymously'),
          React.createElement('p', { className: 'sub' }, 'No account needed. Pick a display name — you\u2019ll get an ephemeral guest identity scoped to this room.'),
        ),
        React.createElement('div', { className: 'r-modal-body' },
          React.createElement('div', { className: 'r-field' },
            React.createElement('label', null, 'Room code'),
            React.createElement('input', { className: 'r-text-input mono', value: code, readOnly: true }),
          ),
          React.createElement('div', { className: 'r-field' },
            React.createElement('label', null, 'Display name'),
            React.createElement('input', { className: 'r-text-input', value: name, placeholder: 'quokka', onChange: (e) => setName(e.target.value), autoFocus: true }),
          ),
          React.createElement(CodePeek, { file: 'rooms · anonymous identity' },
            span('cm', '// guest gets an ephemeral, room-scoped identity\n'),
            span('kw', 'const'), ' me = { ', span('pr', 'id'), ': ', span('str', "'anon_'"), ' + nanoid(),\n',
            '            ', span('pr', 'name'), ': ', span('str', '"anon · '), span('str', display), span('str', '"'), ', ', span('pr', 'anon'), ': ', span('kw', 'true'), ' };\n',
            span('kw', 'await'), ' ', span('fn', 'joinRoom'), '({ code: ', span('str', '"'), span('str', code), span('str', '"'), ', identity: me });',
          ),
          React.createElement('button', { className: 'r-btn primary', onClick: () => onEnter(display), style: { width: '100%', justifyContent: 'center', marginTop: 16, padding: '11px' } },
            'Join as guest', React.createElement(I.arrow, { size: 16 })),
        ),
      ),
    );
  }

  window.RFlows = { Landing, CreateModal, JoinModal, Avatar, CodePeek };
})();
