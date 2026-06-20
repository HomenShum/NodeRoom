/* ============================================================================
   Shell — top nav, view switch, theme + accent, run button, tweaks panel.
   Mounts Console / Pipeline / Architecture.
   ============================================================================ */
(function () {
  const { useState, useEffect, useCallback } = React;
  const I = window.NAIcon;
  const { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakColor } = window;

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "accent": "#D97757",
    "dark": true,
    "pace": "standard",
    "glow": true,
    "scope": "public only"
  }/*EDITMODE-END*/;

  const ACCENTS = {
    '#D97757': { primary: '#D97757', hover: '#C76648', tintL: 'rgba(217,119,87,0.10)', tintD: 'rgba(217,119,87,0.16)', border: 'rgba(217,119,87,0.24)', ink: '#AD5F45' },
    '#5E6AD2': { primary: '#5E6AD2', hover: '#4F58B8', tintL: 'rgba(94,106,210,0.12)', tintD: 'rgba(94,106,210,0.20)', border: 'rgba(94,106,210,0.30)', ink: '#4A53B5' },
    '#1F8A5B': { primary: '#1F8A5B', hover: '#18734B', tintL: 'rgba(31,138,91,0.12)', tintD: 'rgba(31,138,91,0.20)', border: 'rgba(31,138,91,0.30)', ink: '#1B7A50' },
  };
  const PACE = { brisk: 400, standard: 820, cinematic: 1300 };

  function applyTheme(t) {
    const root = document.documentElement;
    root.setAttribute('data-theme', t.dark ? 'dark' : 'light');
    const a = ACCENTS[t.accent] || ACCENTS['#D97757'];
    root.style.setProperty('--accent-primary', a.primary);
    root.style.setProperty('--accent-primary-hover', a.hover);
    root.style.setProperty('--accent-primary-tint', t.dark ? a.tintD : a.tintL);
    root.style.setProperty('--accent-primary-border', a.border);
    root.style.setProperty('--accent-ink', t.dark ? a.primary : a.ink);
    window.__naStepMs = PACE[t.pace] || 820;
    document.body.classList.toggle('nb-app', !!t.glow);
    document.body.style.background = t.glow ? '' : 'var(--bg-app)';
  }

  function NavTab({ id, label, view, setView }) {
    return React.createElement('button', { 'data-active': String(view === id), onClick: () => setView(id) }, label);
  }

  function App() {
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
    const [view, setView] = useState('console');
    const [running, setRunning] = useState(false);
    const [phase, setPhase] = useState(0);

    useEffect(() => { applyTheme(t); }, [t.accent, t.dark, t.pace, t.glow]);
    useEffect(() => {
      const h = (e) => { setRunning(e.detail.running); setPhase(e.detail.phase); };
      window.addEventListener('na-state', h);
      return () => window.removeEventListener('na-state', h);
    }, []);

    const runMission = useCallback(() => { if (window.__naRun && !running) window.__naRun(); }, [running]);

    return (
      React.createElement('div', { className: 'na-app' },
        // ── top nav ──
        React.createElement('div', { className: 'na-top' },
          React.createElement('div', { className: 'na-mark' }, 'N'),
          React.createElement('div', { className: 'na-brand' }, React.createElement('b', null, 'NodeAgent'), ' ',
            React.createElement('span', null, '· ' + (view === 'console' ? 'Console' : view === 'pipeline' ? 'Runtime' : 'Architecture'))),
          React.createElement('div', { style: { width: 14 } }),
          React.createElement('div', { className: 'na-nav' },
            React.createElement(NavTab, { id: 'console', label: 'Console', view, setView }),
            React.createElement(NavTab, { id: 'pipeline', label: 'Runtime', view, setView }),
            React.createElement(NavTab, { id: 'architecture', label: 'Architecture', view, setView }),
          ),
          React.createElement('div', { className: 'na-spacer' }),
          view === 'console' && React.createElement('span', { className: 'na-mono-faint', style: { marginRight: 4 } }, phase === 7 ? 'mission complete' : running ? 'running…' : 'idle'),
          React.createElement('button', { className: 'na-iconbtn', title: 'Toggle theme', onClick: () => setTweak('dark', !t.dark) },
            React.createElement(t.dark ? I.sun : I.moon, { size: 17 })),
          view === 'console' && React.createElement('button', { className: 'na-run', onClick: runMission, disabled: running },
            React.createElement(I.play, { size: 15 }), running ? 'Running…' : phase === 7 ? 'Re-run mission' : 'Run mission'),
        ),
        // ── views ──
        React.createElement('div', { className: 'na-main' },
          React.createElement('div', { className: 'na-view', style: { display: view === 'console' ? 'block' : 'none' } },
            React.createElement(window.NAConsole, { scope: t.scope === 'public only' ? 'public' : 'private' })),
          view === 'pipeline' && React.createElement('div', { className: 'na-view' }, React.createElement(window.NAPipeline)),
          view === 'architecture' && React.createElement('div', { className: 'na-view' }, React.createElement(window.NAArchitecture)),
        ),
        // ── tweaks ──
        React.createElement(TweaksPanel, { title: 'Tweaks' },
          React.createElement(TweakSection, { label: 'Theme' }),
          React.createElement(TweakColor, { label: 'Accent', value: t.accent, options: ['#D97757', '#5E6AD2', '#1F8A5B'], onChange: (v) => setTweak('accent', v) }),
          React.createElement(TweakToggle, { label: 'Dark mode', value: t.dark, onChange: (v) => setTweak('dark', v) }),
          React.createElement(TweakToggle, { label: 'App glow', value: t.glow, onChange: (v) => setTweak('glow', v) }),
          React.createElement(TweakSection, { label: 'Mission run' }),
          React.createElement(TweakRadio, { label: 'Pace', value: t.pace, options: ['brisk', 'standard', 'cinematic'], onChange: (v) => setTweak('pace', v) }),
          React.createElement(TweakRadio, { label: 'Default scope', value: t.scope, options: ['public only', 'include private'], onChange: (v) => setTweak('scope', v) }),
        ),
      )
    );
  }

  // initial theme before mount to avoid flash
  applyTheme(TWEAK_DEFAULTS);
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
})();
