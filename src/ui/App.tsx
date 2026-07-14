import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { Landing } from "./Landing";
import { RoomShell } from "./RoomShell";
import { BtbLiveLedgerPanel } from "./BtbLiveLedgerPanel";
import { FrontierObservationsPanel } from "./FrontierObservationsPanel";
import { LandingStory } from "../landing/LandingStory";
const MobileRoot = lazy(() => import("./mobile/MobileRoot").then((m) => ({ default: m.MobileRoot })));
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
import { authIntentLabel, clearPersistedRoomSessions, launchAuthRequired } from "../auth/launchAuth";
import { AccountGate } from "./auth/AccountGate";

const liveSessionKey = (code: string) => `noderoom:live:${code.toUpperCase()}`;
const livePendingKey = (code: string) => `noderoom:livePending:${code.toUpperCase()}`;

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
  experience?: "workspace" | "sample";
}

interface PendingLiveRequest {
  name?: string;
  title?: string;
  token?: string;
}

type LiveRequest =
  | { kind: "idle" }
  | { kind: "join" | "create" | "demo"; code: string; name: string; title?: string; autoAllow?: boolean };

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
    return (
      <Suspense fallback={<div style={{ padding: 24, fontFamily: "system-ui", color: "#888" }}>Loading workspace...</div>}>
        <MobileRoot key={hash} />
      </Suspense>
    );
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
  // A fresh phone visitor stays on the same explanatory landing page. Only an
  // explicit room intent enters the compact product shell, and existing hash
  // destinations (public rooms, story, benchmarks) retain their route.
  const existingRoute = normalizeSourceHash(location.hash);
  if (existingRoute) return null;
  const intent = sourceParams.get("intent");
  const actionable = sourceParams.has("room") || sourceParams.has("demo") || sourceParams.has("create") ||
    intent === "create" || intent === "join" || intent === "sample" || sourceParams.has("mode") || sourceParams.get("surface") === "mobile";
  if (!actionable) return null;
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
    copyParam(sourceParams, mobileParams, "intent");
    copyParam(sourceParams, mobileParams, "name");
  }
  copyParam(sourceParams, mobileParams, "confirmed");
  copyParam(sourceParams, mobileParams, "policy");
  copyParam(sourceParams, mobileParams, "sample");

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

type LaunchAuthState = { isLoading: boolean; isAuthenticated: boolean };

function ConvexApp() {
  return launchAuthRequired()
    ? <AuthenticatedConvexApp />
    : <ConvexRoomApp auth={{ isLoading: false, isAuthenticated: true }} />;
}

function AuthenticatedConvexApp() {
  const auth = useConvexAuth();
  const { signOut } = useAuthActions();
  return <ConvexRoomApp auth={auth} signOut={signOut} />;
}

function ConvexRoomApp({ auth, signOut }: { auth: LaunchAuthState; signOut?: () => Promise<void> }) {
  const requiresAuth = launchAuthRequired();
  const authReady = !requiresAuth || auth.isAuthenticated;
  const [request, setRequest] = useState<LiveRequest>(() => initialLiveRequest());
  const code = request.kind === "idle" ? "" : request.code;
  const byCode = useQuery(api.rooms.byCode, code ? { code } : "skip");
  const join = useMutation(api.rooms.joinAnonymous);
  const createRoom = useMutation(api.rooms.create);
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

  const start = (kind: "join" | "create" | "demo", rawCode: string, rawName: string, rawTitle?: string, autoAllow = false) => {
    const normalizedCode = normalizeLiveRoomCode(rawCode);
    if (!normalizedCode) {
      setError("Enter a 6-12 character room code.");
      return;
    }
    const name = cleanLiveName(rawName, kind === "join" ? "Guest" : "Host");
    const title = kind === "create" ? cleanLiveTitle(rawTitle ?? "", "My workspace") : undefined;
    const restored = kind === "join" ? loadLiveSession(liveSessionKey(normalizedCode)) : null;
    const pending = readLivePending(normalizedCode);
    saveLivePending(normalizedCode, { name, title, token: pending?.token ?? randomToken() });
    setError(null);
    setSession(restored);
    setRequest({ kind, code: normalizedCode, name, title, autoAllow });
    writeLiveUrl(kind, normalizedCode, name, title, { confirmed: !restored, autoAllow });
  };

  useEffect(() => {
    if (!authReady || request.kind === "idle" || session || busy || byCode === undefined) return;
    if (attemptedRef.current === request) return; // already tried this exact request — don't retry on failure
    attemptedRef.current = request;
    setBusy(true);
    const pending = readLivePending(request.code);
    const token = pending?.token ?? randomToken();
    saveLivePending(request.code, { name: request.name, title: request.title, token });
    const name = request.name;
    void (async () => {
      let joined: { roomId: string; memberId: string; name?: string } | null = null;
      let experience: "workspace" | "sample" = request.kind === "demo" ? "sample" : "workspace";
      // Idempotent create: if the room already exists — a create whose success response was lost, or a
      // reload of a `?create=` URL — don't dead-end with "already exists". Adopt it by joining. There is
      // never a half-built room to recover from because createStarterRoom (below) seeds room + all four
      // artifacts in ONE atomic transaction, so an existing room is always complete. `anon: false` keeps
      // the re-entrant under the host name. (createStarterRoom = option 2; this fall-through = option 3.)
      if (byCode) {
        const result = await join({ code: request.code, name, authToken: token, anon: request.kind === "join" });
        if (isJoinFailure(result)) throw new Error(joinFailureMessage(result.error));
        joined = result ? { roomId: String(result.roomId), memberId: String(result.memberId), name: result.name } : null;
        experience = byCode.experience ?? experience;
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
          autoAllow: request.autoAllow ?? false,
          deferHeavySeed: true,
          seedProfile: "guided",
        });
        joined = { roomId: String(result.roomId), memberId: String(result.memberId) };
      } else if (request.kind === "create") {
        const result = await createRoom({
          code: request.code,
          title: request.title ?? "My workspace",
          hostName: name,
          authToken: token,
          autoAllow: request.autoAllow ?? false,
        });
        joined = { roomId: String(result.roomId), memberId: String(result.memberId) };
      }
      if (!joined) throw new Error(`Room ${request.code} was not found. Create it or check the code.`);
      const next: LiveSession = { roomId: joined.roomId, memberId: joined.memberId, name: joined.name ?? name, token, experience };
      try { localStorage.setItem(liveSessionKey(request.code), JSON.stringify(next)); } catch { /* ignore */ }
      clearLivePending(request.code);
      writeLiveUrl("join", request.code, next.name, undefined, { sample: experience === "sample" });
      setSession(next);
    })()
      .catch((e) => { setError(friendlyLiveError(e)); })
      .finally(() => { setBusy(false); });
  }, [authReady, byCode, busy, createRoom, createStarterRoom, join, request, session]);

  if (requiresAuth && (request.kind !== "idle" || session) && !auth.isAuthenticated) {
    const actionKind = request.kind === "idle" ? "join" : request.kind;
    return (
      <AccountGate
        action={authIntentLabel(actionKind)}
        loading={auth.isLoading}
        onCancel={() => {
          if (code) {
            clearLivePending(code);
            try { localStorage.removeItem(liveSessionKey(code)); } catch { /* ignore */ }
          }
          setSession(null);
          setRequest({ kind: "idle" });
          setError(null);
          clearLiveUrl();
        }}
      />
    );
  }

  if (!session) {
    if (request.kind !== "idle" && !error) {
      return <LiveRoomBootShell code={code} kind={request.kind} />;
    }
    return (
      <Landing
        mode="live"
        defaultCode={code || initialLandingCode()}
        busy={busy}
        joinError={error}
        initialIntent={initialLandingIntent()}
        onLiveDemo={(name, autoAllow) => start("demo", makeLiveRoomCode(), name, undefined, autoAllow)}
        onLiveJoin={(roomCode, name) => start("join", roomCode, name)}
        onLiveCreate={(name, title, roomCode, autoAllow) => start("create", roomCode || makeLiveRoomCode(), name, title, autoAllow)}
      />
    );
  }

  const me: Actor = { kind: "user", id: session.memberId, name: session.name };
  const proof = { actor: me, token: session.token };
  const leave = () => {
    void leaveRoom({ roomId: session.roomId as never, requester: proof })
      .then((result) => {
        if (!result.ok) {
          window.alert("The room host cannot leave until ownership transfer is available. Your session remains active.");
          return;
        }
        try { if (code) localStorage.removeItem(liveSessionKey(code)); } catch { /* ignore */ }
        setSession(null);
        setRequest({ kind: "idle" });
        setError(null);
        clearLiveUrl();
      })
      .catch(() => setError("Could not leave the room. Your session remains active; try again."));
  };
  const signOutAccount = signOut ? () => {
    void signOut()
      .then(() => {
        try { clearPersistedRoomSessions(localStorage); } catch { /* ignore */ }
        setSession(null);
        setRequest({ kind: "idle" });
        setError(null);
        clearLiveUrl();
      })
      .catch(() => setError("Could not sign out. Your room session remains active; try again."));
  } : undefined;

  return (
    <ConvexStoreProvider roomId={session.roomId} me={me} proof={proof}>
      <RoomShell roomId={session.roomId} me={me} onLeave={leave} onSignOut={signOutAccount} proof={proof} />
    </ConvexStoreProvider>
  );
}

function LiveRoomBootShell({ code, kind }: { code: string; kind: "join" | "create" | "demo" }) {
  const label = kind === "join" ? "Joining room" : kind === "demo" ? "Creating sample room" : "Creating empty room";
  const steps = kind === "demo" ? SAMPLE_BOOT_STEPS : kind === "create" ? CREATE_BOOT_STEPS : JOIN_BOOT_STEPS;
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setStep((current) => Math.min(current + 1, steps.length - 1));
    }, 1800);
    return () => window.clearInterval(timer);
  }, [steps.length]);
  const activeStep = steps[Math.min(step, steps.length - 1)];
  return (
    <div className="r-app" data-bg-glow="false" data-testid="live-room-boot-shell">
      <div className="r-screen r-skel-shell" aria-busy="true" aria-label={label}>
        <div className="r-skel-rail">
          <span className="r-skeleton" style={{ height: 26, width: "72%" }} />
          {Array.from({ length: 6 }).map((_, i) => <span key={i} className="r-skeleton" style={{ height: 14, width: `${88 - (i % 3) * 16}%` }} />)}
        </div>
        <div className="r-skel-surface">
          <span className="r-skeleton" style={{ height: 30, width: "42%" }} />
          <div className="r-panel r-live-boot-card">
            <div className="row between gap8">
              <span className="r-brand">NodeRoom <span>· {label}</span></span>
              {code ? <span className="mono tiny faint">{code}</span> : null}
            </div>
            <div className="r-live-boot-status" aria-live="polite">
              <strong>{activeStep.title}</strong>
              <span>{activeStep.body}</span>
            </div>
            <div className="r-live-boot-steps" aria-label="Room startup progress">
              {steps.map((bootStep, index) => (
                <span key={bootStep.title} className="r-live-boot-step" data-state={index < step ? "done" : index === step ? "now" : "next"}>
                  <i aria-hidden="true" />
                  {bootStep.title}
                </span>
              ))}
            </div>
            {Array.from({ length: 8 }).map((_, i) => <span key={i} className="r-skeleton" style={{ height: 18, width: `${96 - (i % 4) * 5}%` }} />)}
          </div>
        </div>
        <div className="r-skel-chat">
          {Array.from({ length: 5 }).map((_, i) => <span key={i} className="r-skeleton" style={{ height: i % 2 ? 42 : 24, width: i % 2 ? "86%" : "62%" }} />)}
        </div>
      </div>
    </div>
  );
}

const JOIN_BOOT_STEPS = [
  { title: "Checking room", body: "Verifying the code and restoring any room-scoped session in this browser." },
  { title: "Joining workspace", body: "Creating or restoring your room membership." },
  { title: "Syncing room", body: "Loading artifacts, chat, and current review state." },
];

const CREATE_BOOT_STEPS = [
  { title: "Creating room", body: "Opening an empty code-access workspace with Review enabled." },
  { title: "Starting NodeAgents", body: "Preparing room and private agent lanes without running a task." },
  { title: "Syncing workspace", body: "Connecting the empty room so reload recovery is ready." },
];

const SAMPLE_BOOT_STEPS = [
  { title: "Creating sample", body: "Opening a room clearly marked as synthetic sample data." },
  { title: "Loading sample artifacts", body: "Adding demonstration sheets, notes, sources, and traces." },
  { title: "Syncing workspace", body: "Connecting the sample room so reload recovery is ready." },
];

function initialLiveRequest(): LiveRequest {
  if (typeof window === "undefined") return { kind: "idle" };
  const params = new URLSearchParams(window.location.search);
  const name = cleanLiveName(params.get("name") ?? "", "Guest");
  const demoParam = params.get("demo");
  const createParam = params.get("create");
  const joinParam = params.get("room");
  const confirmed = params.get("confirmed") === "1";
  const autoAllow = params.get("policy") === "auto";
  if (demoParam !== null && confirmed) {
    const code = normalizeLiveRoomCode(demoParam && demoParam !== "1" ? demoParam : makeLiveRoomCode());
    const pending = readLivePending(code);
    return code ? { kind: "demo", code, name: cleanLiveName(pending?.name ?? params.get("name") ?? "", "Host"), autoAllow } : { kind: "idle" };
  }
  if (createParam !== null && confirmed) {
    const code = normalizeLiveRoomCode(createParam && createParam !== "1" ? createParam : makeLiveRoomCode());
    const pending = readLivePending(code);
    const title = cleanLiveTitle(pending?.title ?? params.get("title") ?? "", "My workspace");
    return code ? { kind: "create", code, name: cleanLiveName(pending?.name ?? params.get("name") ?? "", "Host"), title, autoAllow } : { kind: "idle" };
  }
  if (joinParam) {
    const code = normalizeLiveRoomCode(joinParam);
    const saved = code ? loadLiveSession(liveSessionKey(code)) : null;
    const pending = code ? readLivePending(code) : null;
    return code && (confirmed || saved) ? { kind: "join", code, name: saved?.name ?? cleanLiveName(pending?.name ?? name, "Guest") } : { kind: "idle" };
  }
  return { kind: "idle" };
}

function initialLandingIntent(): "create" | "join" | "sample" | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("intent");
  if (explicit === "create" || explicit === "join") return explicit;
  if (explicit === "sample" || explicit === "demo") return "sample";
  if (params.has("create") && params.get("confirmed") !== "1") return "create";
  if (params.has("demo") && params.get("confirmed") !== "1") return "sample";
  const room = normalizeLiveRoomCode(params.get("room") ?? "");
  if (room && !loadLiveSession(liveSessionKey(room))) return "join";
  return null;
}

function initialLandingCode(): string {
  if (typeof window === "undefined") return "";
  return normalizeLiveRoomCode(new URLSearchParams(window.location.search).get("room") ?? "");
}

function writeLiveUrl(
  kind: "join" | "create" | "demo",
  code: string,
  _name: string,
  title?: string,
  options: { confirmed?: boolean; autoAllow?: boolean; sample?: boolean } = {},
) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  url.searchParams.set(kind === "demo" ? "demo" : kind === "create" ? "create" : "room", code);
  if (kind === "create" && title) url.searchParams.set("title", title);
  if (options.confirmed) url.searchParams.set("confirmed", "1");
  if (options.autoAllow) url.searchParams.set("policy", "auto");
  if (options.sample) url.searchParams.set("sample", "1");
  window.history.replaceState(null, "", url);
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
      return {
        roomId: parsed.roomId,
        memberId: parsed.memberId,
        name: parsed.name,
        token: parsed.token,
        experience: parsed.experience === "sample" ? "sample" : parsed.experience === "workspace" ? "workspace" : undefined,
      };
    }
    localStorage.removeItem(key);
    return null;
  } catch {
    return null;
  }
}

function saveLivePending(code: string, value: PendingLiveRequest): void {
  try {
    const current = readLivePending(code) ?? {};
    sessionStorage.setItem(livePendingKey(code), JSON.stringify({ ...current, ...value }));
  } catch {
    /* ignore */
  }
}

function readLivePending(code: string): PendingLiveRequest | null {
  try {
    const raw = sessionStorage.getItem(livePendingKey(code));
    return raw ? JSON.parse(raw) as PendingLiveRequest : null;
  } catch {
    return null;
  }
}

function clearLivePending(code: string): void {
  try { sessionStorage.removeItem(livePendingKey(code)); } catch { /* ignore */ }
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
