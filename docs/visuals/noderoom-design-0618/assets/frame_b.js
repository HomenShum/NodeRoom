/* Direction B — Runtime Pipeline (architecture flow, motion-forward) */
window.FRAME_B = `
<div class="fr">
  <div class="fr-top">
    <div class="fr-mark">N</div>
    <div class="fr-brand">NodeAgent <span>/ Runtime</span></div>
    <div class="fr-tabs"><div class="fr-tab">Run</div><div class="fr-tab on">Runtime</div><div class="fr-tab">Sheet</div></div>
    <div class="fr-spacer"></div>
    <div class="fr-vpill">mission · 1 of 1</div>
    <button class="fr-run"><span class="dot"></span> Step ▸</button>
  </div>

  <div style="flex:1; padding:24px 26px; display:flex; flex-direction:column; gap:20px; min-height:0;">

    <!-- mission bar -->
    <div class="pnl" style="padding:14px 18px; display:flex; align-items:center; gap:16px; background:var(--bg-secondary);">
      <span class="kicker">Mission</span>
      <span style="font-size:13px; color:var(--text-secondary); flex:1;">Find the right source, summarize it, update the notebook, and preview spreadsheet impact.</span>
      <span class="badge ok"><span class="bd"></span> 4 / 6 steps</span>
    </div>

    <!-- pipeline -->
    <div class="kicker">Agent proposes &nbsp;·&nbsp; bounded tools commit</div>
    <div class="pipe">
      <div class="pnode flowed done">
        <div class="pico"><span class="bd"></span>context</div>
        <div class="pnode-t">Context</div>
        <div class="pnode-d">Public + private chat, candidate docs scored.</div>
      </div>
      <div class="pnode flowed done">
        <div class="pico"><span class="bd"></span>synthesis</div>
        <div class="pnode-t">Search</div>
        <div class="pnode-d">2 sources scored &gt; 0, bundle selected.</div>
      </div>
      <div class="pnode flowed done">
        <div class="pico"><span class="bd"></span>notebook</div>
        <div class="pnode-t">Synthesis</div>
        <div class="pnode-d">Grounded answer, conf 0.79.</div>
      </div>
      <div class="pnode flowed done">
        <div class="pico"><span class="bd"></span>notebook</div>
        <div class="pnode-t">Notebook</div>
        <div class="pnode-d">Heading + paragraph blocks written.</div>
      </div>

      <div class="gate">
        <span class="gate-i">⛬</span>
        <span class="gate-l">MCP tool boundary</span>
      </div>

      <div class="pnode active">
        <div class="pico" style="color:#E0875F;"><span class="bd"></span>spreadsheet</div>
        <div class="pnode-t">Spreadsheet sync</div>
        <div class="pnode-d">Versioned delta through the tool.</div>
      </div>
      <div class="pnode">
        <div class="pico"><span class="bd"></span>privacy</div>
        <div class="pnode-t">Boundary</div>
        <div class="pnode-d">Validate public / private output.</div>
      </div>
    </div>

    <!-- active stage detail -->
    <div style="display:grid; grid-template-columns:1.1fr .9fr; gap:18px; flex:1; min-height:0;">
      <div class="pnl" style="padding:18px; display:flex; flex-direction:column; gap:13px;">
        <div class="row" style="justify-content:space-between;">
          <div class="row gap10">
            <span style="width:24px;height:24px;border-radius:7px;background:rgba(217,119,87,.18);color:#E0875F;display:flex;align-items:center;justify-content:center;font-size:13px;">⛬</span>
            <div style="font-weight:700; font-size:13.5px;">nodeagent.apply_spreadsheet_delta</div>
          </div>
          <span class="badge ok"><span class="bd"></span> applied</span>
        </div>
        <div class="tiny muted">The agent proposes the delta; the tool owns idempotency, version checks, and stable row IDs.</div>
        <div class="divider"></div>
        <div style="display:flex; flex-direction:column; gap:7px;">
          <div class="row" style="justify-content:space-between;"><span class="tiny mono muted">1 · check idempotency key</span><span class="badge ok"><span class="bd"></span> new</span></div>
          <div class="row" style="justify-content:space-between;"><span class="tiny mono muted">2 · previousVersion === 41</span><span class="badge ok"><span class="bd"></span> match</span></div>
          <div class="row" style="justify-content:space-between;"><span class="tiny mono muted">3 · apply delta · stable row ids</span><span class="badge ok"><span class="bd"></span> ok</span></div>
          <div class="row" style="justify-content:space-between;"><span class="tiny mono muted">4 · increment → version 42</span><span class="badge ok"><span class="bd"></span> committed</span></div>
        </div>
      </div>

      <div class="pnl" style="padding:18px; background:var(--bg-secondary); display:flex; flex-direction:column; gap:12px;">
        <div class="row" style="justify-content:space-between;">
          <div class="kicker">Canonical sheet</div>
          <div class="row mono gap6" style="font-size:11.5px;"><span class="fr-vpill">v41</span><span class="muted">→</span><span class="fr-vpill" style="color:#E0875F;border-color:rgba(217,119,87,.4);">v42</span></div>
        </div>
        <table class="sheet">
          <thead><tr><th>row</th><th>label</th><th style="text-align:right;">value</th><th style="text-align:right;">Δ</th></tr></thead>
          <tbody>
            <tr><td class="rowid">r_revenue</td><td>Revenue</td><td class="num">10,000</td><td class="num acc" style="color:#E0875F;">0.79</td></tr>
            <tr class="new"><td class="rowid">r_agent_note</td><td>Agent synthesis</td><td class="num" style="font-style:italic;">summary…</td><td class="null">null</td></tr>
            <tr><td class="rowid">r_cogs</td><td>COGS</td><td class="num">4,000</td><td class="null">—</td></tr>
            <tr><td class="rowid">r_gross_profit</td><td>Gross Profit</td><td class="num">6,000</td><td class="null">—</td></tr>
          </tbody>
        </table>
        <div class="tiny muted mono">affectedRange · rowIds [r_agent_note, r_revenue] · cols [1,2]</div>
      </div>
    </div>
  </div>
</div>`;
