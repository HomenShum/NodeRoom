/* Direction C — Proposes / Commits split (the architecture thesis as space) */
window.FRAME_C = `
<div class="fr">
  <div class="fr-top">
    <div class="fr-mark">N</div>
    <div class="fr-brand">NodeAgent <span>/ Tool boundary</span></div>
    <div class="fr-spacer"></div>
    <span class="fr-vpill">the agent proposes · the tool commits</span>
    <button class="fr-run"><span class="dot"></span> Replay</button>
  </div>

  <div class="split">

    <!-- LEFT: agent proposes -->
    <div class="col propose">
      <div class="col-h">
        <div class="ci">◷</div>
        <div><div class="col-t">Agent proposes</div><div class="col-s">reasons over context · drafts · suggests deltas</div></div>
      </div>

      <div class="pnl" style="padding:13px 14px;">
        <div class="kicker" style="margin-bottom:9px;">Synthesis</div>
        <div style="font-size:12px; line-height:1.55; color:var(--text-secondary);">Found 2 relevant sources. Draft a notebook block and a finance delta — but do not mutate state directly.</div>
      </div>

      <div class="pnl" style="padding:13px 14px;">
        <div class="row" style="justify-content:space-between; margin-bottom:9px;">
          <div class="kicker">Proposed notebook</div><span class="badge rev"><span class="bd"></span> draft</span>
        </div>
        <div class="nb-block agent" style="margin:0;"><div class="nb-p">NodeAgent synthesis — cite source bundle, preserve public / private boundary.</div></div>
      </div>

      <div class="req-card" style="margin-top:auto;">
        <div class="row" style="justify-content:space-between;">
          <span class="kicker">Proposed delta</span>
          <span class="tiny mono muted">prevVersion 41</span>
        </div>
        <div class="req-op"><span class="op-k">set_cell</span> r_revenue · col 2 = <span style="color:#E0875F;">0.79</span></div>
        <div class="req-op"><span class="op-k">insert_row</span> after r_revenue · "Agent synthesis"</div>
        <div class="tiny muted">actor · nodeagent &nbsp;|&nbsp; source · NodeAgent demo provider</div>
      </div>
    </div>

    <!-- SEAM: the bounded tool -->
    <div class="seam">
      <span class="seam-l">request</span>
      <div class="seam-gate">⛬</div>
      <div style="display:flex; flex-direction:column; align-items:center; gap:6px;">
        <span class="badge ok" style="font-size:9px;"><span class="bd"></span> idem</span>
        <span class="badge ok" style="font-size:9px;"><span class="bd"></span> ver</span>
        <span class="badge ok" style="font-size:9px;"><span class="bd"></span> audit</span>
      </div>
      <span class="seam-l">commit</span>
    </div>

    <!-- RIGHT: tools commit -->
    <div class="col commit">
      <div class="col-h">
        <div class="ci">◫</div>
        <div><div class="col-t">Tools commit</div><div class="col-s">idempotency · versioning · stable rows · audit</div></div>
      </div>

      <div class="pnl" style="padding:13px 14px;">
        <div class="row" style="justify-content:space-between; margin-bottom:9px;">
          <div class="kicker">Canonical sheet</div>
          <div class="row mono gap6" style="font-size:11px;"><span class="fr-vpill">v41</span><span class="muted">→</span><span class="fr-vpill" style="color:#E0875F;border-color:rgba(217,119,87,.4);">v42</span></div>
        </div>
        <table class="sheet">
          <thead><tr><th>row</th><th>label</th><th style="text-align:right;">value</th></tr></thead>
          <tbody>
            <tr><td class="rowid">r_revenue</td><td>Revenue</td><td class="num">10,000</td></tr>
            <tr class="new"><td class="rowid">r_agent_note</td><td>Agent synthesis</td><td class="null">null</td></tr>
            <tr><td class="rowid">r_cogs</td><td>COGS</td><td class="num">4,000</td></tr>
          </tbody>
        </table>
      </div>

      <div class="pnl" style="padding:13px 14px;">
        <div class="row" style="justify-content:space-between; margin-bottom:9px;">
          <div class="kicker">Audit metadata</div><span class="badge ok"><span class="bd"></span> applied</span>
        </div>
        <dl class="kv">
          <dt>idempotencyKey</dt><dd>idem_1f9c…7a2</dd>
          <dt>previousVersion</dt><dd>41</dd>
          <dt>nextVersion</dt><dd class="acc">42</dd>
          <dt>providerDeltaId</dt><dd>demo_delta_001</dd>
          <dt>appliedAt</dt><dd>2026-06-05T…Z</dd>
        </dl>
      </div>

      <div class="pnl pnl-soft" style="padding:11px 14px; margin-top:auto; border-style:dashed;">
        <div class="kicker" style="margin-bottom:8px;">Guardrails — same key, replayed</div>
        <div class="row" style="justify-content:space-between; margin-bottom:6px;"><span class="tiny mono muted">same payload</span><span class="badge idle"><span class="bd"></span> duplicate</span></div>
        <div class="row" style="justify-content:space-between; margin-bottom:6px;"><span class="tiny mono muted">different payload</span><span class="badge fail"><span class="bd"></span> idempotency_key_conflict</span></div>
        <div class="row" style="justify-content:space-between;"><span class="tiny mono muted">prevVersion 40</span><span class="badge fail"><span class="bd"></span> version_conflict</span></div>
      </div>
    </div>
  </div>
</div>`;
