/* Direction A — Workspace Console (3-pane product layout) */
window.FRAME_A = `
<div class="fr">
  <div class="fr-top">
    <div class="fr-mark">N</div>
    <div class="fr-brand">NodeAgent <span>/ Run</span></div>
    <div class="fr-tabs">
      <div class="fr-tab on">Run</div>
      <div class="fr-tab">Trace</div>
      <div class="fr-tab">Sheet</div>
    </div>
    <div class="fr-spacer"></div>
    <div class="fr-vpill">sheet_nodeagent_demo · v41</div>
    <button class="fr-run"><span class="dot"></span> Run mission</button>
  </div>

  <div style="flex:1; display:grid; grid-template-columns:316px 1fr 332px; min-height:0;">

    <!-- LEFT: collaborative context + composer -->
    <div style="border-right:1px solid var(--border-color); padding:18px 16px; display:flex; flex-direction:column; gap:14px; min-height:0;">
      <div class="kicker">Collaborative context</div>
      <div style="flex:1; min-height:0; overflow:hidden;">
        <div class="msg">
          <div class="av u">FL</div>
          <div class="msg-b">
            <div class="msg-h"><span class="msg-name">Finance Lead</span><span class="msg-tag pub">public</span></div>
            <div class="msg-txt">Can NodeAgent find the right source for the NetSuite variance?</div>
          </div>
        </div>
        <div class="msg is-priv">
          <div class="av h">H</div>
          <div class="msg-b">
            <div class="msg-h"><span class="msg-name">Homen</span><span class="msg-tag prv"><span class="lock">🔒</span> private</span></div>
            <div class="msg-txt priv">Private note: explain why null cells should persist through spreadsheet sync.</div>
          </div>
        </div>
        <div class="msg">
          <div class="av a">AI</div>
          <div class="msg-b">
            <div class="msg-h"><span class="msg-name">Agent</span><span class="msg-tag agn">/ask</span></div>
            <div class="msg-txt mono" style="font-size:11.5px;">summarize the latest evidence for spreadsheet sync reliability</div>
          </div>
        </div>
      </div>
      <div class="pnl" style="padding:13px; background:var(--bg-secondary);">
        <div class="kicker" style="margin-bottom:8px;">Mission</div>
        <div style="font-size:12.5px; line-height:1.5; color:var(--text-secondary);">Find the right source, summarize it, update the notebook, and preview spreadsheet impact.</div>
        <div class="row" style="margin-top:11px; justify-content:space-between;">
          <span class="badge idle"><span class="bd"></span> includePrivate</span>
          <button class="fr-run" style="padding:7px 12px;"><span class="dot"></span> Run</button>
        </div>
      </div>
    </div>

    <!-- CENTER: answer + notebook -->
    <div style="padding:20px 24px; overflow:hidden; display:flex; flex-direction:column; gap:16px; min-height:0;">
      <div class="pnl" style="padding:16px 18px;">
        <div class="row" style="justify-content:space-between; margin-bottom:11px;">
          <div class="row gap10"><div class="av a" style="border-radius:6px;">AI</div><div style="font-weight:700; font-size:13.5px;">Agent answer</div></div>
          <span class="conf"><span class="bd" style="width:5px;height:5px;border-radius:50%;background:#5ED39E;"></span> confidence 0.79</span>
        </div>
        <div style="font-size:13px; line-height:1.65; color:var(--text-secondary);">
          Found 2 relevant sources and synthesized a grounded answer. The response cites the selected source bundle and preserves the public / private boundary<span class="supn">[1][2]</span>.
        </div>
        <div class="cites" style="margin-top:13px;">
          <div class="cite"><div class="cite-n">1</div><div class="cite-t">NodeBench home-v4 — TipTap / graph / presentation / event delta</div><div class="cite-k">doc</div></div>
          <div class="cite"><div class="cite-n">2</div><div class="cite-t">ScratchNode home-v5 — live room and wiki handoff</div><div class="cite-k">wiki</div></div>
        </div>
      </div>

      <div class="pnl" style="padding:16px 18px; flex:1; min-height:0; overflow:hidden;">
        <div class="row" style="justify-content:space-between; margin-bottom:12px;">
          <div class="kicker">Notebook · TipTap blocks</div>
          <span class="badge idle"><span class="bd"></span> nb_run</span>
        </div>
        <div class="nb-block">
          <div class="nb-h">NodeAgent synthesis</div>
        </div>
        <div class="nb-block agent">
          <div class="nb-p">Found 2 relevant source(s): NodeBench home-v4, ScratchNode home-v5. The answer should cite the selected source bundle and preserve public/private boundaries.</div>
          <div class="nb-meta"><span class="badge ok"><span class="bd"></span> draft</span><span class="tiny muted mono">sources · doc_v4 · doc_v5</span></div>
        </div>
        <div class="nb-block">
          <div class="nb-p" style="color:var(--text-muted);">Null cells persist as real blank values through versioned sync.</div>
          <div class="nb-meta"><span class="badge rev"><span class="bd"></span> needs_review</span><span class="tiny muted mono">from private note · not in public output</span></div>
        </div>
      </div>
    </div>

    <!-- RIGHT: trace + spreadsheet sync -->
    <div style="border-left:1px solid var(--border-color); padding:18px 16px; display:flex; flex-direction:column; gap:16px; min-height:0;">
      <div>
        <div class="kicker" style="margin-bottom:12px;">Runtime trace</div>
        <div class="trace">
          <div class="tstep done"><div class="tnode"></div><div class="tstep-b"><div class="tstep-n">Gather collaborative context</div><div class="tstep-k">context</div></div></div>
          <div class="tstep done"><div class="tnode"></div><div class="tstep-b"><div class="tstep-n">Search &amp; synthesize answer</div><div class="tstep-k">synthesis</div></div></div>
          <div class="tstep done"><div class="tnode"></div><div class="tstep-b"><div class="tstep-n">Write TipTap notebook blocks</div><div class="tstep-k">notebook</div></div></div>
          <div class="tstep done"><div class="tnode"></div><div class="tstep-b"><div class="tstep-n">Graph context &amp; expansion</div><div class="tstep-k">graph</div></div></div>
          <div class="tstep active"><div class="tnode"></div><div class="tstep-b"><div class="tstep-n">Apply spreadsheet delta</div><div class="tstep-k">spreadsheet · running</div></div></div>
          <div class="tstep"><div class="tnode"></div><div class="tstep-b"><div class="tstep-n">Validate output boundary</div><div class="tstep-k">privacy</div></div></div>
        </div>
      </div>
      <div class="pnl" style="padding:14px; background:var(--bg-secondary);">
        <div class="row" style="justify-content:space-between; margin-bottom:10px;">
          <div class="kicker">Spreadsheet sync</div>
          <span class="badge ok"><span class="bd"></span> applied</span>
        </div>
        <div class="row mono" style="font-size:12px; gap:8px; margin-bottom:11px;">
          <span class="fr-vpill">v41</span><span class="muted">→</span><span class="fr-vpill" style="color:#E0875F; border-color:rgba(217,119,87,.4);">v42</span>
        </div>
        <dl class="kv">
          <dt>idempotency</dt><dd>idem_1f9c…7a2</dd>
          <dt>providerDelta</dt><dd>demo_delta_001</dd>
          <dt>affectedRange</dt><dd class="acc">r_revenue · cols 1,2</dd>
        </dl>
      </div>
    </div>
  </div>
</div>`;
