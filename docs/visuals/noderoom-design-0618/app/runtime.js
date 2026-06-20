/* ==========================================================================
   NodeAgent runtime — faithful JS port of packages/core/src/*
   (contextCollector, searchAndSynthesize, tiptapNotebook,
    applySpreadsheetDelta, versionedSpreadsheetSync)
   Exposed on window.NA so the React UI drives the real logic.
   ========================================================================== */
(function () {
  // ── stable hashing (spreadsheet/versionedSpreadsheetSync.ts) ─────────────
  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  function stableHash(value) {
    let hash = 0;
    const text = stableStringify(value);
    for (let i = 0; i < text.length; i++) hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
    return Math.abs(hash).toString(36);
  }
  function generateIdempotencyKey(req) {
    return 'idem_' + stableHash({
      sheetId: req.sheetId, source: req.source, actor: req.actor,
      providerDeltaId: req.providerDeltaId, previousVersion: req.previousVersion,
      operations: req.operations,
    });
  }

  // ── applySpreadsheetDelta.ts ─────────────────────────────────────────────
  function applySpreadsheetDelta(sheet, operations) {
    let rows = sheet.rows.map((r) => ({ ...r, cells: [...r.cells] }));
    for (const op of operations) {
      if (op.type === 'insert_row') {
        const index = op.afterRowId ? rows.findIndex((r) => r.id === op.afterRowId) + 1 : rows.length;
        if (index < 0) throw new Error('afterRowId not found: ' + op.afterRowId);
        rows.splice(index, 0, { ...op.row, cells: [...op.row.cells] });
      }
      if (op.type === 'delete_row') {
        const index = rows.findIndex((r) => r.id === op.rowId);
        if (index === -1) throw new Error('rowId not found: ' + op.rowId);
        rows.splice(index, 1);
      }
      if (op.type === 'set_cell') {
        const row = rows.find((r) => r.id === op.rowId);
        if (!row) throw new Error('rowId not found: ' + op.rowId);
        row.cells[op.columnIndex] = op.value;
      }
    }
    return { ...sheet, rows };
  }
  function affectedRange(operations) {
    const rowIds = new Set(); const columns = new Set();
    for (const op of operations) {
      if (op.type === 'insert_row') { rowIds.add(op.row.id); op.row.cells.forEach((_, i) => columns.add(i)); }
      if (op.type === 'delete_row') rowIds.add(op.rowId);
      if (op.type === 'set_cell') { rowIds.add(op.rowId); columns.add(op.columnIndex); }
    }
    return { rowIds: [...rowIds], columns: [...columns].sort((a, b) => a - b) };
  }

  // ── versionedSpreadsheetSync.ts ──────────────────────────────────────────
  // store = { sheet, idempotencyRecords: Map }
  function applyVersionedSpreadsheetSync(store, request) {
    const idempotencyKey = request.idempotencyKey ?? generateIdempotencyKey(request);
    const requestHash = stableHash({ ...request, idempotencyKey });
    const previous = store.idempotencyRecords.get(idempotencyKey);

    if (previous) {
      if (previous.requestHash !== requestHash) {
        return { ...previous.result, status: 'idempotency_key_conflict', idempotencyKey };
      }
      return { ...previous.result, status: 'duplicate' };
    }

    if (store.sheet.version !== request.previousVersion) {
      return {
        status: 'version_conflict', sheet: store.sheet,
        previousVersion: request.previousVersion, nextVersion: store.sheet.version,
        idempotencyKey, providerDeltaId: request.providerDeltaId,
        source: request.source, actor: request.actor,
        appliedAt: new Date().toISOString(), affectedRange: affectedRange(request.operations),
      };
    }

    const nextSheet = applySpreadsheetDelta(store.sheet, request.operations);
    nextSheet.version = store.sheet.version + 1;
    store.sheet = nextSheet;

    const result = {
      status: 'applied', sheet: nextSheet,
      previousVersion: request.previousVersion, nextVersion: nextSheet.version,
      idempotencyKey, providerDeltaId: request.providerDeltaId,
      source: request.source, actor: request.actor,
      appliedAt: new Date().toISOString(), affectedRange: affectedRange(request.operations),
    };
    store.idempotencyRecords.set(idempotencyKey, { requestHash, result });
    return result;
  }

  // ── chat/contextCollector.ts ─────────────────────────────────────────────
  function collectCollaborativeContext(input) {
    const normalized = input.question.trim().toLowerCase();
    const terms = normalized.split(/\s+/).filter(Boolean);
    const publicMessages = input.chatMessages.filter((m) => m.visibility !== 'private');
    const privateMessages = input.includePrivate
      ? input.chatMessages.filter((m) => m.visibility === 'private') : [];
    const candidateDocuments = input.documents
      .filter((doc) => input.includePrivate || doc.visibility !== 'private')
      .map((doc) => ({ ...doc, score: terms.reduce((s, t) => s + (doc.body.toLowerCase().includes(t) ? 1 : 0), 0) }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return { question: input.question, publicMessages, privateMessages, candidateDocuments };
  }

  // ── search/searchAndSynthesize.ts ────────────────────────────────────────
  function searchAndSynthesize(context) {
    const sources = context.candidateDocuments.filter((d) => (d.score ?? 0) > 0).slice(0, 3);
    const fallback = sources.length ? sources : context.candidateDocuments.slice(0, 2);
    const summary = fallback.length
      ? 'Found ' + fallback.length + ' relevant source(s): ' + fallback.map((s) => s.title).join(', ')
        + '. The answer should cite the selected source bundle and preserve public/private boundaries.'
      : 'No strong document match found. Ask a clarifying question or broaden retrieval scope.';
    return { summary, sources: fallback, confidence: fallback.length ? Math.min(0.95, 0.55 + fallback.length * 0.12) : 0.2 };
  }

  // ── notebook/tiptapNotebook.ts ───────────────────────────────────────────
  function createNotebookFromAnswer(answer) {
    const now = new Date().toISOString();
    const blocks = [
      { id: 'blk_heading', type: 'heading', text: 'NodeAgent synthesis', sourceIds: answer.sources.map((s) => s.id), status: 'draft' },
      { id: 'blk_summary', type: 'paragraph', text: answer.summary, sourceIds: answer.sources.map((s) => s.id), status: answer.confidence >= 0.7 ? 'draft' : 'needs_review' },
    ];
    return { id: 'nb_run', title: 'NodeAgent Run', blocks, updatedAt: now };
  }

  // ── demo/seedDemoState.ts ────────────────────────────────────────────────
  function seedDemoState() {
    const now = new Date().toISOString();
    return {
      chatMessages: [
        { id: 'm1', author: 'Finance Lead', text: 'Can NodeAgent find the right source for the NetSuite variance?', createdAt: now, visibility: 'public', source: 'user' },
        { id: 'm2', author: 'Homen', text: 'Private note: explain why null cells should persist through spreadsheet sync.', createdAt: now, visibility: 'private', source: 'user' },
        { id: 'm3', author: 'Agent', text: '/ask summarize the latest evidence for spreadsheet sync reliability', createdAt: now, visibility: 'public', source: 'agent' },
      ],
      documents: [
        { id: 'doc_v4', title: 'NodeBench home-v4 — TipTap / graph / presentation / event delta', body: 'TipTap notebook blocks, graph snapshots, presentation artifacts, and event delta rows.', kind: 'doc', visibility: 'public' },
        { id: 'doc_v5', title: 'ScratchNode home-v5 — live room and wiki handoff', body: 'Live chat, /ask, private notes, public wiki, Convex backed room, NodeBench handoff.', kind: 'wiki', visibility: 'public' },
        { id: 'doc_private', title: 'Private implementation note', body: 'The agent should call bounded spreadsheet tools and preserve null as data.', kind: 'note', visibility: 'private' },
      ],
      sheet: {
        sheetId: 'sheet_nodeagent_demo', version: 41,
        rows: [
          { id: 'r_revenue', cells: ['Revenue', 10000, null] },
          { id: 'r_cogs', cells: ['COGS', 4000, null] },
          { id: 'r_gross_profit', cells: ['Gross Profit', 6000, null] },
        ],
      },
    };
  }

  // ── mission delta the agent proposes (nodeAgentRuntime.ts) ────────────────
  function missionOperations(sheet, answer) {
    return [
      { type: 'set_cell', rowId: sheet.rows[0].id, columnIndex: 2, value: answer.confidence },
      { type: 'insert_row', afterRowId: sheet.rows[0].id, row: { id: 'r_agent_note', cells: ['Agent synthesis', answer.summary, null] } },
    ];
  }

  // The 6 trace steps the runtime pushes, with stable copy.
  const STEP_DEFS = [
    { id: 'context', kind: 'context', name: 'Gather collaborative context', tool: null, detail: 'Public + private chat, candidate docs scored by term overlap.' },
    { id: 'synthesis', kind: 'synthesis', name: 'Search & synthesize answer', tool: null, detail: 'Filter docs scored > 0, select bundle, compute confidence.' },
    { id: 'notebook', kind: 'notebook', name: 'Write TipTap notebook blocks', tool: null, detail: 'Heading + paragraph; status gated on confidence ≥ 0.7.' },
    { id: 'graph', kind: 'graph', name: 'Graph context & entity expansion', tool: null, detail: 'Source citations, @entity expansion, backlinks (depth-limited).' },
    { id: 'spreadsheet', kind: 'spreadsheet', name: 'Apply spreadsheet delta via tool', tool: 'nodeagent.apply_spreadsheet_delta', detail: 'Idempotency → version check → stable rows → audit metadata.' },
    { id: 'privacy', kind: 'privacy', name: 'Validate output boundary', tool: 'nodeagent.validate_output_boundary', detail: 'Public output carries trace + L1/L2/L3; no private context.' },
  ];

  const MCP_TOOLS = [
    { name: 'nodeagent.get_sheet_state', desc: 'Read the current versioned spreadsheet state before proposing changes.' },
    { name: 'nodeagent.preview_spreadsheet_delta', desc: 'Preview a deterministic delta without committing it.' },
    { name: 'nodeagent.apply_spreadsheet_delta', desc: 'Commit through idempotency, version checks, stable row ids, audit metadata.' },
    { name: 'nodeagent.expand_entity_context', desc: 'Expand an @entity with claims, edges, backlinks, depth-limited expansion.' },
    { name: 'nodeagent.move_wall_notes', desc: 'Commit memory-wall note moves after an optimistic local drag.' },
    { name: 'nodeagent.validate_output_boundary', desc: 'Validate public/private rules and L1/L2/L3 output contracts.' },
  ];

  window.NA = {
    stableStringify, stableHash, generateIdempotencyKey,
    applySpreadsheetDelta, affectedRange, applyVersionedSpreadsheetSync,
    collectCollaborativeContext, searchAndSynthesize, createNotebookFromAnswer,
    seedDemoState, missionOperations, STEP_DEFS, MCP_TOOLS,
    newStore: (sheet) => ({ sheet, idempotencyRecords: new Map() }),
  };
})();
