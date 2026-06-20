/* ============================================================================
   NodeAgent Mobile — app controller
   Collaboration command layer: Capture · Room · Agent · Inbox · Files,
   a universal mode-aware composer with voice-to-text, and the agent control
   tower. Deep artifact work stays on desktop.
   → mounts into #root
   ============================================================================ */
(function () {
  const { useState, useEffect, useRef, useCallback } = React;
  const NAIcon = window.NAIcon;
  const D = window.NAD;
  const { Capture, Inbox } = window.NAScreens;
  const { PlanSheet, EvidenceSheet, CoachSheet } = window.NASheets;
  const { RoomChat, AgentChat, Composer, JobsSheet } = window.NAChat;
  const { Files, RowSheet } = window.NAFiles;
  const { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakSelect, TweakToggle } = window;
  const Ico = (name, props) => React.createElement(NAIcon, Object.assign({ name }, props || {}));

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "passive": "suggest",
    "navModel": "capture",
    "density": "comfortable",
    "accent": "terracotta",
    "navStyle": "tabs",
    "copyTone": "analyst",
    "motion": "expressive",
    "dark": true
  }/*EDITMODE-END*/;

  const TABS = {
    capture: { icon: 'pen', label: 'Capture' },
    room:    { icon: 'room', label: 'Room' },
    agent:   { icon: 'sparkles', label: 'Agent' },
    inbox:   { icon: 'inbox', label: 'Inbox' },
    files:   { icon: 'file', label: 'Files' },
  };
  const TAB_IDS = ['capture', 'room', 'agent', 'inbox', 'files'];

  function copyFor(tone, saveState) {
    const save = {
      analyst: { saving: 'Saving…', saved: 'Saved · scanning after pause', idle: 'Autosaves as you type' },
      calm:    { saving: 'Saving…', saved: 'Saved automatically', idle: 'Saves as you type' },
      command: { saving: 'SYNC…', saved: 'Saved · scan queued', idle: 'Local draft' },
    }[tone];
    const noticed = {
      analyst: { t: 'NodeRoom noticed CardioNova', s: 'Company, person, funding signal, and a source gap.' },
      calm:    { t: 'Found a few things', s: 'A company, a person, and something worth a look.' },
      command: { t: '4 signals on this capture', s: 'CardioNova · Maya · Series B · source gap' },
    }[tone];
    return { save: save[saveState] || save.idle, noticedTitle: noticed.t, noticedSub: noticed.s };
  }

  const VOICE = {
    note: 'Met Maya from CardioNova — possible Series B, ask about burn and paid pilots.',
    room: 'CardioNova still needs the paid-pilot source before we trust runway.',
    agent: 'Research CardioNova’s latest funding and confirm monthly burn.',
  };

  // agent reply generator → returns [{delay, msg}]
  function agentReply(text) {
    const s = text.toLowerCase();
    if (/research|funding|burn|enrich|cardionova/.test(s)) return [
      { delay: 450, msg: { variant: 'status', text: 'Planning a read-only run inside approved scope…' } },
      { delay: 1300, msg: { variant: 'summary', title: 'CardioNova diligence plan',
        sub: 'read-only · approval required',
        stats: [{ v: '4', l: 'reads' }, { v: '0', l: 'writes' }, { v: '$0.01', l: 'est. cost', mono: true }] } },
    ];
    if (/follow.?up|draft|email|maya/.test(s)) return [
      { delay: 450, msg: { variant: 'status', text: 'Drafting a follow-up…' } },
      { delay: 1200, msg: { variant: 'text', text: 'Draft: “Hi Maya — great meeting you. Two quick things to confirm for our notes: are the hospital pilots paid, and what’s the current monthly burn? Happy to share what we’re building in return.” Want me to log it as a task?' } },
    ];
    if (/summar|today|notes/.test(s)) return [
      { delay: 450, msg: { variant: 'status', text: 'Reading today’s notes…' } },
      { delay: 1200, msg: { variant: 'text', text: 'Today: 1 new company (CardioNova), 1 contact (Maya Chen), 1 funding signal (Series B, unverified), and 1 open source gap (paid pilots). Nothing was written to shared artifacts yet.' } },
    ];
    return [{ delay: 700, msg: { variant: 'text', text: 'Got it. I’ll keep this scoped to what you’ve approved and propose anything before it lands.' } }];
  }

  function App() {
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

    const [tab, setTab] = useState(t.navModel);
    const [note, setNote] = useState(D.SEED_NOTE);
    const [saveState, setSaveState] = useState('saved');
    const [detected, setDetected] = useState(true);
    const [noticed, setNoticed] = useState(true);
    const [sheet, setSheet] = useState(null);          // 'plan'|'evidence'|'coach'|'row'|'jobs'
    const [runState, setRunState] = useState('plan');
    const [resolved, setResolved] = useState({});
    const [toastMsg, setToastMsg] = useState(null);

    // collaboration state
    const [composerMode, setComposerMode] = useState('note');
    const [draft, setDraft] = useState('');
    const [listening, setListening] = useState(false);
    const [agentLane, setAgentLane] = useState('private');
    const [roomMsgs, setRoomMsgs] = useState(() => D.ROOM_CHAT.slice());
    const [agentMsgs, setAgentMsgs] = useState(() => ({
      private: D.AGENT_CHAT.private.slice(),
      room: D.AGENT_CHAT.room.slice(),
    }));

    const firstRun = useRef(true);
    const timers = useRef([]);
    const toastTimer = useRef(null);
    const voiceTimer = useRef(null);
    const mid = useRef(100);
    const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

    useEffect(() => { setTab(t.navModel); }, [t.navModel]);
    // composer mode follows the chat tab
    useEffect(() => {
      if (tab === 'room') setComposerMode('room');
      else if (tab === 'agent') setComposerMode('agent');
      else if (tab === 'capture') setComposerMode('note');
    }, [tab]);

    useEffect(() => {
      if (firstRun.current) { firstRun.current = false; return; }
      clearTimers();
      setSaveState('saving'); setDetected(false); setNoticed(false);
      timers.current.push(setTimeout(() => setSaveState('saved'), 850));
      if (t.passive !== 'off') {
        timers.current.push(setTimeout(() => setDetected(true), 1250));
        timers.current.push(setTimeout(() => setNoticed(true), 1750));
      }
    }, [note, t.passive]);
    useEffect(() => () => { clearTimers(); clearTimeout(toastTimer.current); clearTimeout(voiceTimer.current); }, []);

    const toast = useCallback((msg) => {
      setToastMsg(msg);
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToastMsg(null), 1900);
    }, []);

    const openSheet = (k) => setSheet(k);
    const closeSheet = () => setSheet(null);

    const beginRun = () => {
      setRunState('running');
      timers.current.push(setTimeout(() => {
        setRunState('done');
        setResolved((r) => ({ ...r, i_plan: true }));
        toast('Research complete · evidence ready');
      }, 1300));
    };

    const openInbox = (item) => {
      if (item.kind === 'plan') openSheet('plan');
      else if (item.kind === 'evidence') openSheet('evidence');
      else if (item.kind === 'coach') openSheet('coach');
      else toast('Trace receipt · 4 reads · 0 writes');
    };

    // ── composer / chat ─────────────────────────────────────────────────────
    const pushAgent = (lane, msg) => setAgentMsgs((prev) => ({ ...prev, [lane]: [...prev[lane], { id: 'a' + (mid.current++), ...msg }] }));
    const pushRoom = (msg) => setRoomMsgs((prev) => [...prev, { id: 'm' + (mid.current++), ...msg }]);

    const sendAgent = (text, lane) => {
      const ln = lane || agentLane;
      pushAgent(ln, { role: 'user', text });
      if (/runway|explain|prep|coach/i.test(text)) {
        timers.current.push(setTimeout(() => { pushAgent(ln, { role: 'agent', variant: 'status', text: 'Setting up a coach drill…' }); openSheet('coach'); }, 500));
        return;
      }
      agentReply(text).forEach(({ delay, msg }) =>
        timers.current.push(setTimeout(() => pushAgent(ln, { role: 'agent', ...msg }), delay)));
    };

    const sendComposer = () => {
      const text = draft.trim();
      if (!text) return;
      if (composerMode === 'note') {
        setNote((n) => (n ? n + '\n' + text : text));
        setTab('capture'); toast('Added to capture');
      } else if (composerMode === 'room') {
        pushRoom({ who: 'homen', kind: 'msg', t: 'now', text });
        if (/@agent|research|agent/i.test(text)) {
          timers.current.push(setTimeout(() => pushRoom({ who: 'room_na', kind: 'status', t: 'now', text: 'Picking that up — proposing a plan to the room.' }), 700));
        }
        setTab('room');
      } else {
        sendAgent(text);
        setTab('agent');
      }
      setDraft('');
    };

    const startVoice = () => {
      setListening(true);
      clearTimeout(voiceTimer.current);
      voiceTimer.current = setTimeout(() => {
        setListening(false);
        setDraft((d) => (d ? d + ' ' : '') + VOICE[composerMode]);
      }, 1400);
    };
    const stopVoice = () => { clearTimeout(voiceTimer.current); setListening(false); };

    const runQuick = (q) => {
      setTab('agent'); setComposerMode('agent');
      if (q.kind === 'coach') { sendAgent('Prep me to explain runway'); return; }
      sendAgent(q.text);
    };

    const openRow = () => openSheet('row');
    const askAboutRow = () => { setTab('agent'); setComposerMode('agent'); sendAgent('What’s missing on the CardioNova row?', 'room'); setAgentLane('room'); closeSheet(); };

    const openCount = D.INBOX.filter((i) => !resolved[i.id] && i.statusTone !== 'ok').length;

    const ctx = {
      t, tab, note, setNote, saveState, detected, noticed,
      copy: copyFor(t.copyTone, saveState),
      openSheet, closeSheet, openInbox, approveResearch: beginRun, runReadOnly: beginRun,
      runState, resolved, resolvedCount: openCount,
      version: runState === 'done' ? 'v42' : D.ROOM.version,
      toast,
      composerMode, setComposerMode, draft, setDraft, sendComposer,
      listening, startVoice, stopVoice,
      agentLane, setAgentLane, roomMsgs, agentMsgs,
      runQuick, openRow, askAboutRow,
    };

    const Screen = { capture: Capture, room: RoomChat, agent: AgentChat, inbox: Inbox, files: Files }[tab];
    const showComposer = tab === 'room' || tab === 'agent';
    const order = (() => {
      const m = t.navModel;
      if (!TAB_IDS.includes(m)) return TAB_IDS;
      return [m, ...TAB_IDS.filter((x) => x !== m)];
    })();

    return React.createElement(window.IOSDevice, { dark: t.dark, width: 402, height: 874 },
      React.createElement('div', {
        className: 'na-app',
        'data-theme': t.dark ? 'dark' : 'light',
        'data-density': t.density,
        'data-accent': t.accent,
        'data-motion': t.motion,
      },
        // top chrome
        React.createElement('div', { className: 'na-top' },
          React.createElement('div', { className: 'na-room' },
            React.createElement('div', { className: 'na-mark' }, 'N'),
            React.createElement('div', { className: 'na-room-copy' },
              React.createElement('strong', null, D.ROOM.name),
              React.createElement('span', null,
                React.createElement('span', { className: 'mono' }, D.ROOM.code),
                React.createElement('span', { className: 'na-dot' }),
                React.createElement('span', { className: 'na-live' }, D.ROOM.live + ' live'),
                React.createElement('span', { className: 'na-dot' }),
                TABS[tab].label.toLowerCase())),
            React.createElement('button', {
              className: 'na-icon-btn', 'aria-label': 'Agent jobs',
              onClick: () => tab === 'agent' || tab === 'room' ? openSheet('jobs') : (openCount ? setTab('inbox') : toast('All caught up')),
            }, Ico(tab === 'agent' || tab === 'room' ? 'history' : 'bell')))),

        // active screen
        React.createElement('div', { className: 'na-body', key: tab, 'data-composer': showComposer },
          React.createElement(Screen, { ctx })),

        // universal composer (room + agent)
        showComposer && React.createElement(Composer, { ctx }),

        // bottom nav (5 tabs)
        React.createElement('div', {
          className: 'na-nav',
          'data-style': t.navStyle === 'dock' ? 'dock' : 'tabs',
          style: { gridTemplateColumns: t.navStyle === 'dock' ? null : 'repeat(5, 1fr)' },
        },
          order.map((id) => React.createElement('button', {
            key: id, className: 'na-nav-item', 'data-active': tab === id, onClick: () => setTab(id),
          },
            React.createElement('div', { style: { position: 'relative' } },
              Ico(TABS[id].icon),
              id === 'inbox' && openCount > 0 && React.createElement('span', { className: 'badge' }, openCount)),
            React.createElement('span', null, TABS[id].label)))),

        // scrim + sheets
        React.createElement('div', { className: 'na-scrim', 'data-open': !!sheet, onClick: closeSheet }),
        React.createElement('div', { className: 'na-sheet', 'data-open': sheet === 'plan' }, sheet === 'plan' && React.createElement(PlanSheet, { ctx })),
        React.createElement('div', { className: 'na-sheet', 'data-open': sheet === 'evidence' }, sheet === 'evidence' && React.createElement(EvidenceSheet, { ctx })),
        React.createElement('div', { className: 'na-sheet', 'data-open': sheet === 'coach' }, sheet === 'coach' && React.createElement(CoachSheet, { ctx })),
        React.createElement('div', { className: 'na-sheet', 'data-open': sheet === 'row' }, sheet === 'row' && React.createElement(RowSheet, { ctx })),
        React.createElement('div', { className: 'na-sheet', 'data-open': sheet === 'jobs' }, sheet === 'jobs' && React.createElement(JobsSheet, { ctx })),

        // toast
        React.createElement('div', { className: 'na-toast', 'data-show': !!toastMsg }, toastMsg && Ico('checkCircle'), toastMsg),

        // tweaks
        React.createElement(TweaksPanel, null,
          React.createElement(TweakSection, { label: 'Intelligence' }),
          React.createElement(TweakSelect, {
            label: 'Passive intelligence', value: t.passive,
            options: [
              { value: 'off', label: 'Off' },
              { value: 'suggest', label: 'Suggest only' },
              { value: 'index', label: 'Auto-index room notes' },
              { value: 'research', label: 'Auto-research room notes' },
            ],
            onChange: (v) => setTweak('passive', v),
          }),
          React.createElement(TweakSection, { label: 'Navigation' }),
          React.createElement(TweakSelect, {
            label: 'Default surface', value: t.navModel,
            options: [
              { value: 'capture', label: 'Capture' },
              { value: 'room', label: 'Room chat' },
              { value: 'agent', label: 'Agent' },
              { value: 'inbox', label: 'Inbox' },
            ],
            onChange: (v) => setTweak('navModel', v),
          }),
          React.createElement(TweakRadio, {
            label: 'Nav style', value: t.navStyle, options: ['tabs', 'dock'],
            onChange: (v) => setTweak('navStyle', v),
          }),
          React.createElement(TweakSection, { label: 'Appearance' }),
          React.createElement(TweakRadio, {
            label: 'Density', value: t.density, options: ['compact', 'comfortable'],
            onChange: (v) => setTweak('density', v),
          }),
          React.createElement(TweakRadio, {
            label: 'Accent', value: t.accent, options: ['terracotta', 'amber', 'neutral'],
            onChange: (v) => setTweak('accent', v),
          }),
          React.createElement(TweakToggle, { label: 'Dark mode', value: t.dark, onChange: (v) => setTweak('dark', v) }),
          React.createElement(TweakSection, { label: 'Voice & motion' }),
          React.createElement(TweakSelect, {
            label: 'Copy tone', value: t.copyTone,
            options: [
              { value: 'analyst', label: 'Analyst coach' },
              { value: 'calm', label: 'Calm assistant' },
              { value: 'command', label: 'Command center' },
            ],
            onChange: (v) => setTweak('copyTone', v),
          }),
          React.createElement(TweakRadio, {
            label: 'Motion', value: t.motion, options: ['expressive', 'minimal', 'reduced'],
            onChange: (v) => setTweak('motion', v),
          }))));
  }

  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
})();
