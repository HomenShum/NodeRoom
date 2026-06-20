/* ============================================================================
   App shell — screen routing, top bar, walkthrough dock, tweaks, theme.
   ============================================================================ */
(function () {
  const { useState, useEffect, useMemo } = React;
  const I = window.RIcon;
  const NAR = window.NAR;
  const P = NAR.PEOPLE;
  const STEPS = NAR.STEPS;
  const { Landing, CreateModal, JoinModal, Avatar } = window.RFlows;
  const { RoomShell } = window.RRoom;
  const { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakColor } = window;

  const IDX = {}; STEPS.forEach((s, i) => { IDX[s.id] = i; });

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "accent": "#D97757",
    "dark": true,
    "pace": "standard",
    "glow": true
  }/*EDITMODE-END*/;

  const ACCENTS = {
    '#D97757': { primary: '#D97757', hover: '#C76648', tintL: 'rgba(217,119,87,0.10)', tintD: 'rgba(217,119,87,0.16)', border: 'rgba(217,119,87,0.24)', ink: '#AD5F45', inkD: '#E59579' },
    '#5E6AD2': { primary: '#5E6AD2', hover: '#4F58B8', tintL: 'rgba(94,106,210,0.12)', tintD: 'rgba(94,106,210,0.20)', border: 'rgba(94,106,210,0.30)', ink: '#4A53B5', inkD: '#9AA2E8' },
    '#1F8A5B': { primary: '#1F8A5B', hover: '#18734B', tintL: 'rgba(31,138,91,0.12)', tintD: 'rgba(31,138,91,0.20)', border: 'rgba(31,138,91,0.30)', ink: '#1B7A50', inkD: '#4FBF8B' },
  };
  const PACE = { brisk: 700, standard: 1150, cinematic: 1700 };

  function applyTheme(t) {
    const root = document.documentElement;
    root.setAttribute('data-theme', t.dark ? 'dark' : 'light');
    const a = ACCENTS[t.accent] || ACCENTS['#D97757'];
    root.style.setProperty('--accent-primary', a.primary);
    root.style.setProperty('--accent-hover', a.hover);
    root.style.setProperty('--accent-tint', t.dark ? a.tintD : a.tintL);
    root.style.setProperty('--accent-border', a.border);
    root.style.setProperty('--accent-ink', t.dark ? a.inkD : a.ink);
    window.__rPace = PACE[t.pace] || 1150;
    document.body.style.background = t.glow ? '' : 'var(--bg-app)';
  }

  function TopAvatars() {
    const list = [P.homen, P.priya, P.quokka, P.room_na];
    return React.createElement('div', { className: 'r-avatars' },
      list.map((p) => React.createElement('span', {
        key: p.id, className: 'r-av' + (p.kind === 'agent' ? ' agent' : ''), style: { background: p.color }, title: p.name + ' · ' + p.role,
      }, p.short, p.kind === 'human' && React.createElement('span', { className: 'pulse' }))),
    );
  }

  function Dock({ stepIdx, setStep }) {
    const s = STEPS[stepIdx];
    return React.createElement('div', { className: 'r-dock' },
      React.createElement('div', { className: 'r-stepdots' },
        STEPS.map((st, i) => React.createElement('button', {
          key: st.id, className: 'r-stepdot',
          'data-state': i === stepIdx ? 'active' : i < stepIdx ? 'done' : 'todo',
          title: st.label, onClick: () => setStep(i),
        }))),
      React.createElement('div', { className: 'r-dock-nav' },
        React.createElement('button', { className: 'r-iconbtn', disabled: stepIdx === 0, onClick: () => setStep(stepIdx - 1) }, React.createElement(I.arrowL, { size: 17 })),
        React.createElement('button', { className: 'r-iconbtn', disabled: stepIdx === STEPS.length - 1, onClick: () => setStep(stepIdx + 1) }, React.createElement(I.arrow, { size: 17 })),
      ),
      React.createElement('div', { className: 'r-dock-step', style: { flex: 'none', width: 168 } },
        React.createElement('div', { className: 'ds-kicker' }, s.kicker),
        React.createElement('div', { className: 'ds-title' }, s.title)),
      React.createElement('div', { className: 'r-dock-blurb grow' }, s.blurb),
      React.createElement('div', { className: 'r-dock-file' }, React.createElement(I.code, { size: 12, className: 'gi' }), s.file),
    );
  }

  function App() {
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
    const [stepIdx, setStepIdx] = useState(0);
    const [roomCode, setRoomCode] = useState(() => NAR.makeRoomCode());
    const [roomTitle, setRoomTitle] = useState('Q3 diligence');
    const [joinCode, setJoinCode] = useState('');
    const [openPanels, setOpenPanels] = useState({ left: false, artifact: false, right: false });
    const [autoAllow, setAutoAllow] = useState(true);

    useEffect(() => { applyTheme(t); }, [t.accent, t.dark, t.pace, t.glow]);

    const step = STEPS[stepIdx];
    const inRoom = step.screen === 'room';

    // sync panels to the step's declared layout whenever the step changes
    useEffect(() => {
      if (step.panels) {
        setOpenPanels({
          left: step.panels.includes('left'),
          artifact: step.panels.includes('artifact'),
          right: step.panels.includes('right'),
        });
      }
    }, [stepIdx]);

    const setStep = (i) => setStepIdx(Math.max(0, Math.min(STEPS.length - 1, i)));
    const togglePanel = (k) => setOpenPanels((o) => ({ ...o, [k]: !o[k] }));

    const goCreate = () => setStep(IDX.create);
    const goJoin = (code) => { setJoinCode((code || '').trim() || 'Q3X-7K'); setStep(IDX.join); };
    const enterFromCreate = (code, title) => { setRoomCode(code); setRoomTitle(title); setStep(IDX.chat); };
    const enterFromJoin = () => { if (joinCode) setRoomCode(joinCode); setStep(IDX.chat); };

    return React.createElement('div', { className: 'r-app' },
      // ── top bar ──
      React.createElement('div', { className: 'r-top' },
        React.createElement('div', { className: 'r-mark' }, 'N'),
        React.createElement('div', { className: 'r-brand' }, 'NodeAgent',
          inRoom && React.createElement('span', null, '  ·  ' + roomTitle)),
        inRoom && React.createElement('span', { className: 'r-roomcode' }, React.createElement(I.link, { size: 13 }), 'code ', React.createElement('b', null, roomCode)),
        React.createElement('span', { className: 'r-spacer' }),
        inRoom && React.createElement('div', { className: 'r-toggle-group' },
          React.createElement('button', { className: 'r-iconbtn', 'data-on': String(openPanels.left), title: 'Files & people', onClick: () => togglePanel('left') }, React.createElement(I.panelL, { size: 16 })),
          React.createElement('button', { className: 'r-iconbtn', 'data-on': String(openPanels.artifact), title: 'Artifact', onClick: () => togglePanel('artifact') }, React.createElement(I.sheet, { size: 16 })),
          React.createElement('button', { className: 'r-iconbtn', 'data-on': String(openPanels.right), title: 'Your private agent', onClick: () => togglePanel('right') }, React.createElement(I.panelR, { size: 16 })),
        ),
        inRoom && React.createElement('button', { className: 'r-pill-auto', onClick: () => setAutoAllow((v) => !v), title: 'Auto-approve agent edits' },
          'Auto-allow',
          React.createElement('span', { className: 'r-switch', 'data-on': String(autoAllow) })),
        inRoom && React.createElement(TopAvatars, null),
        React.createElement('button', { className: 'r-iconbtn', title: 'Toggle theme', onClick: () => setTweak('dark', !t.dark) },
          React.createElement(t.dark ? I.sun : I.moon, { size: 17 })),
      ),

      // ── screen ──
      inRoom
        ? React.createElement(RoomShell, { step, openPanels, autoAllow })
        : React.createElement(React.Fragment, null,
            React.createElement(Landing, { onCreate: goCreate, onJoin: goJoin }),
            step.screen === 'create' && React.createElement(CreateModal, { onClose: () => setStep(IDX.landing), onEnter: enterFromCreate }),
            step.screen === 'join' && React.createElement(JoinModal, { code: joinCode || 'Q3X-7K', onClose: () => setStep(IDX.landing), onEnter: enterFromJoin }),
          ),

      // ── walkthrough dock ──
      React.createElement(Dock, { stepIdx, setStep }),

      // ── tweaks ──
      React.createElement(TweaksPanel, { title: 'Tweaks' },
        React.createElement(TweakSection, { label: 'Theme' }),
        React.createElement(TweakColor, { label: 'Accent', value: t.accent, options: ['#D97757', '#5E6AD2', '#1F8A5B'], onChange: (v) => setTweak('accent', v) }),
        React.createElement(TweakToggle, { label: 'Dark mode', value: t.dark, onChange: (v) => setTweak('dark', v) }),
        React.createElement(TweakToggle, { label: 'Background glow', value: t.glow, onChange: (v) => setTweak('glow', v) }),
        React.createElement(TweakSection, { label: 'Collaboration' }),
        React.createElement(TweakRadio, { label: 'Replay pace', value: t.pace, options: ['brisk', 'standard', 'cinematic'], onChange: (v) => setTweak('pace', v) }),
      ),
    );
  }

  applyTheme(TWEAK_DEFAULTS);
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
})();
