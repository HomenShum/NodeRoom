import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Landing } from "./Landing";
import { RoomShell } from "./RoomShell";
import { BtbLiveLedgerPanel } from "./BtbLiveLedgerPanel";
import { FrontierObservationsPanel } from "./FrontierObservationsPanel";
import { LandingStory } from "../landing/LandingStory";
import { MobileRoot } from "./mobile/MobileRoot";
// Lazy: the Tour bundle is ~50 KB of scripted demo content (panels, sheet,
// note, wall, post-its) only needed at #room-tour — don't ship it on every
// route's first paint.
const RoomTour = lazy(() => import("../landing/roomTour/RoomTour").then((m) => ({ default: m.RoomTour })));
// Lazy: Always-On public rooms (#rooms/<slug>) — read-only agent-maintained
// surface with its own css/svg bundle; keep it off every other route's first
// paint (same precedent as RoomTour above).
const PublicRoomPage = lazy(() => import("../alwayson/PublicRoomPage").then((m) => ({ default: m.PublicRoomPage })));
import { EngineStoreProvider, ConvexStoreProvider, HAS_CONVEX } from "../app/store";
import { createFreshRoom, enterBankerToolBenchRoomAsHost, enterDemoRoomAsHost, enterHackwithBayRoomAsHost, enterScaleDemoRoomAsHost, enterUpScaleXRoomAsHost } from "../app/roomStore";
import type { Actor } from "../engine/types";

const liveSessionKey = (code: string) => `noderoom:live:${code.toUpperCase()}`;

// NOTE: starter-room seed content lives server-side in convex/rooms.ts and is
// written atomically by the `createStarterRoom` mutation. It used to be duplicated here and seeded
// client-side via create + 4× createArtifact, which could leave a half-built room if any seed failed.
// Keeping a single server-side source of truth is what makes create all-or-nothing.

export interface Session {
  roomId: string;
  me: Actor;
}

interface LiveSession {
  roomId: string;
  memberId: string;
  name: string;
  token: string;
}

type LiveRequest =
  | { kind: "idle" }
  | { kind: "join" | "create" | "demo"; code: string; name: string; title?: string };

export function App() {
  const [hash, setHash] = useState(() => readRoutableHash());
  const [memorySession, setMemorySession] = useState<Session | null>(() => initialMemorySession());
  const btbSessionRef = useRef<Session | null>(null);
  const hackwithBaySessionRef = useRef<Session | null>(null);
  const upscalexSessionRef = useRef<Session | null>(null);
  useEffect(() => {
    const onHash = () => setHash(readRoutableHash());
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, []);

  // NodeAgent Mobile (Terracotta) — standalone mobile surface (mock-data demo).
  if (hash === "#mobile" || hash === "#/mobile" || hash.startsWith("#mobile?") || hash.startsWith("#/mobile?")) {
    return <MobileRoot key={hash} />;
  }

  if (hash === "#room-tour" || hash === "#/room-tour") {
    return (
      <Suspense fallback={<div style={{ padding: 24, fontFamily: "system-ui", color: "#888" }}>Loading room tour…</div>}>
        <RoomTour />
      </Suspense>
    );
  }

  // Always-On public rooms — "#rooms/<slug>" and "#/rooms/<slug>" (an optional
  // ?ops=1 query may trail the slug inside the hash; the page reads it itself).
  if (hash.startsWith("#rooms/") || hash.startsWith("#/rooms/")) {
    const slug = hash.replace(/^#\/?rooms\//, "").split("?")[0];
    return (
      <Suspense fallback={<div style={{ padding: 24, fontFamily: "system-ui", color: "#888" }}>Loading public room…</div>}>
        <PublicRoomPage key={slug} slug={slug} />
      </Suspense>
    );
  }

  if (hash === "#story" || hash === "#/story") {
    const exit = () => { window.location.hash = ""; };
    const enter = (session: Session) => {
      if (HAS_CONVEX) {
        const url = new URL(window.location.href);
        url.hash = "";
        url.search = "";
        url.searchParams.set("demo", makeLiveRoomCode());
        url.searchParams.set("name", cleanLiveName(session.me.name, "Host"));
        window.history.pushState(null, "", url);
        setHash("");
        return;
      }
      setMemorySession(session);
      window.location.hash = "";
    };
    return <LandingStory onEnter={enter} onBack={exit} />;
  }

  if (hash === "#btb" || hash === "#/btb") {
    btbSessionRef.current ??= enterBankerToolBenchRoomAsHost();
    return (
      <EngineStoreProvider roomId={btbSessionRef.current.roomId} me={btbSessionRef.current.me}>
        <RoomShell roomId={btbSessionRef.current.roomId} me={btbSessionRef.current.me} onLeave={() => { window.location.hash = ""; }} />
        {HAS_CONVEX ? <BtbLiveLedgerPanel /> : null}
      </EngineStoreProvider>
    );
  }

  if (hash === "#hackwithbay" || hash === "#/hackwithbay") {
    hackwithBaySessionRef.current ??= enterHackwithBayRoomAsHost();
    return (
      <EngineStoreProvider roomId={hackwithBaySessionRef.current.roomId} me={hackwithBaySessionRef.current.me}>
        <RoomShell roomId={hackwithBaySessionRef.current.roomId} me={hackwithBaySessionRef.current.me} onLeave={() => { window.location.hash = ""; }} />
      </EngineStoreProvider>
    );
  }

  // #upscalex — a fresh room seeded with the UpScaleX portfolio; open the Graph tab for Mark's network.
  if (hash === "#upscalex" || hash === "#/upscalex") {
    upscalexSessionRef.current ??= enterUpScaleXRoomAsHost();
    return (
      <EngineStoreProvider roomId={upscalexSessionRef.current.roomId} me={upscalexSessionRef.current.me}>
        <RoomShell roomId={upscalexSessionRef.current.roomId} me={upscalexSessionRef.current.me} onLeave={() => { window.location.hash = ""; }} />
      </EngineStoreProvider>
    );
  }

  // #frontier — standalone read-only panel for the 8 model-frontier
  // observations. NOT mounted inside #btb so it skips the engine-store
  // bootstrap (it only needs the public Convex query). See
  // src/ui/FrontierObservationsPanel.tsx for the honest-lane contract.
  if (hash === "#frontier" || hash === "#/frontier" || hash.startsWith("#frontier?") || hash.startsWith("#/frontier?")) {
    return <FrontierObservationsPanel />;
  }

  return HAS_CONVEX ? <ConvexApp /> : <MemoryApp session={memorySession} onSession={setMemorySession} />;
}

function readRoutableHash(): string {
  if (typeof window === "undefined") return "";
  const normalized = normalizeMobileLandingUrl(window.location);
  if (normalized) {
    window.history.replaceState(null, "", normalized);
  }
  return window.location.hash;
}

function normalizeMobileLandingUrl(location: Location): string | null {
  const sourceParams = new URLSearchParams(location.search);
  if (typeof window === "undefined" || !isMobileLandingViewport() || isMobileHash(location.hash) || sourceParams.get("surface") === "desktop") {
    return null;
  }
  const url = new URL(location.href);
  const mobileParams = new URLSearchParams();
  copyParam(sourceParams, mobileParams, "mode");

  const room = sourceParams.get("room");
  const demo = sourceParams.get("demo");
  const create = sourceParams.get("create");
  if (room) {
    mobileParams.set("room", room);
    copyParam(sourceParams, mobileParams, "name");
  } else if (demo !== null) {
    mobileParams.set("demo", demo || "1");
    copyParam(sourceParams, mobileParams, "name");
  } else if (create !== null) {
    mobileParams.set("create", create || "1");
    copyParam(sourceParams, mobileParams, "name");
    copyParam(sourceParams, mobileParams, "title");
  } else {
    copyParam(sourceParams, mobileParams, "name");
    const from = normalizeSourceHash(url.hash);
    if (from) mobileParams.set("from", from);
  }

  url.search = "";
  const query = mobileParams.toString();
  url.hash = `mobile${query ? `?${query}` : ""}`;
  return url.href === location.href ? null : url.href;
}

function isMobileHash(hash: string): boolean {
  return hash === "#mobile" || hash === "#/mobile" || hash.startsWith("#mobile?") || hash.startsWith("#/mobile?");
}

function isMobileLandingViewport(): boolean {
  if (typeof window === "undefined") return false;
  const viewportMobile = window.matchMedia?.("(max-width: 760px)")?.matches ?? window.innerWidth <= 760;
  const userAgentMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(window.navigator.userAgent);
  return viewportMobile || userAgentMobile;
}

function copyParam(source: URLSearchParams, target: URLSearchParams, key: string): void {
  const value = source.get(key);
  if (value !== null) target.set(key, value);
}

function normalizeSourceHash(hash: string): string {
  return hash.replace(/^#\/?/, "").trim();
}

function initialMemorySession(): Session | null {
  if (typeof window === "undefined" || HAS_CONVEX) return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("demo") === "scale") return enterScaleDemoRoomAsHost(cleanLiveName(params.get("name") ?? "", "Host"));
  if (params.get("demo") !== null) return enterDemoRoomAsHost(cleanLiveName(params.get("name") ?? "", "Host"));
  if (params.get("create") !== null) return createFreshRoom("Blank NodeRoom", cleanLiveName(params.get("name") ?? "", "Host"));
  return null;
}

function MemoryApp({ session, onSession }: { session: Session | null; onSession: (session: Session | null) => void }) {
  if (!session) return <Landing onEnter={onSession} />;
  return (
    <EngineStoreProvider roomId={session.roomId} me={session.me}>
      <RoomShell roomId={session.roomId} me={session.me} onLeave={() => onSession(null)} />
    </EngineStoreProvider>
  );
}

function ConvexApp() {
  const [request, setRequest] = useState<LiveRequest>(() => initialLiveRequest());
  const code = request.kind === "idle" ? "" : request.code;
  const byCode = useQuery(api.rooms.byCode, code ? { code } : "skip");
  const join = useMutation(api.rooms.joinAnonymous);
  const createStarterRoom = useMutation(api.rooms.createStarterRoom);
  const leaveRoom = useMutation(api.rooms.leave);
  const [session, setSession] = useState<LiveSession | null>(() => {
    const initial = initialLiveRequest();
    return initial.kind === "join" || initial.kind === "create" || initial.kind === "demo" ? loadLiveSession(liveSessionKey(initial.code)) : null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Failure latch: each `start()` mints a NEW request object, so keying on object identity lets
  // an explicit resubmit retry while a failed attempt can never re-fire itself. Without this the
  // join effect re-satisfies its run guard on every failure (busy true→false) and loops forever —
  // flashing the UI and re-hammering the join mutation. Mirrors RoomShell's tourAutoStarted ref.
  const attemptedRef = useRef<LiveRequest | null>(null);

  const start = (kind: "join" | "create" | "demo", rawCode: string, rawName: string, rawTitle?: string) => {
    const normalizedCode = normalizeLiveRoomCode(rawCode);
    if (!normalizedCode) {
      setError("Enter a 6-12 character room code.");
      return;
    }
    const name = cleanLiveName(rawName, kind === "create" ? "Host" : "Guest");
    const title = kind === "create" ? cleanLiveTitle(rawTitle ?? "", "Startup diligence") : undefined;
    setError(null);
    setSession(kind === "join" ? loadLiveSession(liveSessionKey(normalizedCode)) : null);
    setRequest({ kind, code: normalizedCode, name, title });
    writeLiveUrl(kind, normalizedCode, name, title);
  };

  useEffect(() => {
    if (request.kind === "idle" || session || busy || byCode === undefined) return;
    if (attemptedRef.current === request) return; // already tried this exact request — don't retry on failure
    attemptedRef.current = request;
    setBusy(true);
    const token = randomToken();
    const name = request.name;
    void (async () => {
      let joined: { roomId: string; memberId: string } | null = null;
      // Idempotent create: if the room already exists — a create whose success response was lost, or a
      // reload of a `?create=` URL — don't dead-end with "already exists". Adopt it by joining. There is
      // never a half-built room to recover from because createStarterRoom (below) seeds room + all four
      // artifacts in ONE atomic transaction, so an existing room is always complete. `anon: false` keeps
      // the re-entrant under the host name. (createStarterRoom = option 2; this fall-through = option 3.)
      if (byCode) {
        const result = await join({ code: request.code, name, authToken: token, anon: request.kind === "join" });
        if (isJoinFailure(result)) throw new Error(joinFailureMessage(result.error));
        joined = result ? { roomId: String(result.roomId), memberId: String(result.memberId) } : null;
      } else if (request.kind === "demo") {
        // ONE mutation = ONE Convex transaction: room + host member + all four starter artifacts commit
        // all-or-nothing. A mid-seed failure (e.g. an oversized/invalid seed) rolls the room back, so a
        // rejected create can never leave a phantom room with partial artifacts — which the previous
        // create + 4× createArtifact composition could, since createRoom committed before seeding.
        const result = await createStarterRoom({
          code: request.code,
          title: "Startup Banking Diligence War Room",
          hostName: name,
          authToken: token,
          autoAllow: true,
        });
        joined = { roomId: String(result.roomId), memberId: String(result.memberId) };
      } else if (request.kind === "create") {
        // Real-user create uses the same atomic starter mutation as demo create.
        // No separate deterministic route is involved; the ordinary landing flow
        // creates the scaled room a host should actually see.
        const result = await createStarterRoom({
          code: request.code,
          title: request.title ?? "Startup diligence",
          hostName: name,
          authToken: token,
          autoAllow: true,
        });
        joined = { roomId: String(result.roomId), memberId: String(result.memberId) };
      }
      if (!joined) throw new Error(`Room ${request.code} was not found. Create it or check the code.`);
      const next = { roomId: joined.roomId, memberId: joined.memberId, name, token };
      try { localStorage.setItem(liveSessionKey(request.code), JSON.stringify(next)); } catch { /* ignore */ }
      if (request.kind === "create" || request.kind === "demo") writeLiveUrl("join", request.code, name);
      setSession(next);
    })()
      .catch((e) => { setError(friendlyLiveError(e)); })
      .finally(() => { setBusy(false); });
  }, [byCode, busy, createStarterRoom, join, request, session]);

  if (request.kind === "idle" || !session) {
    return (
      <Landing
        mode="live"
        defaultCode={code || ""}
        busy={busy}
        joinError={error}
        onLiveDemo={(name) => start("demo", makeLiveRoomCode(), name)}
        onLiveJoin={(roomCode, name) => start("join", roomCode, name)}
        onLiveCreate={(name, title, roomCode) => start("create", roomCode ?? makeLiveRoomCode(), name, title)}
      />
    );
  }

  const me: Actor = { kind: "user", id: session.memberId, name: session.name };
  const proof = { actor: me, token: session.token };
  const leave = () => {
    void leaveRoom({ roomId: session.roomId as never, requester: proof }).catch(() => undefined);
    try { localStorage.removeItem(liveSessionKey(request.code)); } catch { /* ignore */ }
    setSession(null);
    setRequest({ kind: "idle" });
    setError(null);
    clearLiveUrl();
  };

  return (
    <ConvexStoreProvider roomId={session.roomId} me={me} proof={proof}>
      <RoomShell roomId={session.roomId} me={me} onLeave={leave} proof={proof} />
    </ConvexStoreProvider>
  );
}

function initialLiveRequest(): LiveRequest {
  if (typeof window === "undefined") return { kind: "idle" };
  const params = new URLSearchParams(window.location.search);
  const name = cleanLiveName(params.get("name") ?? "", "Guest");
  const demoParam = params.get("demo");
  const createParam = params.get("create");
  const joinParam = params.get("room");
  if (demoParam !== null) {
    const code = normalizeLiveRoomCode(demoParam && demoParam !== "1" ? demoParam : makeLiveRoomCode());
    return code ? { kind: "demo", code, name } : { kind: "idle" };
  }
  if (createParam !== null) {
    const code = normalizeLiveRoomCode(createParam && createParam !== "1" ? createParam : makeLiveRoomCode());
    const title = cleanLiveTitle(params.get("title") ?? "", "Startup diligence");
    return code ? { kind: "create", code, name, title } : { kind: "idle" };
  }
  if (joinParam) {
    const code = normalizeLiveRoomCode(joinParam);
    return code ? { kind: "join", code, name } : { kind: "idle" };
  }
  return { kind: "idle" };
}

function writeLiveUrl(kind: "join" | "create" | "demo", code: string, name: string, title?: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  url.searchParams.set(kind === "demo" ? "demo" : kind === "create" ? "create" : "room", code);
  if (name) url.searchParams.set("name", name);
  if (kind === "create" && title) url.searchParams.set("title", title);
  window.history.pushState(null, "", url);
}


function clearLiveUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  window.history.pushState(null, "", url);
}

function normalizeLiveRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function cleanLiveName(raw: string, fallback: string): string {
  return raw.trim().slice(0, 40) || fallback;
}

function cleanLiveTitle(raw: string, fallback: string): string {
  return raw.trim().slice(0, 80) || fallback;
}

function isJoinFailure(value: unknown): value is { error: "room_full" | "join_rate_limited" } {
  return !!value && typeof value === "object" && "error" in value;
}

function joinFailureMessage(error: string): string {
  if (error === "room_full") return "That room is full. Create a new room instead.";
  if (error === "join_rate_limited") return "Too many people joined that room in the last minute. Try again shortly.";
  return "Could not join that room.";
}

function friendlyLiveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/room_code_taken/.test(message)) return "That room code already exists. Join it instead.";
  if (/weak_room_code/.test(message)) return "Room codes must be 6-12 letters or numbers.";
  if (/field_too_long/.test(message)) return "Name or title is too long.";
  if (/Failed to fetch|NetworkError/i.test(message)) return "Network error while connecting to the live backend. Try again.";
  return message;
}

function makeLiveRoomCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => (b % 36).toString(36)).join("").toUpperCase();
  return `NR${suffix}${Date.now().toString(36).toUpperCase().slice(-4)}`.slice(0, 12);
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function loadLiveSession(key: string): LiveSession | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LiveSession>;
    if (
      isPersistedLiveId(parsed.roomId) &&
      isPersistedLiveId(parsed.memberId) &&
      isPersistedLiveName(parsed.name) &&
      isPersistedLiveToken(parsed.token)
    ) {
      return { roomId: parsed.roomId, memberId: parsed.memberId, name: parsed.name, token: parsed.token };
    }
    localStorage.removeItem(key);
    return null;
  } catch {
    return null;
  }
}

function isPersistedLiveId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/^(undefined|null|\[object Object\])$/i.test(value.trim());
}

function isPersistedLiveName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPersistedLiveToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32,}$/i.test(value);
}
