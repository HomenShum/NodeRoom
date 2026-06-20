/* ============================================================================
   Artifact panel: editable spreadsheet · interactive note · draggable wall
   + collab bar + room trace.  Every change is routed back through RoomShell so
   it lands in the trace and the chat.
   →  window.RArtifact
   ============================================================================ */
(function () {
  const { useState, useRef, useEffect } = React;
  const I = window.RIcon;
  const { Avatar } = window.RFlows;
  const P = window.NAR.PEOPLE;

  // ── editable cell ──────────────────────────────────────────────────────────
  function EditableCell({ value, emptyLabel, onCommit, disabled, align }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value || '');
    useEffect(() => { setDraft(value || ''); }, [value]);
    if (disabled) {
      return value != null
        ? React.createElement('span', { className: 'r-val-pos' }, value)
        : React.createElement('span', { className: 'nullcell' }, emptyLabel || 'null');
    }
    if (editing) {
      return React.createElement('input', {
        className: 'r-cell-input', autoFocus: true, value: draft,
        style: align === 'right' ? { textAlign: 'right' } : null,
        onChange: (e) => setDraft(e.target.value),
        onBlur: () => { setEditing(false); if (draft.trim() !== (value || '')) onCommit(draft); },
        onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); } },
      });
    }
    return React.createElement('button', { className: 'r-cell-edit', onClick: () => setEditing(true) },
      value != null
        ? React.createElement('span', { className: 'r-val-pos' }, value)
        : React.createElement('span', { className: 'add-hint' }, React.createElement(I.plus, { size: 11 }), emptyLabel || 'add'));
  }

  // ── spreadsheet ────────────────────────────────────────────────────────────
  function SheetView({ sheet, onEditCell }) {
    const { rows, columns, cells, version, overlay, pulse } = sheet;
    const lockSet = new Set(overlay.locked), draftSet = new Set(overlay.draft);
    return React.createElement('div', { className: 'r-art-body' },
      React.createElement('div', { className: 'r-sheet-wrap' },
        React.createElement('table', { className: 'r-sheet' },
          React.createElement('thead', null, React.createElement('tr', null,
            React.createElement('th', { style: { width: 70 } }, 'row'),
            columns.map((c, i) => React.createElement('th', { key: c, className: (i >= 1 && i <= 3) ? 'num' : '' }, c)),
          )),
          React.createElement('tbody', null,
            rows.map((row) => {
              const cell = cells[row.id] || { variance: null, note: null };
              const locked = lockSet.has(row.id), drafting = draftSet.has(row.id);
              const vCls = 'r-cell num' + (locked ? ' locked' : '') + (drafting ? ' draft' : '') + (pulse[row.id + ':variance'] ? ' committed' : '');
              const nCls = 'r-cell' + (pulse[row.id + ':note'] ? ' committed' : '');
              return React.createElement('tr', { key: row.id },
                React.createElement('td', { className: 'rid' }, row.id),
                React.createElement('td', { className: 'label' }, row.label),
                React.createElement('td', { className: 'num' }, React.createElement('span', { className: 'r-val-num' }, row.q2)),
                React.createElement('td', { className: 'num' }, React.createElement('span', { className: 'r-val-num' }, row.q3)),
                React.createElement('td', { className: vCls },
                  React.createElement(EditableCell, {
                    value: cell.variance, emptyLabel: 'add', align: 'right',
                    disabled: locked || drafting,
                    onCommit: (v) => onEditCell(row.id, 'variance', v),
                  }),
                  locked && React.createElement('span', { className: 'lockbadge' }, React.createElement(I.lock, { size: 9 }), 'NA'),
                  drafting && React.createElement('span', { className: 'lockbadge' }, React.createElement(I.draft, { size: 9 }), 'draft'),
                ),
                React.createElement('td', { className: nCls },
                  React.createElement(EditableCell, {
                    value: cell.note, emptyLabel: 'note', disabled: locked,
                    onCommit: (v) => onEditCell(row.id, 'note', v),
                  }),
                ),
              );
            }),
          ),
        ),
      ),
      React.createElement('div', { className: 'r-sheet-foot' },
        React.createElement('span', { className: 'kicker' }, 'versionedSpreadsheetSync'),
        React.createElement('span', { className: 'r-vpill next' }, 'v' + version),
        React.createElement('span', { className: 'grow' }),
        React.createElement('span', { className: 'mono tiny faint' }, 'click a Variance or Note cell to edit by hand'),
      ),
    );
  }

  // ── note ───────────────────────────────────────────────────────────────────
  function NoteBlock({ b, onAccept }) {
    if (b.type === 'heading') return React.createElement('h2', { className: 'nb-heading' }, b.text);
    const isDraft = b.status === 'draft';
    const inner = b.type === 'quote'
      ? React.createElement('blockquote', { className: 'nb-quote' }, b.text)
      : React.createElement('p', { className: 'nb-para' }, b.text);
    return React.createElement('div', { className: 'nb-block' + (isDraft ? ' draft' : '') + (b.justAccepted ? ' just' : '') },
      inner,
      React.createElement('div', { className: 'nb-meta' },
        b.author === 'agent' && React.createElement('span', { className: 'nb-author' }, React.createElement(I.spark, { size: 11 }), 'NodeAgent'),
        isDraft && React.createElement('span', { className: 'nb-chip draft' }, 'agent draft'),
        b.sources && b.sources.map((s) => React.createElement('span', { key: s, className: 'nb-src' }, React.createElement(I.doc, { size: 10 }), s)),
        React.createElement('span', { className: 'grow' }),
        isDraft && React.createElement('button', { className: 'nb-accept', onClick: () => onAccept(b.id) },
          React.createElement(I.check, { size: 13 }), 'Accept'),
      ),
    );
  }
  function NoteView({ note }) {
    return React.createElement('div', { className: 'r-art-body' },
      React.createElement('div', { className: 'r-note' },
        note.blocks.map((b) => React.createElement(NoteBlock, { key: b.id, b, onAccept: note.onAccept })),
      ),
    );
  }

  // ── wall (draggable + editable post-its) ───────────────────────────────────
  function WallView({ wallData }) {
    const { notes, onMove, onSetPos, onEdit, onAdd } = wallData;
    const drag = useRef(null);
    const down = (e, n) => {
      if (e.target.isContentEditable) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false };
    };
    const move = (e) => {
      const d = drag.current; if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      onSetPos(d.id, Math.max(0, d.ox + dx), Math.max(0, d.oy + dy));
    };
    const up = () => { if (drag.current && drag.current.moved) onMove(drag.current.id); drag.current = null; };
    return React.createElement('div', { className: 'r-art-body' },
      React.createElement('div', { className: 'r-wall-toolbar' },
        React.createElement('button', { className: 'r-btn ghost', onClick: onAdd, style: { padding: '5px 10px', fontSize: 12 } },
          React.createElement(I.plus, { size: 14 }), 'Add note'),
        React.createElement('span', { className: 'grow' }),
        React.createElement('span', { className: 'muted tiny' }, 'drag to move · click text to edit'),
      ),
      React.createElement('div', { className: 'r-wall', onPointerMove: move, onPointerUp: up },
        notes.map((n, i) => {
          const p = P[n.by] || P.homen;
          return React.createElement('div', {
            key: n.id, className: 'r-postit', onPointerDown: (e) => down(e, n),
            style: { left: n.x, top: n.y, background: n.color, '--rot': (i % 2 ? 1.3 : -1.5) + 'deg' },
          },
            React.createElement('div', {
              className: 'pt-text', contentEditable: true, suppressContentEditableWarning: true,
              onBlur: (e) => { const t = e.target.innerText.trim(); if (t && t !== n.text) onEdit(n.id, t); },
            }, n.text),
            React.createElement('div', { className: 'pby' },
              React.createElement('span', { className: 'pby-av', style: { background: p.color } }, p.short),
              p.name),
          );
        }),
      ),
    );
  }

  // ── collab control bar (collab step only) ──────────────────────────────────
  function CollabBar({ beat, desc, playing, onPlay, onReset, needsApprove, onApprove }) {
    return React.createElement('div', { className: 'r-collab-bar' },
      React.createElement('span', { className: 'r-tag', style: { background: 'var(--accent-tint)', color: 'var(--accent-ink)' } },
        React.createElement(I.merge, { size: 12 }), 'Live collab'),
      React.createElement('span', { className: 'r-beat-desc grow' }, desc),
      needsApprove
        ? React.createElement('button', { className: 'r-btn primary', onClick: onApprove, style: { padding: '6px 12px', fontSize: 12 } }, React.createElement(I.check, { size: 14 }), 'Approve merge')
        : beat >= 6
          ? React.createElement('button', { className: 'r-btn ghost', onClick: onReset, style: { padding: '6px 12px', fontSize: 12 } }, React.createElement(I.history, { size: 14 }), 'Replay')
          : React.createElement('button', { className: 'r-btn primary', onClick: onPlay, disabled: playing, style: { padding: '6px 12px', fontSize: 12 } },
              React.createElement(playing ? I.cpu : I.play, { size: 14 }), playing ? 'Running…' : beat === 0 ? 'Run collaboration' : 'Resume'),
    );
  }

  // ── room trace ─────────────────────────────────────────────────────────────
  function TraceStrip({ log }) {
    const ref = useRef(null);
    useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [log.length]);
    return React.createElement('div', { className: 'r-trace' },
      React.createElement('div', { className: 'r-trace-head' },
        React.createElement(I.history, { size: 14, style: { color: 'var(--text-muted)' } }),
        React.createElement('span', { className: 'h-title', style: { fontSize: 11.5 } }, 'Room trace'),
        React.createElement('span', { className: 'grow' }),
        React.createElement('span', { className: 'mono tiny faint' }, 'agentTraces · ' + log.length + ' steps')),
      React.createElement('div', { className: 'r-trace-list', ref },
        log.length === 0
          ? React.createElement('div', { className: 'tiny faint', style: { padding: '2px 4px' } }, 'Edit a cell, accept a note, move a sticky, or run the collaboration — every change is recorded here.')
          : log.map((e, i) => React.createElement('div', { className: 'r-trace-item', key: i },
              React.createElement('span', { className: 'r-trace-ico ' + e.kind }, React.createElement(I[e.ico] || I.dot, { size: 12 })),
              React.createElement('div', { className: 'grow' },
                React.createElement('div', { className: 'tt' }, e.text),
                React.createElement('div', { className: 'td' }, React.createElement('span', { style: { color: 'var(--accent-ink)' } }, e.tool), ' · ', e.detail)),
            )),
      ),
    );
  }

  // ── shell ──────────────────────────────────────────────────────────────────
  const TABS = [
    { id: 'sheet', label: 'Spreadsheet', ic: 'sheet' },
    { id: 'note', label: 'Note', ic: 'note' },
    { id: 'wall', label: 'Wall', ic: 'wall' },
  ];
  function ArtifactPanel(props) {
    const { tab, onTab, sheet, onEditCell, note, wallData, collabBar, trace } = props;
    return React.createElement('div', { className: 'r-panel artifact' },
      React.createElement('div', { className: 'r-panel-head' },
        React.createElement('div', { className: 'r-tabs' },
          TABS.map((t) => React.createElement('button', { key: t.id, className: 'r-tab', 'data-active': String(tab === t.id), onClick: () => onTab(t.id) },
            React.createElement(I[t.ic], { size: 13 }), t.label))),
        React.createElement('span', { className: 'grow' }),
        React.createElement('span', { className: 'r-tag public' }, React.createElement(I.users, { size: 11 }), 'Shared'),
      ),
      collabBar && tab === 'sheet' && React.createElement(CollabBar, collabBar),
      tab === 'sheet' && React.createElement(SheetView, { sheet, onEditCell }),
      tab === 'note' && React.createElement(NoteView, { note }),
      tab === 'wall' && React.createElement(WallView, { wallData }),
      React.createElement(TraceStrip, { log: trace }),
    );
  }

  window.RArtifact = { ArtifactPanel };
})();
