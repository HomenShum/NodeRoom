/**
 * Always-On Rooms — pure-core contract tests (convex/alwaysOnCore.ts).
 *
 * Scenario lens: an attacker submits hostile source URLs (SSRF probes), a
 * noisy real-world papers page gets scanned daily (change detection +
 * extraction bounds), a subscriber reads the rendered brief/digest (honest
 * templates that never invent items), and the outbox worker drives rows
 * through the draft-first state machine (full transition matrix). Everything
 * here is deterministic — v1 makes zero model calls.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWED_SOURCE_HOSTS,
  OUTBOX_STATES,
  buildIdempotencyKey,
  canTransition,
  contentHash,
  extractPapersFromHtml,
  renderDailyBriefMarkdown,
  renderDigestEmail,
  validateSourceUrl,
  type BriefItem,
  type BriefMeta,
} from "../convex/alwaysOnCore";

const HOST = "expositio.org";

const META: BriefMeta = { title: "Expositio daily brief", dateLine: "2026-07-04 · run #26", runNumber: 26 };

const LINKS = {
  viewRoomUrl: "https://noderoom.live/#rooms/expositio-pulse",
  manageUrl: "https://noderoom.live/#rooms/expositio-pulse?manage=tok123",
  unsubscribeUrl: "https://noderoom.live/#rooms/expositio-pulse?unsub=tok456",
};

// ─── validateSourceUrl — SSRF gate ──────────────────────────────────────────

describe("validateSourceUrl (SSRF allowlist gate)", () => {
  it("accepts the flagship source over https on the exact allowlisted host", () => {
    const res = validateSourceUrl("https://expositio.org/papers", HOST);
    expect(res).toEqual({ ok: true, href: "https://expositio.org/papers", host: HOST });
  });

  it("normalizes host case and trailing dot but nothing else", () => {
    expect(validateSourceUrl("https://EXPOSITIO.ORG/papers", HOST).ok).toBe(true);
    expect(validateSourceUrl("https://expositio.org./papers", HOST).ok).toBe(true);
  });

  it("accepts an explicit default port and rejects any other port", () => {
    expect(validateSourceUrl("https://expositio.org:443/papers", HOST).ok).toBe(true);
    const odd = validateSourceUrl("https://expositio.org:8443/papers", HOST);
    expect(odd).toEqual({ ok: false, reason: "port_not_allowed" });
  });

  it.each([
    ["http://expositio.org/papers", "https_required"],
    ["ftp://expositio.org/papers", "https_required"],
    ["https://user@expositio.org/papers", "userinfo_not_allowed"],
    ["https://user:pass@expositio.org/papers", "userinfo_not_allowed"],
    ["https://192.168.1.10/papers", "ip_literal_not_allowed"],
    ["https://127.0.0.1/papers", "ip_literal_not_allowed"],
    ["https://10.0.0.1:443/", "ip_literal_not_allowed"],
    ["https://[::1]/papers", "ip_literal_not_allowed"],
    ["https://[fd00::1]/papers", "ip_literal_not_allowed"],
    ["https://evil.com/papers", "host_not_allowed"],
    ["https://expositio.org.evil.com/papers", "host_not_allowed"],
    ["https://sub.expositio.org/papers", "host_not_allowed"],
    ["https://expositio.org.evil.com./papers", "host_not_allowed"],
    ["not a url at all", "invalid_url"],
    ["", "invalid_url"],
  ] as const)("rejects hostile url %s with reason %s", (url, reason) => {
    expect(validateSourceUrl(url, HOST)).toEqual({ ok: false, reason });
  });

  it("rejects absurdly long URLs before parsing", () => {
    const res = validateSourceUrl(`https://expositio.org/${"a".repeat(3000)}`, HOST);
    expect(res).toEqual({ ok: false, reason: "invalid_url" });
  });

  it("refuses a smuggled allowedHost that would widen the hardcoded allowlist", () => {
    // A tampered source row (allowedHost: evil.com, url matching it) must still be blocked.
    const res = validateSourceUrl("https://evil.com/papers", "evil.com");
    expect(res).toEqual({ ok: false, reason: "host_not_allowlisted" });
    expect(ALLOWED_SOURCE_HOSTS).toEqual(["expositio.org"]);
  });
});

// ─── contentHash — deterministic change detection ───────────────────────────

describe("contentHash (deterministic change detection)", () => {
  it("is a 64-char lowercase sha256 hex and is stable across calls", async () => {
    const a = await contentHash("<html><body>papers</body></html>");
    const b = await contentHash("<html><body>papers</body></html>");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it("treats CRLF/indentation churn as unchanged (no false 'changed' scans)", async () => {
    const unix = await contentHash("line one\nline two\n");
    const windows = await contentHash("line one\r\nline two\r\n");
    const indented = await contentHash("  line one  \n\t line two \n\n\n");
    expect(windows).toBe(unix);
    expect(indented).toBe(unix);
  });

  it("detects a real content change (one new paper on the page)", async () => {
    const before = await contentHash('<a href="/p/1">Paper one</a>');
    const after = await contentHash('<a href="/p/1">Paper one</a><a href="/p/2">Paper two</a>');
    expect(after).not.toBe(before);
  });
});

// ─── extractPapersFromHtml — bounded deterministic parse ────────────────────

describe("extractPapersFromHtml (deterministic, bounded parse)", () => {
  it("parses a messy real-world list: nested tags, entities, mixed quoting", () => {
    const html = `
      <ul class="papers">
        <li><a href="/papers/2841" data-discipline="Mathematics" data-topic='algebraic topology'>
          <span class="t">Spectral sequences &amp; friends</span></a></li>
        <li><a data-topic=causal href='/papers/2842'><b>Causal inference:</b> the missing semester</a></li>
        <li><a href="/papers/2843">What &lt;attention&gt; heads compute</a></li>
        <li>broken markup <a href="/papers/2844">Renormalization for the impatient
      </ul>`;
    const items = extractPapersFromHtml(html);
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items[0]).toEqual({
      title: "Spectral sequences & friends",
      href: "/papers/2841",
      discipline: "Mathematics",
      topic: "algebraic topology",
    });
    expect(items[1]).toEqual({ title: "Causal inference: the missing semester", href: "/papers/2842", topic: "causal" });
    expect(items[2].title).toBe("What <attention> heads compute");
  });

  it("returns [] for empty/non-HTML input instead of throwing", () => {
    expect(extractPapersFromHtml("")).toEqual([]);
    expect(extractPapersFromHtml("just plain text, no anchors")).toEqual([]);
  });

  it("skips fragment links, scheme abuse, and too-short titles", () => {
    const html = [
      '<a href="#top">Back to top of the page</a>',
      '<a href="javascript:alert(1)">Click me for a prize</a>',
      '<a href="data:text/html,hi">Data scheme paper title</a>',
      '<a href="mailto:x@y.com">Mail the editors here</a>',
      '<a href="/papers/1">ok</a>', // title < 3 chars after trim
      '<a href="/papers/2">A real paper title</a>',
    ].join("\n");
    const items = extractPapersFromHtml(html);
    expect(items).toEqual([{ title: "A real paper title", href: "/papers/2" }]);
  });

  it("dedupes identical href+title pairs", () => {
    const html = '<a href="/p/1">Same paper</a><a href="/p/1">Same paper</a><a href="/p/1">Different title</a>';
    const items = extractPapersFromHtml(html);
    expect(items).toHaveLength(2);
  });

  it("BOUND: caps extraction at 500 items on a huge page", () => {
    const huge = Array.from({ length: 800 }, (_, i) => `<a href="/p/${i}">Paper number ${i}</a>`).join("");
    const items = extractPapersFromHtml(huge);
    expect(items).toHaveLength(500);
    expect(items[0].href).toBe("/p/0");
  });

  it("BOUND: truncates individual fields (title 300, href 1024)", () => {
    const html = `<a href="/p/${"x".repeat(3000)}">${"T".repeat(2000)}</a>`;
    const [item] = extractPapersFromHtml(html);
    expect(item.title.length).toBeLessThanOrEqual(300);
    expect(item.href.length).toBeLessThanOrEqual(1024);
  });

  it("is deterministic: same noisy input → identical output", () => {
    const html = '<a href="/p/1" data-discipline="Physics">Renormalization</a><a href="/p/2">Sheaves</a>';
    expect(extractPapersFromHtml(html)).toEqual(extractPapersFromHtml(html));
  });
});

// ─── Brief + digest templates — honest, never invent ────────────────────────

describe("renderDailyBriefMarkdown (deterministic template)", () => {
  const items: BriefItem[] = [
    { title: "Spectral sequences without tears", discipline: "Mathematics", topic: "algebraic topology", status: "new", href: "https://expositio.org/papers/2841" },
    { title: "Sheaves for systems biologists", discipline: "Biology", topic: "applied topology", status: "updated" },
    { title: "Causal inference: the missing semester", discipline: "Statistics", topic: "causal inference", status: "tracked" },
  ];

  it("contains the three contract sections in order", () => {
    const md = renderDailyBriefMarkdown(META, items);
    const changed = md.indexOf("## What changed");
    const top = md.indexOf("## Top new papers");
    const open = md.indexOf("## Open questions");
    expect(changed).toBeGreaterThan(-1);
    expect(top).toBeGreaterThan(changed);
    expect(open).toBeGreaterThan(top);
  });

  it("reports honest counts and lists ONLY the new items passed in", () => {
    const md = renderDailyBriefMarkdown(META, items);
    expect(md).toContain("1 new · 1 updated · 1 tracked (3 total).");
    expect(md).toContain("[Spectral sequences without tears — Mathematics · algebraic topology](https://expositio.org/papers/2841)");
    // Non-new items are counted but never listed as new papers.
    expect(md).not.toContain("- Sheaves for systems biologists");
    expect(md).not.toContain("- Causal inference");
  });

  it("NEVER invents items: empty scan renders an honest empty brief", () => {
    const md = renderDailyBriefMarkdown(META, []);
    expect(md).toContain("No items tracked yet");
    expect(md).toContain("No new papers detected in this scan.");
    // No list bullets at all — nothing fabricated.
    expect(md.split("\n").filter((l) => l.startsWith("- "))).toEqual([]);
  });

  it("Open questions section is an honest static note (no generated analysis in v1)", () => {
    const md = renderDailyBriefMarkdown(META, items);
    expect(md).toContain("deterministic scan does not generate analysis");
  });

  it("bounds the new-papers list at 10 with an honest overflow line", () => {
    const many: BriefItem[] = Array.from({ length: 14 }, (_, i) => ({ title: `Fresh paper number ${i}`, status: "new" }));
    const md = renderDailyBriefMarkdown(META, many);
    expect(md.split("\n").filter((l) => l.startsWith("- Fresh paper"))).toHaveLength(10);
    expect(md).toContain("…and 4 more new papers in the room.");
  });

  it("sanitizes markdown-breaking characters from extracted titles", () => {
    const hostile: BriefItem[] = [{ title: "Evil](https://evil.com) [link `code`", status: "new", href: "https://expositio.org/p/1)evil" }];
    const md = renderDailyBriefMarkdown(META, hostile);
    expect(md).not.toContain("](https://evil.com)");
    expect(md).not.toContain("`");
    expect(md).toContain("https://expositio.org/p/1evil");
  });

  it("is deterministic: same inputs → byte-identical markdown", () => {
    expect(renderDailyBriefMarkdown(META, items)).toBe(renderDailyBriefMarkdown(META, items));
  });
});

describe("renderDigestEmail (brief + contract links)", () => {
  const items: BriefItem[] = [{ title: "A gentle route to the étale fundamental group", status: "new" }];

  it("subject derives from the brief meta only", () => {
    const { subject } = renderDigestEmail(META, items, LINKS);
    expect(subject).toBe("Expositio daily brief — 2026-07-04 · run #26");
  });

  it("body contains the brief sections plus View room / Manage subscription / Unsubscribe links", () => {
    const { markdown } = renderDigestEmail(META, items, LINKS);
    expect(markdown).toContain("## What changed");
    expect(markdown).toContain("## Top new papers");
    expect(markdown).toContain("## Open questions");
    expect(markdown).toContain(`[View room](${LINKS.viewRoomUrl})`);
    expect(markdown).toContain(`[Manage subscription](${LINKS.manageUrl})`);
    expect(markdown).toContain(`[Unsubscribe](${LINKS.unsubscribeUrl})`);
  });

  it("never invents items: only the passed item appears as a bullet", () => {
    const { markdown } = renderDigestEmail(META, items, LINKS);
    const bullets = markdown.split("\n").filter((l) => l.startsWith("- "));
    expect(bullets).toEqual(["- A gentle route to the étale fundamental group"]);
  });

  it("explains WHY the recipient got the email (double opt-in provenance)", () => {
    const { markdown } = renderDigestEmail(META, [], LINKS);
    expect(markdown).toContain("because you confirmed a subscription");
  });
});

// ─── Outbox state machine — full matrix ─────────────────────────────────────

describe("outbox state machine (full transition matrix)", () => {
  const VALID = new Set([
    "pending_draft->draft_created",
    "draft_created->approved",
    "approved->sent",
    "failed->pending_draft",
    "pending_draft->skipped",
  ]);

  it("exposes exactly the six contract states", () => {
    expect([...OUTBOX_STATES]).toEqual(["pending_draft", "draft_created", "approved", "sent", "failed", "skipped"]);
  });

  it("allows exactly the five contract transitions and rejects every other pair", () => {
    for (const from of OUTBOX_STATES) {
      for (const to of OUTBOX_STATES) {
        const expected = VALID.has(`${from}->${to}`);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it("rejects self-loops and unknown states", () => {
    expect(canTransition("sent", "sent")).toBe(false);
    expect(canTransition("pending_draft", "pending_draft")).toBe(false);
    expect(canTransition("nonsense", "sent")).toBe(false);
    expect(canTransition("approved", "yolo")).toBe(false);
    expect(canTransition("", "")).toBe(false);
  });

  it("terminal states (sent, skipped) have no exits", () => {
    for (const to of OUTBOX_STATES) {
      expect(canTransition("sent", to)).toBe(false);
      expect(canTransition("skipped", to)).toBe(false);
    }
  });
});

// ─── Idempotency key ────────────────────────────────────────────────────────

describe("buildIdempotencyKey (stable dedupe key)", () => {
  it("matches the contract format roomSlug:briefKey:subscriptionId:cadence", () => {
    const key = buildIdempotencyKey({ roomSlug: "exp", briefKey: "b0704", subscriptionId: "s003", cadence: "daily" });
    expect(key).toBe("exp:b0704:s003:daily"); // same shape as AO_OUTBOX demo keys
  });

  it("is stable across calls and distinct across any differing part", () => {
    const base = { roomSlug: "expositio-pulse", briefKey: "2026-07-04", subscriptionId: "sub1", cadence: "daily" };
    expect(buildIdempotencyKey(base)).toBe(buildIdempotencyKey({ ...base }));
    const variants = [
      { ...base, roomSlug: "other-room" },
      { ...base, briefKey: "2026-07-05" },
      { ...base, subscriptionId: "sub2" },
      { ...base, cadence: "weekly" },
    ];
    const keys = new Set([buildIdempotencyKey(base), ...variants.map(buildIdempotencyKey)]);
    expect(keys.size).toBe(5);
  });
});
