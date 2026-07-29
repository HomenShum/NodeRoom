/**
 * trust-surface-core.mjs — the measurement and the verdict, in one place.
 *
 * Split out of trust-surface-audit.mjs so the self-test exercises the REAL
 * probe rather than a copy of it. A self-test against a duplicated
 * implementation is itself a vacuous pass: it proves the copy works.
 *
 * Clause 1  Inspectable       — decision state readable from the DOM.
 * Clause 2  Not styled to     — no motion on decision affordances; no
 *           imply an outcome    acceptance styling on a pending thing.
 */

/** Runs IN the page. Returns FACTS ONLY — no verdicts. */
export const PROBE = () => {
  const TRUST_WORDS = /(propos|conflict|failed|failure|error|diff|review|approve|reject|accept|decline|consent|permission|grant|confirm|pending|unsaved|discard)/i;
  const DECISION_VERB = /^(accept|approve|reject|decline|confirm|discard|allow|deny|grant|apply|commit|merge|dismiss|undo|revert)\b/i;
  const SUCCESS_HINT = /(success|verified|accepted|approved|confirmed|complete|done|valid|passed)/i;
  const STATE_ATTRS = ["data-state", "data-status", "data-boot-state", "data-decision", "data-trust-state"];

  const painted = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    }
    return true;
  };
  const stateOf = (el) => {
    for (const a of STATE_ATTRS) if (el.hasAttribute(a)) return { attr: a, value: el.getAttribute(a) };
    return null;
  };

  const qualified = [];
  const CANDIDATES = "[data-testid],[data-state],[data-status],[data-boot-state],[data-decision],[data-trust-state],[role=dialog],[role=alertdialog],[role=alert],section,aside,form,article,main";
  for (const el of document.querySelectorAll(CANDIDATES)) {
    if (!painted(el)) continue;
    const text = (el.innerText || "").slice(0, 400);
    const tid = el.getAttribute("data-testid") ?? "";
    if ((el.innerText || "").length > 3000) continue; // page wrappers are not surfaces

    const declared = stateOf(el);

    // Enumeration used to be pure prose matching, which failed in BOTH
    // directions at once: it missed a real failed-boot surface whose copy reads
    // "Could not open the room" (no trust word), and it flagged marketing heroes
    // for containing the word "review". A gate that ignores the very attribute
    // it demands is not measuring what it claims to.
    //
    // A surface qualifies if it DECLARES a state — that is definitional — or if
    // trust language sits together with something to actually decide.
    const affordanceCount = [...el.querySelectorAll("button,[role=button],a[href],input[type=submit]")].filter((b) => {
      const label = (b.innerText || b.getAttribute("aria-label") || "").trim();
      return label && DECISION_VERB.test(label) && painted(b);
    }).length;
    const qualifies = !!declared || (TRUST_WORDS.test(tid + " " + text) && affordanceCount > 0);
    if (!qualifies) continue;
    const affordances = [];
    for (const b of el.querySelectorAll("button,[role=button],a[href],input[type=submit]")) {
      if (!painted(b)) continue;
      const label = (b.innerText || b.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
      if (!label || !DECISION_VERB.test(label)) continue;
      const s = getComputedStyle(b);
      const motion =
        (s.transitionDuration || "").split(",").some((d) => parseFloat(d) > 0) ||
        (s.animationName && s.animationName !== "none");
      affordances.push({
        label: label.slice(0, 48),
        motion,
        transitionDuration: s.transitionDuration,
        animationName: s.animationName,
        successStyled: SUCCESS_HINT.test(b.className?.toString?.() ?? ""),
      });
    }
    qualified.push({
      el,
      testid: tid || null,
      role: el.getAttribute("role") || null,
      declared,
      pendingLike: /pending|unsaved|propos|review|confirm/i.test(tid + " " + text),
      affordances,
      snippet: text.replace(/\s+/g, " ").slice(0, 90),
    });
  }

  // Keep only the INNERMOST qualifying element. A <main> wrapping a proposal
  // card is not a second trust surface — counting it as one both inflates the
  // surface count and reports a clause-1 failure against a wrapper that was
  // never meant to declare state.
  const surfaces = qualified
    .filter((q) => !qualified.some((o) => o.el !== q.el && q.el.contains(o.el)))
    .map(({ el, ...rest }) => rest);

  return { surfaces };
};

/**
 * Verdict, computed in Node from the facts. Every failure names the surface and
 * the clause, and the result always carries what was MEASURED — a bare PASS
 * cannot be checked for vacuity.
 */
export const verdict = ({ surfaces }) => {
  const failures = [];
  for (const s of surfaces) {
    const id = s.testid || s.role || s.snippet.slice(0, 40);
    if (!s.declared) {
      failures.push({ surface: id, clause: 1, why: "no decision-state attribute on the owning element" });
    }
    for (const a of s.affordances) {
      if (a.motion) {
        failures.push({
          surface: id, clause: 2,
          why: `decision affordance "${a.label}" animates (transition ${a.transitionDuration}, animation ${a.animationName})`,
        });
      }
      if (a.successStyled && s.declared && /pending|proposed|undecided/i.test(s.declared.value ?? "")) {
        failures.push({
          surface: id, clause: 2,
          why: `affordance "${a.label}" carries success styling while state is "${s.declared.value}"`,
        });
      }
    }
  }
  const measured = {
    surfaces: surfaces.length,
    affordances: surfaces.reduce((a, s) => a + s.affordances.length, 0),
    declaredStates: surfaces.filter((s) => s.declared).length,
  };
  // A run that found no surfaces has not passed — it has not run. This is the
  // exact case that makes an audit vacuous, so it is a distinct outcome.
  const status = surfaces.length === 0 ? "NOT_RUN" : failures.length === 0 ? "PASS" : "FAIL";
  return { status, measured, failures };
};

export const describe = (v) =>
  `${v.status} — ${v.measured.surfaces} trust surface(s), ${v.measured.affordances} decision affordance(s), ` +
  `${v.measured.declaredStates} with a declared state` +
  (v.failures.length ? `; ${v.failures.length} failure(s)` : "");
