/* ============================================================================
   NodeAgent Mobile — governed deck artifact workbench
   The mobile translation of the Z.ai artifact loop, kept review-first:
   plan → sandboxed slide preview → tap-to-comment → localized patch proposal →
   approve → export → planned-vs-actual receipt. Deep editing stays desktop.
   Strict-TSX port of terra/na-deck.jsx (window.NADeck = { ArtifactSheet }).
   ============================================================================ */
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as D from "./mobileData";
import { Ico } from "./MobileIcons";
import type { IconName } from "./MobileIcons";
import { Pill } from "./MobileScreens";
import type { Tone } from "./mobileData";
import type { MobileCtx } from "./mobileTypes";

const { useState, useRef } = React;

// ── runtime shapes (deck workbench local state) ──
interface DeckSlide {
  id: string;
  index: number;
  title: string;
  status: string;
  html: string;
}
interface PatchEvidence {
  n: string;
  text: string;
  verified: boolean;
}
interface DeckPatch {
  target: string;
  before: string;
  after: string;
  evidence: PatchEvidence[];
}
interface RegionInfo {
  label: string;
  text: string;
}
interface DeckChatMsg {
  id: string;
  role: "user" | "agent";
  text?: string;
  target?: string | null;
  patch?: DeckPatch;
  variant?: string;
  chip?: string;
}
interface DeckComment {
  id: string;
  slide: number;
  target: string;
  text: string;
  status: string;
}
interface PendingPatch {
  patch: DeckPatch;
  slideId: string;
}

const STATUS_TONE: Record<string, string> = { approved: 'ok', needs_review: 'warn', draft: 'mute', proposed: 'accent', exported: 'ok' };

export function ArtifactSheet({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const DECK = D.DECK;
  const [tab, setTab] = useState<string>('slides');
  const [active, setActive] = useState<number>(0);
  const [slides, setSlides] = useState<DeckSlide[]>(DECK.slides);
  const [comments, setComments] = useState<DeckComment[]>([]);
  const [draft, setDraft] = useState<string>('');
  const [target, setTarget] = useState<RegionInfo | null>(null);         // {label,text} of picked element
  const [deckChat, setDeckChat] = useState<DeckChatMsg[]>([]);       // {id, role, text, target?, patch?, variant?, chip?}
  const [pending, setPending] = useState<PendingPatch | null>(null);       // { patch, slideId }
  const [exported, setExported] = useState<boolean>(false);
  const [present, setPresent] = useState<boolean>(false);
  const composerRef = useRef<HTMLInputElement>(null);
  const mid = useRef<number>(1);
  const slide = slides[active];

  const buildPatch = (): DeckPatch => ({
    target: target ? target.label : ('Slide ' + slide.index + ' · ' + slide.title),
    before: (target && target.text) ? target.text : DECK.patchSample.before,
    after: DECK.patchSample.after,
    evidence: DECK.patchSample.evidence,
  });

  // tap-to-comment on a slide element → scope the composer to that element
  const selectRegion = (info: RegionInfo): void => { setTarget(info); setTab('slides'); requestAnimationFrame(() => { const el = composerRef.current; if (el) el.focus(); }); };
  const clearTarget = (): void => setTarget(null);

  // send a message → agent proposes a localized, sourced patch you accept inline
  const send = (txt?: string): void => {
    const text = (txt !== undefined ? txt : draft).trim(); if (!text) return;
    const push = (m: Omit<DeckChatMsg, 'id'>): void => setDeckChat((c) => [...c, Object.assign({ id: 'm' + (mid.current++) }, m)]);
    push({ role: 'user', text, target: target ? target.label : null });
    setDraft('');
    const patch = buildPatch();
    const slideId = slide.id;
    setTimeout(() => {
      push({ role: 'agent', variant: 'status', text: 'Drafting a sourced patch for ' + patch.target + '…' });
      setTimeout(() => { push({ role: 'agent', patch: patch }); setPending({ patch: patch, slideId: slideId }); }, 850);
    }, 320);
    setTarget(null);
  };
  const acceptPatch = (): void => {
    if (!pending) return;
    const patch = pending.patch;
    setSlides((prev) => prev.map((s) => s.id === pending.slideId
      ? Object.assign({}, s, { status: 'approved', html: s.html.replace(patch.before, patch.after) })
      : s));
    setComments((prev) => [{ id: 'c' + Date.now(), slide: slide.index, target: patch.target, text: 'Requested via composer', status: 'accepted' }, ...prev]);
    setDeckChat((c) => [...c, { id: 'm' + (mid.current++), role: 'agent', chip: 'ok', text: 'Applied the patch and marked the slide approved.' }]);
    setPending(null);
    ctx.toast('Patch applied to slide ' + slide.index);
  };
  const rejectPatch = (): void => {
    if (!pending) return;
    setDeckChat((c) => [...c, { id: 'm' + (mid.current++), role: 'agent', chip: 'bad', text: 'Kept the original. Logged the request without changing the slide.' }]);
    setPending(null);
    ctx.toast('Kept the original');
  };
  const DECK_QUICK: { label: string; icon: IconName; primary?: boolean; text: string }[] = [
    { label: 'Sharpen this slide', icon: 'sparkles', primary: true, text: 'Make this slide sharper and more finance-native.' },
    { label: 'Tighten copy', icon: 'pen', text: 'Tighten the copy on this slide.' },
    { label: 'Check the claim', icon: 'shield', text: 'Is the claim on this slide source-backed?' },
  ];

  const TABS: [string, string, IconName][] = [
    ['plan', 'Plan', 'sparkles'],
    ['slides', 'Slides', 'layers'],
    ['comments', 'Comments', 'message'],
    ['evidence', 'Evidence', 'shield'],
    ['export', 'Export', 'download'],
  ];

  return React.createElement(React.Fragment, null,
    present && ReactDOM.createPortal(
      React.createElement(PresentOverlay, { slides, title: DECK.title, start: active, onClose: () => setPresent(false) }),
      document.querySelector('.na-app') || document.body),
    // header
    React.createElement('div', { className: 'na-sheet-head' },
      ctx.canBack ? React.createElement('button', { className: 'na-headback', onClick: ctx.backSheet, 'aria-label': 'Back' }, Ico('chevL')) : null,
      React.createElement('div', { className: 'st' },
        React.createElement('strong', null, DECK.title),
        React.createElement('span', null, DECK.audience + ' · ' + slides.length + ' slides · ' + DECK.privacy)),
      React.createElement('button', { className: 'na-close', onClick: ctx.closeSheet, 'aria-label': 'Close' }, Ico('x'))),

    // tab bar
    React.createElement('div', { className: 'na-art-tabs' },
      TABS.map(([id, label, icon]) => React.createElement('button', {
        key: id, className: 'na-art-tab', 'data-active': tab === id,
        onClick: () => { setTab(id); },
      }, Ico(icon), label,
        id === 'comments' && comments.length ? React.createElement('span', { className: 'n' }, comments.length) : null))),

    React.createElement('div', { className: 'na-sheet-body', 'data-pad': tab === 'slides' ? 'compose' : null },
      tab === 'plan' && React.createElement(PlanView, { DECK }),
      tab === 'slides' && React.createElement(SlidesView, { slides, active, setActive, slide, deckChat, onSelectRegion: selectRegion, onPresent: () => setPresent(true), onExport: () => setTab('export') }),
      tab === 'comments' && React.createElement(CommentsView, { comments, onNew: () => { setTab('slides'); } }),
      tab === 'evidence' && React.createElement(EvidenceView, { ctx }),
      tab === 'export' && React.createElement(ExportView, { DECK, ctx, exported, onExport: (ver?: string) => { setExported(true); ctx.toast((ver ? ver + ' · ' : '') + 'CardioNova_update.pptx downloaded'); } })),

    // bottom region ─ a chat composer on the Slides tab (mirrors the sheet workbench)
    tab === 'slides' && React.createElement('div', { className: 'na-sheet-compose' },
      pending && React.createElement(DeckPatchTray, { patch: pending.patch, onAccept: acceptPatch, onReject: rejectPatch }),
      target && React.createElement('div', { className: 'na-compose-target' },
        Ico('target'), React.createElement('span', null, target.label),
        React.createElement('button', { onClick: clearTarget, 'aria-label': 'Clear' }, Ico('x'))),
      !target && React.createElement('div', { className: 'na-compose-quick' },
        DECK_QUICK.map((q) => React.createElement('button', { key: q.label, className: q.primary ? 'primary' : '', onClick: () => send(q.text) }, Ico(q.icon), q.label))),
      React.createElement('div', { className: 'na-compose-row' },
        React.createElement('span', { className: 'mk' }, Ico('sparkles')),
        React.createElement('input', {
          ref: composerRef, className: 'na-compose-input', value: draft, type: 'text',
          placeholder: target ? 'Describe the change for this element…' : 'Ask NodeAgent to revise a slide…  or tap any element to scope it',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); send(); } },
        }),
        React.createElement('button', { className: 'na-compose-send', disabled: !draft.trim(), onClick: () => send(), 'aria-label': 'Send' }, Ico('arrowUp'))),
      React.createElement('p', { className: 'na-compose-note' }, Ico('lock'), 'Preview only — the agent proposes a sourced patch; the slide changes only when you accept.')),

    // plan tab keeps its approve action
    tab === 'plan' && React.createElement('div', { className: 'na-sheet-foot' },
      React.createElement('button', { className: 'na-btn primary full', onClick: () => setTab('slides') }, Ico('check'), 'Approve generation')));
}

// ── PLAN (z.ai-style agent chat transcript) ──
function PlanView({ DECK }: { DECK: typeof D.DECK }): React.ReactElement {
  const P = DECK.plan;
  const mark = (st: string): React.ReactElement => st === 'done'
    ? React.createElement('span', { className: 'na-todo-mark done' }, Ico('check'))
    : st === 'running'
      ? React.createElement('span', { className: 'na-todo-mark running' }, React.createElement('i', { className: 'spin' }))
      : React.createElement('span', { className: 'na-todo-mark' });
  const done = P.todos.filter((t) => t.status === 'done').length;
  return React.createElement('div', { className: 'na-zchat' },
    // user request bubble
    React.createElement('div', { className: 'na-zmsg user' }, P.goal),
    // agent turn
    React.createElement('div', { className: 'na-zmsg agent' },
      React.createElement('div', { className: 'na-zhead' }, React.createElement('span', { className: 'av' }, Ico('sparkles')), 'NodeAgent'),
      React.createElement('p', { className: 'na-ztext' }, 'Here’s the plan. I’ll read the room’s sources and draft the deck as a preview — nothing gets written without your approval.'),
      React.createElement('div', { className: 'na-todos' },
        React.createElement('div', { className: 'na-todos-head' },
          Ico('check'), 'Todos', React.createElement('span', { className: 'c' }, done + ' / ' + P.todos.length)),
        P.todos.map((t, i) => React.createElement('div', { key: i, className: 'na-todo', 'data-st': t.status },
          mark(t.status),
          React.createElement('span', { className: 'tx' }, t.text)))),
      React.createElement('div', { className: 'na-ran' }, Ico('sparkles'), 'Ran ' + P.ran + ' commands'),
      React.createElement('div', { className: 'na-guard' }, Ico('lock'), P.guard)));
}

// ── SLIDES (thumbnail strip + sandboxed preview with live element selection) ──
// Same-origin srcDoc lets the parent read the slide DOM: hover paints a
// highlight box over the real element, click pins it and scopes the comment.
function SlidesView({ slides, active, setActive, slide, deckChat, onSelectRegion, onPresent, onExport }: {
  slides: DeckSlide[];
  active: number;
  setActive: (i: number) => void;
  slide: DeckSlide;
  deckChat: DeckChatMsg[];
  onSelectRegion: (info: RegionInfo) => void;
  onPresent: () => void;
  onExport: () => void;
}): React.ReactElement {
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ left: number; top: number; w: number; h: number; tag: string; text: string } | null>(null);
  const [sel, setSel] = useState<{ left: number; top: number; w: number; h: number; tag: string; text: string } | null>(null);
  const [zoomedIn, setZoomedIn] = useState<boolean>(false);
  const [fit, setFit] = useState<number>(0.36);
  React.useEffect(() => { setHover(null); setSel(null); setZoomedIn(false); }, [active]);
  React.useLayoutEffect(() => {
    const measure = (): void => { const w = wrapRef.current && wrapRef.current.clientWidth; if (w) setFit(w / 960); };
    measure(); window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const zoom = fit * (zoomedIn ? 1.6 : 1);

  const pickable = /^(h1|h2|h3|p|li|ul|span|div|section)$/;
  const attach = (): void => {
    const f = frameRef.current; if (!f) return;
    const doc = f.contentDocument; if (!doc || !doc.body) return;
    doc.body.style.cursor = 'crosshair';
    const climb = (el: Element): Element => { let n: Element | null = el; while (n && n !== doc.body && !pickable.test(n.tagName.toLowerCase())) n = n.parentElement; return (n && n !== doc.body) ? n : el; };
    const info = (el: Element) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height, tag: el.tagName.toLowerCase(), text: ((el as HTMLElement).innerText || '').trim().replace(/\s+/g, ' ').slice(0, 70) }; };
    doc.addEventListener('mousemove', (e: MouseEvent) => { const el = climb(e.target as Element); setHover(el && el !== doc.body ? info(el) : null); });
    doc.addEventListener('mouseleave', () => setHover(null));
    doc.addEventListener('click', (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); const el = climb(e.target as Element); if (!el || el === doc.body) return; const i = info(el); setSel(i); onSelectRegion({ label: i.tag + ' · “' + (i.text || 'element') + '”', text: i.text }); });
  };
  const boxStyle = (b: { left: number; top: number; w: number; h: number }): React.CSSProperties => ({ left: b.left + 'px', top: b.top + 'px', width: b.w + 'px', height: b.h + 'px' });

  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'na-thumbs' },
      slides.map((s, i) => React.createElement('button', {
        key: s.id, className: 'na-thumb', 'data-active': i === active, onClick: () => setActive(i),
      },
        React.createElement('span', { className: 'na-thumb-prev' },
          React.createElement('iframe', { title: s.title, srcDoc: s.html, sandbox: 'allow-same-origin', scrolling: 'no', tabIndex: -1, style: { width: '960px', height: '600px', border: 0, transform: 'scale(0.092)', transformOrigin: 'top left', pointerEvents: 'none' } })),
        React.createElement('span', { className: 'na-thumb-foot' },
          React.createElement('span', { className: 'ti' }, s.index),
          React.createElement('span', { className: 'tt' }, s.title),
          React.createElement('span', { className: 'td', 'data-tone': STATUS_TONE[s.status] })))),
    React.createElement('div', { className: 'na-slide-toolbar' },
      React.createElement('span', { className: 'hint' }, Ico('target'), 'Tap a component to comment'),
      React.createElement('div', { className: 'na-slide-tools' },
        React.createElement('button', { className: 'na-tool', onClick: onPresent, 'aria-label': 'View all slides', title: 'View all' }, Ico('expand')),
        React.createElement('button', { className: 'na-tool', 'data-on': zoomedIn, onClick: () => setZoomedIn((v) => !v), 'aria-label': zoomedIn ? 'Fit slide' : 'Zoom in', title: zoomedIn ? 'Fit' : 'Zoom' }, Ico('search')),
        React.createElement('button', { className: 'na-tool', onClick: onExport, 'aria-label': 'Export deck', title: 'Export' }, Ico('download')))),
    React.createElement('div', { className: 'na-slidewrap', ref: wrapRef },
      React.createElement('div', { className: 'na-slide-scale', style: { zoom: zoom } },
        React.createElement('iframe', {
          ref: frameRef, className: 'na-slide', title: slide.title, srcDoc: slide.html,
          sandbox: 'allow-same-origin', scrolling: 'no', onLoad: attach,
          style: { width: '960px', height: '600px' },
        }),
        hover ? React.createElement('div', { className: 'na-hl', style: boxStyle(hover) }) : null,
        sel ? React.createElement('div', { className: 'na-hl sel', style: boxStyle(sel) },
          React.createElement('span', { className: 'na-hl-tag' }, sel.tag)) : null)),
    React.createElement('div', { className: 'na-slide-meta' },
      React.createElement('span', null, 'Slide ' + slide.index + ' · ' + slide.title),
      React.createElement(Pill, { tone: STATUS_TONE[slide.status] as Tone }, slide.status.replace('_', ' '))),
    // localized conversation thread (mirrors the sheet workbench)
    deckChat && deckChat.length ? React.createElement('div', { className: 'na-zchat', style: { marginTop: 14 } },
      deckChat.map((m) => m.role === 'user'
        ? React.createElement('div', { key: m.id, className: 'na-zmsg user' },
            m.target ? React.createElement('span', { className: 'na-ztarget' }, Ico('target'), m.target) : null, m.text)
        : m.patch
          ? React.createElement('div', { key: m.id, className: 'na-zmsg agent' },
              React.createElement('div', { className: 'na-zhead' }, React.createElement('span', { className: 'av' }, Ico('sparkles')), 'NodeAgent'),
              React.createElement(DeckPatchInline, { patch: m.patch }))
          : React.createElement('div', { key: m.id, className: 'na-zmsg agent' },
              React.createElement('div', { className: 'na-zhead' }, React.createElement('span', { className: 'av' }, Ico('sparkles')), 'NodeAgent'),
              m.variant === 'status'
                ? React.createElement('p', { className: 'na-ztext muted' }, React.createElement('i', { className: 'spin sm' }), m.text)
                : React.createElement('p', { className: 'na-ztext' }, m.text),
              m.chip ? React.createElement('span', { className: 'na-zchip', 'data-tone': m.chip }, Ico(m.chip === 'ok' ? 'check' : 'x'), m.chip === 'ok' ? 'patch applied' : 'kept original') : null))) : null));
}

// ── PATCH PROPOSAL ──
function DeckPatchInline({ patch }: { patch: DeckPatch }): React.ReactElement {
  return React.createElement('div', { className: 'na-patch-inline' },
    React.createElement('div', { className: 'na-patch-k' }, Ico('diff'), patch.target),
    React.createElement('div', { className: 'na-diff before' },
      React.createElement('span', { className: 'lbl' }, 'Before'),
      React.createElement('p', null, patch.before)),
    React.createElement('div', { className: 'na-diff after' },
      React.createElement('span', { className: 'lbl' }, 'After'),
      React.createElement('p', null, patch.after)),
    React.createElement('div', { className: 'na-patch-ev' },
      patch.evidence.map((e) => React.createElement('span', { key: e.n, className: 'na-cite' + (e.verified ? '' : ' gap') },
        Ico(e.verified ? 'checkCircle' : 'gap'), React.createElement('sup', null, e.n), e.text))));
}

// pinned accept/reject tray above the composer (mirrors the sheet)
function DeckPatchTray({ patch, onAccept, onReject }: { patch: DeckPatch; onAccept: () => void; onReject: () => void }): React.ReactElement {
  return React.createElement('div', { className: 'na-patch-tray' },
    React.createElement('div', { className: 'na-patch-tray-top' },
      Ico('diff'), React.createElement('strong', null, 'Proposed · ' + patch.target)),
    React.createElement('div', { className: 'na-btn-row' },
      React.createElement('button', { className: 'na-btn sm', onClick: onReject }, Ico('x'), 'Reject'),
      React.createElement('button', { className: 'na-btn primary sm', onClick: onAccept }, Ico('check'), 'Accept patch')));
}

// ── COMMENT COMPOSER ──
function CommentComposer({ slide, region, controls, setControls, commentText, setCommentText, onCancel, onSubmit }: {
  ctx: MobileCtx;
  slide: DeckSlide;
  region: RegionInfo | null;
  controls: Record<string, number>;
  setControls: (c: Record<string, number>) => void;
  commentText: string;
  setCommentText: (s: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}): React.ReactElement {
  return React.createElement('div', { className: 'na-cc' },
    React.createElement('div', { className: 'na-cc-head' },
      React.createElement('button', { className: 'na-cc-back', onClick: onCancel, 'aria-label': 'Back' }, Ico('chevL')),
      React.createElement('div', null,
        React.createElement('strong', null, 'Comment'),
        React.createElement('span', null, 'Slide ' + slide.index + ' · ' + slide.title))),
    React.createElement('div', { className: 'na-cc-target' }, Ico(region ? 'target' : 'layers'),
      React.createElement('span', null, region ? region.label : 'Whole slide')),
    React.createElement('textarea', {
      className: 'na-field', value: commentText, autoFocus: true,
      placeholder: 'What should change here?  e.g. “make this more banker-readable”',
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setCommentText(e.target.value),
    }),
    React.createElement('div', { className: 'na-cc-controls' },
      D.REVISION_CONTROLS.map((c) => React.createElement('div', { key: c.id, className: 'na-ctl' },
        React.createElement('label', null, c.label),
        React.createElement('div', { className: 'na-seg' },
          c.options.map((opt, i) => React.createElement('button', {
            key: opt, 'data-active': controls[c.id] === i,
            onClick: () => setControls(Object.assign({}, controls, { [c.id]: i }) as Record<string, number>),
          }, opt)))))),
    React.createElement('button', { className: 'na-btn primary full', disabled: !commentText.trim(), onClick: onSubmit },
      Ico('sparkles'), 'Request patch'));
}

// ── PATCH PROPOSAL ──
function PatchCard({ patch, onAccept, onReject, onRegen }: {
  patch: DeckPatch;
  onAccept: () => void;
  onReject: () => void;
  onRegen: () => void;
}): React.ReactElement {
  return React.createElement('div', { className: 'na-patch' },
    React.createElement('div', { className: 'na-patch-k' }, Ico('diff'), 'Patch proposal · ' + patch.target),
    React.createElement('div', { className: 'na-diff before' },
      React.createElement('span', { className: 'lbl' }, 'Before'),
      React.createElement('p', null, patch.before)),
    React.createElement('div', { className: 'na-diff after' },
      React.createElement('span', { className: 'lbl' }, 'After'),
      React.createElement('p', null, patch.after)),
    React.createElement('div', { className: 'na-patch-ev' },
      patch.evidence.map((e) => React.createElement('span', { key: e.n, className: 'na-cite' + (e.verified ? '' : ' gap') },
        Ico(e.verified ? 'checkCircle' : 'gap'), React.createElement('sup', null, e.n), e.text))),
    React.createElement('div', { className: 'na-btn-row' },
      React.createElement('button', { className: 'na-btn', onClick: onReject }, Ico('x'), 'Reject'),
      React.createElement('button', { className: 'na-btn primary', onClick: onAccept }, Ico('check'), 'Accept patch')),
    React.createElement('button', { className: 'na-btn ghost full', onClick: onRegen, style: { marginTop: 2 } }, Ico('refresh'), 'Regenerate'));
}

// ── COMMENTS (chat thread — each comment is a turn with the agent's patch reply) ──
function CommentsView({ comments, onNew }: { comments: DeckComment[]; onNew: () => void }): React.ReactElement {
  if (!comments.length) return React.createElement('div', { className: 'na-empty' },
    React.createElement('div', { className: 'eico' }, Ico('message')),
    React.createElement('strong', null, 'No comments yet'),
    React.createElement('span', null, 'Open a slide and tap an element to start a thread with NodeAgent.'),
    React.createElement('button', { className: 'na-btn', onClick: onNew, style: { marginTop: 4 } }, Ico('layers'), 'Go to slides'));
  return React.createElement('div', { className: 'na-zchat' },
    comments.slice().reverse().map((c) => React.createElement(React.Fragment, { key: c.id },
      React.createElement('div', { className: 'na-zmsg user' },
        React.createElement('span', { className: 'na-ztarget' }, Ico('target'), 'Slide ' + c.slide + ' · ' + c.target),
        c.text),
      React.createElement('div', { className: 'na-zmsg agent' },
        React.createElement('div', { className: 'na-zhead' }, React.createElement('span', { className: 'av' }, Ico('sparkles')), 'NodeAgent'),
        React.createElement('p', { className: 'na-ztext' },
          c.status === 'accepted'
            ? 'Done — I applied the patch to slide ' + c.slide + ' and marked it approved.'
            : 'Kept the original. I logged the request but didn’t change the slide.'),
        React.createElement('span', { className: 'na-zchip', 'data-tone': c.status === 'accepted' ? 'ok' : 'bad' },
          Ico(c.status === 'accepted' ? 'check' : 'x'), c.status === 'accepted' ? 'patch applied' : 'patch rejected')))));
}

// ── EVIDENCE COVERAGE (sourced answer + follow-up chat) ──
function EvidenceView({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const E = D.EVIDENCE;
  const [open, setOpen] = useState<boolean>(true);
  const [thread, setThread] = useState<{ role: 'user' | 'agent'; text: string }[]>([]);
  const [draft, setDraft] = useState<string>('');
  const cites = E.support.filter((s) => s.kind === 'cite');
  const gaps = E.support.filter((s) => s.kind === 'gap');
  const answerNodes = [
    React.createElement('span', { key: 'a' }, E.answer + ' '),
    ...cites.map((c) => React.createElement('sup', { key: 'c' + c.n, className: 'na-inlinecite', 'data-v': c.verified }, c.n)),
  ];
  const reply = (q: string): string => {
    const s = q.toLowerCase();
    const hit = (E.followups || []).find((f) => f.match.some((m) => s.includes(m)));
    return hit ? hit.text : E.fallback;
  };
  const send = (): void => {
    const q = draft.trim(); if (!q) return;
    setThread((t) => [...t, { role: 'user', text: q }, { role: 'agent', text: reply(q) }]);
    setDraft('');
  };
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'na-srcbar' },
      React.createElement('button', { className: 'na-srctoggle', onClick: () => setOpen((v) => !v) },
        Ico('shield'), 'Used ' + cites.length + ' sources',
        React.createElement('span', { className: 'cx', 'data-open': open }, Ico('chevD'))),
      React.createElement('span', { className: 'na-srcclaim' }, E.claim, ' · ', React.createElement('em', null, 'needs_review'))),
    open ? React.createElement('div', { className: 'na-srclist' },
      cites.map((s) => React.createElement('button', { key: s.n, className: 'na-srcrow', onClick: () => ctx && ctx.openSource && ctx.openSource(s) },
        React.createElement('span', { className: 'n' }, s.n),
        React.createElement('span', { className: 'na-srctext' },
          React.createElement('strong', null, s.text),
          React.createElement('span', { className: 'h' }, s.host)),
        React.createElement('span', { className: 'na-srcv', 'data-v': s.verified }, Ico(s.verified ? 'checkCircle' : 'clock')),
        React.createElement('span', { className: 'na-srcopen' }, Ico('extlink'))))) : null,
    React.createElement('p', { className: 'na-answer' }, answerNodes),
    gaps.map((g, i) => React.createElement('div', { key: i, className: 'na-srcgap' }, Ico('gap'), g.text)),
    // follow-up conversation
    thread.length ? React.createElement('div', { className: 'na-zchat', style: { marginTop: 14 } },
      thread.map((m, i) => m.role === 'user'
        ? React.createElement('div', { key: i, className: 'na-zmsg user' }, m.text)
        : React.createElement('div', { key: i, className: 'na-zmsg agent' },
            React.createElement('div', { className: 'na-zhead' }, React.createElement('span', { className: 'av' }, Ico('sparkles')), 'NodeAgent'),
            React.createElement('p', { className: 'na-ztext' }, m.text)))) : null,
    // composer
    React.createElement('div', { className: 'na-zcompose' },
      React.createElement('span', { className: 'mk' }, Ico('sparkles')),
      React.createElement('input', {
        className: 'na-zinput', value: draft, type: 'text',
        placeholder: 'Ask a follow-up about this claim…',
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
        onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); send(); } },
      }),
      React.createElement('button', { className: 'na-zsend', disabled: !draft.trim(), onClick: send, 'aria-label': 'Send' }, Ico('arrowUp'))));
}

// ── EXPORT (ready · download · version history) ──
function ExportView({ DECK, ctx, exported, onExport }: {
  DECK: typeof D.DECK;
  ctx: MobileCtx;
  exported: boolean;
  onExport: (ver?: string) => void;
}): React.ReactElement {
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'na-export' },
      React.createElement('div', { className: 'na-export-ico' }, Ico('download')),
      React.createElement('div', { className: 'na-export-main' },
        React.createElement('strong', null, exported ? 'CardioNova_update.pptx' : DECK.exportFormat + ' export ready'),
        React.createElement('span', null, slidesLabel(DECK) + ' · ' + DECK.exportSize)),
      React.createElement(Pill, { tone: exported ? 'ok' : 'accent' }, exported ? 'exported' : 'ready')),
    React.createElement('button', { className: 'na-btn primary full', onClick: () => onExport() }, Ico('download'), exported ? 'Download again' : 'Download PPTX'),
    React.createElement('div', { className: 'na-kicker', style: { marginTop: 8 } }, 'Past versions'),
    React.createElement('div', { className: 'na-vers' },
      DECK.versions.map((v, i) => React.createElement('div', { key: i, className: 'na-ver', 'data-cur': !!v.current },
        React.createElement('span', { className: 'vtag' }, v.v),
        React.createElement('span', { className: 'vmain' },
          React.createElement('strong', null, v.label),
          React.createElement('span', { className: 'vt' }, v.t)),
        React.createElement('div', { className: 'na-ver-acts' },
          !v.current && React.createElement('button', { className: 'na-ver-act', onClick: () => ctx && ctx.toast('Restored ' + v.v + ' · deck reverted') }, 'Restore'),
          React.createElement('button', { className: 'na-ver-dl', onClick: () => onExport(v.v), 'aria-label': 'Download ' + v.v, title: 'Download ' + v.v }, Ico('download')))))));
}

function slidesLabel(DECK: typeof D.DECK): string { return DECK.slides.length + ' slides'; }

// ── PRESENT (full-deck viewer — see the whole PowerPoint) ──
function PresentOverlay({ slides, title, start, onClose }: {
  slides: DeckSlide[];
  title: string;
  start: number;
  onClose: () => void;
}): React.ReactElement {
  const [i, setI] = useState<number>(start || 0);
  const [grid, setGrid] = useState<boolean>(false);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const [stageFit, setStageFit] = useState<number>(0.4);
  const [cellFit, setCellFit] = useState<number>(0.18);
  React.useLayoutEffect(() => {
    const m = (): void => {
      if (stageRef.current) { const w = stageRef.current.clientWidth - 28; const h = stageRef.current.clientHeight - 28; setStageFit(Math.max(0.1, Math.min(w / 960, h / 600))); }
      if (gridRef.current) { const cw = (gridRef.current.clientWidth - 28 - 10) / 2; setCellFit(Math.max(0.08, cw / 960)); }
    };
    m(); window.addEventListener('resize', m);
    return () => window.removeEventListener('resize', m);
  }, [grid]);
  const go = (d: number): void => setI((n) => Math.max(0, Math.min(slides.length - 1, n + d)));
  const s = slides[i];
  const frame = (sl: DeckSlide, fitV: number): React.ReactElement => React.createElement('div', { className: 'na-slideframe', style: { width: (960 * fitV) + 'px', height: (600 * fitV) + 'px' } },
    React.createElement('iframe', { title: sl.title, srcDoc: sl.html, sandbox: 'allow-same-origin', scrolling: 'no', style: { width: '960px', height: '600px', border: 0, transform: 'scale(' + fitV + ')', transformOrigin: 'top left' } }));
  return React.createElement('div', { className: 'na-present' },
    React.createElement('div', { className: 'na-present-bar' },
      React.createElement('div', { className: 'pt' },
        React.createElement('strong', null, title),
        React.createElement('span', null, grid ? slides.length + ' slides' : 'Slide ' + s.index + ' · ' + s.title)),
      React.createElement('button', { className: 'na-present-btn', onClick: () => setGrid((g) => !g), 'aria-label': 'Toggle grid' }, Ico(grid ? 'layers' : 'expand')),
      React.createElement('button', { className: 'na-present-btn', onClick: onClose, 'aria-label': 'Close' }, Ico('x'))),

    grid
      ? React.createElement('div', { className: 'na-present-grid', ref: gridRef },
          slides.map((sl, k) => React.createElement('button', { key: sl.id, className: 'na-present-cell', onClick: () => { setI(k); setGrid(false); } },
            React.createElement('span', { className: 'gi' }, sl.index),
            frame(sl, cellFit))))
      : React.createElement('div', { className: 'na-present-stage', ref: stageRef },
          React.createElement('button', { className: 'na-present-nav prev', disabled: i === 0, onClick: () => go(-1), 'aria-label': 'Previous' }, Ico('chevL')),
          frame(s, stageFit),
          React.createElement('button', { className: 'na-present-nav next', disabled: i === slides.length - 1, onClick: () => go(1), 'aria-label': 'Next' }, Ico('chevR'))),

    !grid && React.createElement('div', { className: 'na-present-dots' },
      slides.map((sl, k) => React.createElement('button', { key: sl.id, className: 'dot', 'data-on': k === i, onClick: () => setI(k), 'aria-label': 'Slide ' + sl.index }))));
}

export { PlanView, SlidesView, DeckPatchInline, DeckPatchTray, CommentComposer, PatchCard, CommentsView, EvidenceView, ExportView, PresentOverlay };
