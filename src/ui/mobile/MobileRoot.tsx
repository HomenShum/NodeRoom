/* ============================================================================
   NodeAgent Mobile — route root (session bootstrap + store providers).
   Live (Convex): the phone joins a room by code (?room=CODE in the hash, or the
   join form) or starts a populated demo room (?demo), then mounts MobileApp under
   ConvexStoreProvider so it subscribes to the SAME live room as the desktop.
   Offline (no Convex / ?mode=memory): renders MobileApp with its sample data.

   Mirrors the verified ConvexApp flow in src/ui/App.tsx (attemptedRef failure
   latch, randomToken, localStorage session persistence, join-failure shapes).
   ============================================================================ */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Actor } from "../../engine/types";
import { ConvexStoreProvider, HAS_CONVEX } from "../../app/store";
import { RoomJoinConsent, type ConsentChoice } from "./RoomJoinConsent";
import { ErrorBoundary } from "../../app/ErrorBoundary";
import { MobileApp } from "./MobileApp";
import { MobileAppLive } from "./MobileAppLive";
import "./mobile.css";
import "./mobileFrame.css";

type Req = { kind: "idle" } | { kind: "join" | "create" | "demo"; code: string; name: string; title?: string; autoAllow?: boolean };
interface LiveSession {
  roomId: string;
  memberId: string;
  name: string;
  token: string;
}

const liveKey = (code: string) => `noderoom:live:${code.toUpperCase()}`;

export function MobileRoot() {
  // Offline / memory mode: no live backend, or explicitly forced via
  // `#mobile?mode=memory` (mirrors the desktop) — render the sample-data surface
  // so the terra design can be previewed without joining a live room.
  if (!HAS_CONVEX || wantsMemory()) return <MobileApp />;
  return <MobileLiveRoot />;
}

/** `#mobile?mode=memory` → force the offline sample surface. */
function wantsMemory(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash;
  const qi = hash.indexOf("?");
  const params = new URLSearchParams(qi >= 0 ? hash.slice(qi + 1) : window.location.search);
  return params.get("mode") === "memory";
}

function MobileLiveRoot() {
  const [req, setReq] = useState<Req>(() => initialReq());
  // Consent is a per-session, explicit permission moment for HOST flows (create
  // demo). Joiners (?room=) skip it — autoAllow lives on the room, not the
  // joiner. Memory mode never reaches MobileLiveRoot at all (the parent gates
  // on HAS_CONVEX + ?mode=memory). pendingDemo stores the staged Req while the
  // consent modal is up; the join effect won't fire until setReq is called.
  const [pendingDemo, setPendingDemo] = useState<{ code: string; name: string } | null>(() => initialPendingDemo());
  const consentInitial: ConsentChoice = useMemo(() => {
    if (typeof window === "undefined") return "auto";
    const hash = window.location.hash;
    const qIndex = hash.indexOf("?");
    const params = new URLSearchParams(qIndex >= 0 ? hash.slice(qIndex + 1) : window.location.search);
    return params.get("demo") === "review" ? "review" : "auto";
  }, []);
  const code = req.kind === "idle" ? "" : req.code;
  const byCode = useQuery(api.rooms.byCode, code ? { code } : "skip");
  const join = useMutation(api.rooms.joinAnonymous);
  const createRoom = useMutation(api.rooms.create);
  const createStarterRoom = useMutation(api.rooms.createStarterRoom);
  const leaveRoom = useMutation(api.rooms.leave);

  const [session, setSession] = useState<LiveSession | null>(() => {
    const r = initialReq();
    return r.kind === "join" ? loadSession(liveKey(r.code)) : null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef<Req | null>(null);

  const [codeInput, setCodeInput] = useState(code);
  const [nameInput, setNameInput] = useState("");

  const start = (kind: "join" | "demo", rawCode: string, rawName: string) => {
    const c = normalizeCode(rawCode);
    if (kind === "join" && c.length < 6) {
      setError("Enter a 6–12 character room code.");
      return;
    }
    const name = cleanName(rawName, kind === "demo" ? "Host" : "Guest");
    const finalCode = c || makeCode();
    setError(null);
    // Host flow (create a fresh demo room): show consent modal first. The user
    // explicitly picks autoAllow before the room is minted. The join effect
    // stays gated on `req` being non-idle, so it won't fire until accept.
    if (kind === "demo") {
      setPendingDemo({ code: finalCode, name });
      return;
    }
    setSession(loadSession(liveKey(finalCode)));
    setReq({ kind: "join", code: finalCode, name });
  };

  // Consent accept: stage the real Req with the user's autoAllow pick. Cancel:
  // drop pendingDemo so the JoinForm comes back; no mutation has fired yet.
  const onConsentAccept = (autoAllow: boolean): void => {
    if (!pendingDemo) return;
    const { code, name } = pendingDemo;
    setSession(null);
    setReq({ kind: "demo", code, name, autoAllow });
    setPendingDemo(null);
  };
  const onConsentCancel = (): void => { setPendingDemo(null); };

  // Failure-latched join/create effect (copied from ConvexApp): joinAnonymous returns
  // failures as DATA, so without keying on the exact request object a rejection busy-loops.
  useEffect(() => {
    if (req.kind === "idle" || session || busy || byCode === undefined) return;
    if (attempted.current === req) return;
    attempted.current = req;
    setBusy(true);
    const token = randomToken();
    const name = req.name;
    const reqCode = req.code;
    void (async () => {
      let joined: { roomId: string; memberId: string } | null = null;
      if (byCode) {
        const res = await join({ code: reqCode, name, authToken: token, anon: true });
        if (res && typeof res === "object" && "error" in res) {
          throw new Error(res.error === "room_full" ? "That room is full. Try a different code." : "Too many people joined just now — try again shortly.");
        }
        joined = res ? { roomId: String(res.roomId), memberId: String(res.memberId) } : null;
      } else if (req.kind === "demo") {
        const res = await createStarterRoom({ code: reqCode, title: "Startup Banking Diligence War Room", hostName: name, authToken: token, autoAllow: req.autoAllow ?? true });
        joined = { roomId: String(res.roomId), memberId: String(res.memberId) };
      } else if (req.kind === "create") {
        const res = await createRoom({ code: reqCode, title: req.title ?? "Blank NodeRoom", hostName: name, authToken: token, autoAllow: req.autoAllow ?? false });
        joined = { roomId: String(res.roomId), memberId: String(res.memberId) };
      }
      if (!joined) throw new Error(`Room ${reqCode} was not found. Check the code or start a demo room.`);
      const next: LiveSession = { roomId: joined.roomId, memberId: joined.memberId, name, token };
      try {
        localStorage.setItem(liveKey(reqCode), JSON.stringify(next));
      } catch {
        /* ignore */
      }
      try {
        history.replaceState(null, "", `#mobile?room=${reqCode}` + (name ? `&name=${encodeURIComponent(name)}` : ""));
      } catch {
        /* ignore */
      }
      setSession(next);
    })()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [byCode, busy, join, createRoom, createStarterRoom, req, session]);

  // Consent modal sits above the JoinForm — the user explicitly grants the
  // autoAllow choice before the room mints. Tab refresh re-prompts (no
  // localStorage by design).
  // Vercel deploy-bust: 779bcde0-force-rebuild
  if (pendingDemo) {
    return (
      <RoomJoinConsent
        initialChoice={consentInitial}
        onAccept={onConsentAccept}
        onCancel={onConsentCancel}
      />
    );
  }

  if (!session) {
    return (
      <JoinForm
        code={codeInput}
        name={nameInput}
        busy={busy}
        error={error}
        onCode={setCodeInput}
        onName={setNameInput}
        onJoin={() => start("join", codeInput, nameInput)}
        onDemo={() => start("demo", "", nameInput)}
      />
    );
  }

  const me: Actor = { kind: "user", id: session.memberId, name: session.name };
  const proof = { actor: me, token: session.token };
  const leave = () => {
    void leaveRoom({ roomId: session.roomId as never, requester: proof }).catch(() => undefined);
    try {
      localStorage.removeItem(liveKey(code));
    } catch {
      /* ignore */
    }
    setSession(null);
    setReq({ kind: "idle" });
    setError(null);
  };

  // Live subtree: a thrown useQuery (revoked/rotated proof on rooms.meta) would otherwise blank the
  // phone with no recovery. On catch, drop the stale session and fall back to the join form.
  return (
    <ErrorBoundary onError={() => leave()} fallback={() => null}>
      <ConvexStoreProvider roomId={session.roomId} me={me} proof={proof}>
        <MobileAppLive roomId={session.roomId} me={me} proof={proof} onLeave={leave} />
      </ConvexStoreProvider>
    </ErrorBoundary>
  );
}

function JoinForm({
  code,
  name,
  busy,
  error,
  onCode,
  onName,
  onJoin,
  onDemo,
}: {
  code: string;
  name: string;
  busy: boolean;
  error: string | null;
  onCode: (v: string) => void;
  onName: (v: string) => void;
  onJoin: () => void;
  onDemo: () => void;
}) {
  return (
    <div className="na-frame-root" data-theme="light">
      <div className="na-frame">
        <div className="na-join" data-accent="terracotta">
          <div className="na-mark na-join-mark">N</div>
          <h1 className="na-join-title">NodeAgent Mobile</h1>
          <p className="na-join-sub">Join a live room from your phone, or start a demo.</p>
          {error && <div className="na-join-error">{error}</div>}
          <input
            className="na-join-input mono"
            placeholder="Room code"
            value={code}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => onCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onJoin(); }}
            aria-label="Room code"
          />
          <input
            className="na-join-input"
            placeholder="Your name"
            value={name}
            onChange={(e) => onName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onJoin(); }}
            aria-label="Your name"
          />
          <button className="na-btn primary full" disabled={busy} onClick={onJoin}>
            {busy ? "Joining…" : "Join room"}
          </button>
          <button className="na-btn full" disabled={busy} onClick={onDemo}>
            Start a demo room
          </button>
        </div>
      </div>
    </div>
  );
}

// ── url + session helpers (local copies of ConvexApp's, mobile-scoped) ──────
function initialReq(): Req {
  if (typeof window === "undefined") return { kind: "idle" };
  const hash = window.location.hash; // e.g. "#mobile?room=NR7K9"
  const qIndex = hash.indexOf("?");
  const params = new URLSearchParams(qIndex >= 0 ? hash.slice(qIndex + 1) : window.location.search);
  const rawName = params.get("name") ?? "";
  const room = params.get("room");
  if (room) {
    const c = normalizeCode(room);
    const name = cleanName(rawName, "Guest");
    return c ? { kind: "join", code: c, name } : { kind: "idle" };
  }
  const create = params.get("create");
  if (create !== null) {
    const c = normalizeCode(create && create !== "1" ? create : makeCode());
    const name = cleanName(rawName, "Host");
    const title = cleanTitle(params.get("title") ?? "", "Blank NodeRoom");
    return c ? { kind: "create", code: c, name, title } : { kind: "idle" };
  }
  // URL-driven demo: do NOT auto-fire the mutation. Return idle so the parent
  // can read initialPendingDemo() and route through the consent modal first.
  // The user's autoAllow pick lands via onConsentAccept → setReq.
  return { kind: "idle" };
}

/** Parses ?demo=… into a pending demo descriptor (code + name) WITHOUT setting
 *  req. The consent modal then mints the room with the user's explicit pick. */
function initialPendingDemo(): { code: string; name: string } | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  const qIndex = hash.indexOf("?");
  const params = new URLSearchParams(qIndex >= 0 ? hash.slice(qIndex + 1) : window.location.search);
  if (params.get("room")) return null; // joiners skip — autoAllow lives on the room
  const demo = params.get("demo");
  if (demo === null) return null;
  const name = cleanName(params.get("name") ?? "", "Host");
  const code = normalizeCode(demo && demo !== "1" && demo !== "review" ? demo : makeCode());
  return code ? { code, name } : null;
}

function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function cleanName(raw: string, fallback: string): string {
  return raw.trim().slice(0, 40) || fallback;
}

function cleanTitle(raw: string, fallback: string): string {
  return raw.trim().slice(0, 80) || fallback;
}

function makeCode(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  const suffix = Array.from(b, (x) => (x % 36).toString(36)).join("").toUpperCase();
  return ("NR" + suffix).slice(0, 12);
}

function randomToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function loadSession(key: string): LiveSession | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LiveSession>;
    if (
      typeof p.roomId === "string" &&
      typeof p.memberId === "string" &&
      typeof p.name === "string" &&
      typeof p.token === "string" &&
      /^[a-f0-9]{32,}$/i.test(p.token)
    ) {
      return { roomId: p.roomId, memberId: p.memberId, name: p.name, token: p.token };
    }
    return null;
  } catch {
    return null;
  }
}
