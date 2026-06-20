/* ============================================================================
   RoomShell — adaptive 1→4 panel workspace + collaboration engine.
   Every artifact mutation (hand OR agent) flows through one path that updates
   the artifact, appends a room-trace entry, and posts a chat activity line.
   →  window.RRoom
   ============================================================================ */
(function () {
  const { useState, useEffect, useRef, useCallback } = React;
  const NAR = window.NAR;
  const P = NAR.PEOPLE;
  const BEATS = NAR.COLLAB_BEATS;
  const { LeftRail, CenterChat, RightAgent } = window.RPanels;
  const { ArtifactPanel } = window.RArtifact;

  const PEOPLE_LIST = [P.homen, P.priya, P.quokka, P.room_na];
  const TRACE_ICO = { lock: 'lock', read: 'eye', draft: 'draft', commit: 'gate', merge: 'merge', trace: 'history', note: 'note', wall: 'wall', edit: 'draft' };
  const ROW_LABEL = {}; NAR.SHEET.rows.forEach((r) => { ROW_LABEL[r.id] = r.cells[0]; });
  const nameOf = (a) => (P[a] ? P[a].name : 'Someone');
  const isCommit = (e) => e.kind === 'commit' || e.kind === 'merge';

  function emptyCells() {
    const c = {};
    NAR.SHEET.rows.forEach((r) => { c[r.id] = { variance: null, note: null }; });
    return c;
  }
  function buildOverlay(beat) {
    return {
      locked: (beat >= 1 && beat <= 3) ? ['r_rev', 'r_cogs'] : [],
      draft: (beat >= 3 && beat <= 4) ? ['r_gp', 'r_ni'] : [],
    };
  }

  function RoomShell({ step, openPanels, autoAllow }) {
    const [pub, setPub] = useState(NAR.PUBLIC_CHAT.slice());
    const [priv, setPriv] = useState(NAR.PRIVATE_CHAT.slice());
    const [pubTyping, setPubTyping] = useState(false);
    const [privTyping, setPrivTyping] = useState(false);
    const [activeFile, setActiveFile] = useState('sheet_q3');
    const [tab, setTab] = useState('sheet');

    const [cells, setCells] = useState(emptyCells);
    const [blocks, setBlocks] = useState(() => NAR.NOTE_BLOCKS.map((b) => ({ ...b })));
    const [wall, setWall] = useState(() => NAR.WALL.map((w) => ({ ...w })));
    const [trace, setTrace] = useState([]);
    const [pulse, setPulse] = useState({});

    const [beat, setBeat] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [needsApprove, setNeedsApprove] = useState(false);
    const timer = useRef(null);
    const pulseTimer = useRef(null);
    const mid = useRef(100);
    const onCollab = step.id === 'collab';

    useEffect(() => () => { clearTimeout(timer.current); clearTimeout(pulseTimer.current); }, []);
    useEffect(() => { if (onCollab) setTab('sheet'); }, [onCollab]);

    const pushPub = (who, text, extra) => setPub((m) => [...m, { id: 'x' + (mid.current++), who, text, t: 'now', ...(extra || {}) }]);
    const pushPriv = (who, text, extra) => setPriv((m) => [...m, { id: 'y' + (mid.current++), who, text, t: 'now', ...(extra || {}) }]);
    const activity = (icon, text, who) => pushPub(who || 'homen', text, { activity: true, icon });

    const firePulse = (keys) => {
      const next = {}; keys.forEach((k) => { next[k] = true; });
      setPulse(next);
      clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setPulse({}), 1500);
    };
    // append a commit/merge entry, computing v{from}→v{to} from current trace
    const appendVersioned = (make, src) => setTrace((prev) => {
      const v = 41 + prev.filter(isCommit).length;
      return [...prev, { ...make(v, v + 1), src: src || 'manual' }];
    });
    const appendTrace = (e, src) => setTrace((prev) => [...prev, { ...e, src: src || 'manual' }]);

    // ── hand edit: spreadsheet cell ───────────────────────────────────────────
    const editCell = (rowId, field, value) => {
      const v = (value || '').trim();
      setCells((c) => ({ ...c, [rowId]: { ...c[rowId], [field]: v || null } }));
      firePulse([rowId + ':' + field]);
      if (!v) return;
      appendVersioned((from, to) => ({
        kind: 'commit', ico: 'gate', tool: 'nodeagent.apply_spreadsheet_delta',
        text: 'You set ' + ROW_LABEL[rowId] + ' · ' + field + ' = ' + v + ' · v' + from + ' → v' + to,
        detail: 'set_cell · stable row id ' + rowId + ' · null preserved',
      }));
      activity('sheet', 'You edited ' + ROW_LABEL[rowId] + ' · ' + field + ' → ' + v);
    };

    // ── hand edit: accept a drafted note block ────────────────────────────────
    const acceptBlock = (id) => {
      setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, status: 'accepted', justAccepted: true } : b)));
      appendTrace({ kind: 'note', ico: 'note', tool: 'nodeagent.accept_block', text: 'You accepted a drafted note block', detail: 'notebookBlocks · status draft → accepted' });
      activity('note', 'You accepted a drafted note block — now part of the note');
    };

    // ── hand edit: wall ───────────────────────────────────────────────────────
    const moveNote = (id) => {
      appendTrace({ kind: 'wall', ico: 'wall', tool: 'nodeagent.move_wall_notes', text: 'You moved a sticky on the wall', detail: 'optimistic transform · one commit on pointerup' });
      activity('wall', 'You moved a sticky on the wall');
    };
    const setNotePos = (id, x, y) => setWall((w) => w.map((n) => (n.id === id ? { ...n, x, y } : n)));
    const editNote = (id, text) => {
      setWall((w) => w.map((n) => (n.id === id ? { ...n, text } : n)));
      appendTrace({ kind: 'wall', ico: 'wall', tool: 'nodeagent.edit_wall_note', text: 'You edited a sticky', detail: 'wall note ' + id });
      activity('wall', 'You edited a sticky on the wall');
    };
    const addNote = () => {
      const id = 'w' + (mid.current++);
      setWall((w) => [...w, { id, x: 60 + (w.length % 3) * 60, y: 60 + Math.floor(w.length / 3) * 40, text: 'New idea…', color: '#CBD2F0', by: 'homen', fresh: true }]);
      appendTrace({ kind: 'wall', ico: 'wall', tool: 'nodeagent.add_wall_note', text: 'You added a sticky', detail: 'wall note ' + id });
      activity('wall', 'You added a sticky to the wall');
    };

    // ── free chat ─────────────────────────────────────────────────────────────
    const sendPublic = (text) => {
      const ask = text.trim().startsWith('/ask');
      pushPub('homen', text, ask ? { ask: true } : null);
      if (ask) {
        setPubTyping(true);
        setTimeout(() => {
          setPubTyping(false);
          pushPub('room_na', 'Gathering room context, then proposing a versioned delta through the sync tool. Open the spreadsheet and run the collaboration to watch me lock, commit, and release.', { agent: true });
        }, 1300);
      }
    };
    const sendPrivate = (text) => {
      pushPriv('homen', text, { private: true });
      setPrivTyping(true);
      setTimeout(() => {
        setPrivTyping(false);
        pushPriv('my_na', 'Reading the room context for that. This stays private to you — say "promote" and I\u2019ll post it to the public chat.', { agent: true, private: true });
      }, 1200);
    };

    // ── collaboration engine (lock → read → draft → commit → merge) ───────────
    const applyBeat = (n) => {
      const log = BEATS[n] && BEATS[n].log;
      if (n === 4) {
        setCells((c) => ({ ...c, r_rev: { ...c.r_rev, variance: '+24%' }, r_cogs: { ...c.r_cogs, variance: '+27.5%' } }));
        firePulse(['r_rev:variance', 'r_cogs:variance']);
        appendVersioned((from, to) => ({ kind: 'commit', ico: 'gate', tool: log.tool, text: 'Room NodeAgent commits Variance for Revenue, COGS · v' + from + ' → v' + to, detail: log.detail }), 'collab');
        pushPub('room_na', 'Committed Variance for Revenue and COGS through the sync tool. Lock released.', { agent: true });
      } else if (n === 5) {
        setCells((c) => ({ ...c, r_gp: { ...c.r_gp, variance: '+21.7%' }, r_ni: { ...c.r_ni, variance: '+22.4%' } }));
        firePulse(['r_gp:variance', 'r_ni:variance']);
        appendVersioned((from, to) => ({ kind: 'merge', ico: 'merge', tool: log.tool, text: 'Smart-merge applies the held draft · v' + from + ' → v' + to, detail: log.detail }), 'collab');
        pushPriv('my_na', 'Smart-merged my drafted Variance for Gross profit and Net income on top of canonical state.', { agent: true, private: true });
      } else if (log) {
        appendTrace({ kind: log.kind, ico: TRACE_ICO[log.kind] || 'dot', tool: log.tool, text: log.text, detail: log.detail }, 'collab');
      }
    };
    const advance = useCallback((n, forced) => {
      if (n > 6) { setPlaying(false); return; }
      if (n === 5 && !autoAllow && !forced) { setNeedsApprove(true); setPlaying(false); return; }
      setBeat(n); applyBeat(n);
      if (n >= 6) { setPlaying(false); return; }
      timer.current = setTimeout(() => advance(n + 1), window.__rPace || 1150);
    }, [autoAllow]);

    const play = () => { setPlaying(true); advance(beat + 1); };
    const approve = () => { setNeedsApprove(false); setPlaying(true); advance(5, true); };
    const reset = () => {
      clearTimeout(timer.current); setBeat(0); setPlaying(false); setNeedsApprove(false);
      setTrace((t) => t.filter((e) => e.src !== 'collab'));
      setCells((c) => ({ ...c, r_rev: { ...c.r_rev, variance: null }, r_cogs: { ...c.r_cogs, variance: null }, r_gp: { ...c.r_gp, variance: null }, r_ni: { ...c.r_ni, variance: null } }));
    };

    const overlay = onCollab ? buildOverlay(beat) : { locked: [], draft: [] };
    const version = 41 + trace.filter(isCommit).length;

    const sheet = {
      rows: NAR.SHEET.rows.map((r) => ({ id: r.id, label: r.cells[0], q2: r.cells[1], q3: r.cells[2] })),
      columns: NAR.SHEET.columns, cells, version, overlay, pulse,
    };
    const collabBar = onCollab ? {
      beat, desc: BEATS[beat].desc, playing, onPlay: play, onReset: reset, needsApprove, onApprove: approve,
    } : null;

    return React.createElement('div', { className: 'r-workspace' },
      openPanels.left && React.createElement(LeftRail, { key: 'left', files: NAR.FILES, activeFile, onSelectFile: setActiveFile, people: PEOPLE_LIST }),
      React.createElement(CenterChat, { key: 'center', messages: pub, people: P, onSend: sendPublic, typing: pubTyping }),
      openPanels.artifact && React.createElement(ArtifactPanel, {
        key: 'art', tab, onTab: setTab,
        sheet, onEditCell: editCell,
        note: { blocks, onAccept: acceptBlock },
        wallData: { notes: wall, onMove: moveNote, onSetPos: setNotePos, onEdit: editNote, onAdd: addNote },
        collabBar, trace,
      }),
      openPanels.right && React.createElement(RightAgent, { key: 'right', messages: priv, people: P, onSend: sendPrivate, typing: privTyping }),
    );
  }

  window.RRoom = { RoomShell };
})();
