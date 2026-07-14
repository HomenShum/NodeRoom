/* ============================================================================
   NodeRoom mobile route root: explicit first-run intent, session bootstrap,
   and live store providers. A fresh visitor never joins or creates a room from
   a URL alone; each mutation follows an on-screen confirmation.
   ============================================================================ */
import { useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../convex/_generated/api";
import type { Actor } from "../../engine/types";
import { ConvexStoreProvider, HAS_CONVEX } from "../../app/store";
import { RoomJoinConsent, type ConsentChoice } from "./RoomJoinConsent";
import { ErrorBoundary } from "../../app/ErrorBoundary";
import { MobileApp } from "./MobileApp";
import { MobileAppLive } from "./MobileAppLive";
import { authIntentLabel, clearPersistedRoomSessions, launchAuthRequired } from "../../auth/launchAuth";
import { AccountGate } from "../auth/AccountGate";
import "./mobile.tokens.css";
import "./mobile.css";
import "./mobileFrame.css";
import "./mobile.shell.css";

type HostKind = "create" | "demo";
type Req =
  | { kind: "idle" }
  | { kind: "join" | HostKind; code: string; name: string; title?: string; autoAllow?: boolean };

interface HostDraft {
  kind: HostKind;
  code: string;
  name: string;
  title?: string;
}

interface LiveSession {
  roomId: string;
  memberId: string;
  name: string;
  token: string;
  experience?: "workspace" | "sample";
}

interface PendingRequest {
  name?: string;
  title?: string;
  token?: string;
}

const liveKey = (code: string) => `noderoom:live:${code.toUpperCase()}`;
const pendingKey = (code: string) => `noderoom:mobilePending:${code.toUpperCase()}`;

export function MobileRoot() {
  if (!HAS_CONVEX || wantsMemory()) return <MobileApp />;
  if (launchAuthRequired()) return <AuthenticatedMobileLiveRoot />;
  return <MobileLiveRoot />;
}

function wantsMemory(): boolean {
  return mobileParams().get("mode") === "memory";
}

type MobileAuthState = { isLoading: boolean; isAuthenticated: boolean };

function AuthenticatedMobileLiveRoot() {
  const auth = useConvexAuth();
  const { signOut } = useAuthActions();
  return <MobileLiveRoot auth={auth} signOut={signOut} />;
}

function MobileLiveRoot({ auth = { isLoading: false, isAuthenticated: true }, signOut }: { auth?: MobileAuthState; signOut?: () => Promise<void> } = {}) {
  const requiresAuth = launchAuthRequired();
  const authReady = !requiresAuth || auth.isAuthenticated;
  const initialRoute = useMemo(() => initialReq(), []);
  const [req, setReq] = useState<Req>(initialRoute);
  const [pendingHost, setPendingHost] = useState<HostDraft | null>(() => initialHostDraft());
  const consentInitial: ConsentChoice = mobileParams().get("policy") === "auto" ? "auto" : "review";
  const code = req.kind === "idle" ? "" : req.code;
  const byCode = useQuery(api.rooms.byCode, code ? { code } : "skip");
  const join = useMutation(api.rooms.joinAnonymous);
  const createRoom = useMutation(api.rooms.create);
  const createStarterRoom = useMutation(api.rooms.createStarterRoom);
  const leaveRoom = useMutation(api.rooms.leave);

  const [session, setSession] = useState<LiveSession | null>(() => {
    if (initialRoute.kind !== "idle") return loadSession(liveKey(initialRoute.code));
    const inviteCode = initialJoinCode();
    return inviteCode ? loadSession(liveKey(inviteCode)) : null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef<Req | null>(null);
  const [codeInput, setCodeInput] = useState(() => initialJoinCode());
  const [nameInput, setNameInput] = useState(() => mobileParams().get("name")?.trim().slice(0, 40) ?? "");

  const startJoin = (rawCode: string, rawName: string): void => {
    const nextCode = normalizeCode(rawCode);
    if (nextCode.length < 6) {
      setError("Enter a 6-12 character room code.");
      return;
    }
    const name = cleanName(rawName, "Guest");
    const next: Exclude<Req, { kind: "idle" }> = { kind: "join", code: nextCode, name };
    setError(null);
    savePendingRequest(nextCode, { name });
    writeMobileUrl(next, { confirmed: true });
    setSession(loadSession(liveKey(nextCode)));
    setReq(next);
  };

  const stageHost = (kind: HostKind, rawName: string): void => {
    setError(null);
    setPendingHost({
      kind,
      code: makeCode(),
      name: cleanName(rawName, "Host"),
      title: kind === "create" ? "My workspace" : undefined,
    });
  };

  const onConsentAccept = (autoAllow: boolean): void => {
    if (!pendingHost) return;
    const next: Exclude<Req, { kind: "idle" }> = { ...pendingHost, autoAllow };
    savePendingRequest(next.code, { name: next.name, title: next.title });
    writeMobileUrl(next, { confirmed: true, autoAllow });
    setSession(null);
    setReq(next);
    setPendingHost(null);
  };

  const onConsentCancel = (): void => {
    setPendingHost(null);
    writeMobileLandingUrl();
  };

  useEffect(() => {
    if (!authReady || req.kind === "idle" || session || busy || byCode === undefined) return;
    if (attempted.current === req) return;
    attempted.current = req;
    setBusy(true);
    const { code: reqCode, name } = req;
    const pending = readPendingRequest(reqCode);
    const token = pending?.token ?? randomToken();
    savePendingRequest(reqCode, { name, title: req.title, token });
    void (async () => {
      let joined: { roomId: string; memberId: string; name?: string } | null = null;
      let experience: "workspace" | "sample" = req.kind === "demo" || mobileParams().get("sample") === "1" ? "sample" : "workspace";
      if (byCode) {
        const result = await join({ code: reqCode, name, authToken: token, anon: req.kind === "join" && !requiresAuth });
        if (result && typeof result === "object" && "error" in result) {
          throw new Error(result.error === "room_full"
            ? "That room is full. Try a different code."
            : "Too many people joined just now. Try again shortly.");
        }
        joined = result ? { roomId: String(result.roomId), memberId: String(result.memberId), name: result.name } : null;
        experience = byCode.experience ?? experience;
      } else if (req.kind === "demo") {
        const result = await createStarterRoom({
          code: reqCode,
          title: "Startup Banking Diligence War Room",
          hostName: name,
          authToken: token,
          autoAllow: req.autoAllow ?? false,
          deferHeavySeed: true,
          seedProfile: "guided",
        });
        joined = { roomId: String(result.roomId), memberId: String(result.memberId) };
      } else if (req.kind === "create") {
        const result = await createRoom({
          code: reqCode,
          title: req.title ?? "My workspace",
          hostName: name,
          authToken: token,
          autoAllow: req.autoAllow ?? false,
        });
        joined = { roomId: String(result.roomId), memberId: String(result.memberId) };
      }
      if (!joined) throw new Error(`Room ${reqCode} was not found. Check the code or create a workspace.`);

      const next: LiveSession = { ...joined, name: joined.name ?? name, token, experience };
      try { localStorage.setItem(liveKey(reqCode), JSON.stringify(next)); } catch { /* ignore */ }
      clearPendingRequest(reqCode);
      writeMobileUrl({ kind: "join", code: reqCode, name: next.name }, { sample: experience === "sample" });
      setSession(next);
    })()
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  }, [authReady, byCode, busy, createRoom, createStarterRoom, join, req, session]);

  if (pendingHost) {
    return (
      <RoomJoinConsent
        experience={pendingHost.kind === "demo" ? "sample" : "workspace"}
        roomCode={pendingHost.code}
        initialChoice={consentInitial}
        onAccept={onConsentAccept}
        onCancel={onConsentCancel}
      />
    );
  }

  if (requiresAuth && (req.kind !== "idle" || session) && !auth.isAuthenticated) {
    const actionKind = req.kind === "idle" ? "join" : req.kind;
    return (
      <AccountGate
        action={authIntentLabel(actionKind)}
        loading={auth.isLoading}
        mobile
        onCancel={() => {
          const activeCode = code || initialJoinCode();
          if (activeCode) {
            clearPendingRequest(activeCode);
            try { localStorage.removeItem(liveKey(activeCode)); } catch { /* ignore */ }
          }
          setSession(null);
          setReq({ kind: "idle" });
          setError(null);
          writeMobileLandingUrl();
        }}
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
        onJoin={() => startJoin(codeInput, nameInput)}
        onCreate={() => stageHost("create", nameInput)}
        onSample={() => stageHost("demo", nameInput)}
      />
    );
  }

  const me: Actor = { kind: "user", id: session.memberId, name: session.name };
  const proof = { actor: me, token: session.token };
  const dropLocalSession = (): void => {
    const activeCode = code || initialJoinCode();
    try { if (activeCode) localStorage.removeItem(liveKey(activeCode)); } catch { /* ignore */ }
    setSession(null);
    setReq({ kind: "idle" });
    setError(null);
    writeMobileLandingUrl();
  };
  const leave = (): void => {
    void leaveRoom({ roomId: session.roomId as never, requester: proof })
      .then((result) => {
        if (!result.ok) {
          window.alert("The room host cannot leave until ownership transfer is available. Your session remains active.");
          return;
        }
        dropLocalSession();
      })
      .catch(() => window.alert("Could not leave the room. Your session remains active; try again."));
  };
  const signOutAccount = signOut ? (): void => {
    void signOut()
      .then(() => {
        try { clearPersistedRoomSessions(localStorage); } catch { /* ignore */ }
        setSession(null);
        setReq({ kind: "idle" });
        setError(null);
        writeMobileLandingUrl();
      })
      .catch(() => setError("Could not sign out. Your room session remains active; try again."));
  } : undefined;

  return (
    <ErrorBoundary onError={dropLocalSession} fallback={() => null}>
      <ConvexStoreProvider roomId={session.roomId} me={me} proof={proof}>
        <MobileAppLive roomId={session.roomId} me={me} proof={proof} experienceHint={session.experience} onLeave={leave} onSignOut={signOutAccount} />
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
  onCreate,
  onSample,
}: {
  code: string;
  name: string;
  busy: boolean;
  error: string | null;
  onCode: (value: string) => void;
  onName: (value: string) => void;
  onJoin: () => void;
  onCreate: () => void;
  onSample: () => void;
}) {
  return (
    <div className="na-frame-root" data-theme="light">
      <div className="na-frame">
        <main className="na-join" data-accent="terracotta">
          <div className="na-mark na-join-mark" aria-hidden="true">N</div>
          <h1 className="na-join-title">NodeRoom</h1>
          <p className="na-join-sub">Work with AI in a shared room, review changes, and keep the evidence attached.</p>
          {error && <div id="mobile-join-error" className="na-join-error" role="alert">{error}</div>}
          <label className="na-join-field">
            <span>Your name</span>
            <input
              className="na-join-input"
              placeholder="How teammates will see you"
              value={name}
              autoComplete="name"
              onChange={(event) => onName(event.target.value)}
            />
          </label>
          <section className="na-join-section" aria-labelledby="mobile-join-heading">
            <h2 id="mobile-join-heading">Join an existing room</h2>
            <p>Sign in, then use the room code to join and edit shared content.</p>
            <input
              className="na-join-input mono"
              placeholder="Room code"
              value={code}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => onCode(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") onJoin(); }}
              aria-label="Room code"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "mobile-join-error" : undefined}
            />
            <button className="na-btn primary full" disabled={busy} onClick={onJoin} data-testid="mobile-join-submit">
              {busy ? "Joining..." : "Join room"}
            </button>
          </section>
          <section className="na-join-section" aria-labelledby="mobile-create-heading">
            <h2 id="mobile-create-heading">Start a new room</h2>
            <p>Create an empty workspace, or inspect a clearly labeled synthetic sample.</p>
            <div className="na-join-actions">
              <button className="na-btn full" disabled={busy} onClick={onCreate} data-testid="mobile-create-room">Create workspace</button>
              <button className="na-btn full" disabled={busy} onClick={onSample} data-testid="mobile-sample-room">Try sample</button>
            </div>
          </section>
          <p className="na-join-trust">Account + room code. Review-first agent edits. Room content remains after members leave.</p>
        </main>
      </div>
    </div>
  );
}

function initialReq(): Req {
  if (typeof window === "undefined") return { kind: "idle" };
  const params = mobileParams();
  const confirmed = params.get("confirmed") === "1";
  const autoAllow = params.get("policy") === "auto";
  const room = normalizeCode(params.get("room") ?? "");
  if (room) {
    const saved = loadSession(liveKey(room));
    if (!confirmed && !saved) return { kind: "idle" };
    const pending = readPendingRequest(room);
    return { kind: "join", code: room, name: cleanName(pending?.name ?? params.get("name") ?? "", saved?.name ?? "Guest") };
  }

  const demo = params.get("demo");
  if (demo !== null && confirmed) {
    const code = normalizeCode(demo && demo !== "1" && demo !== "review" ? demo : makeCode());
    const pending = readPendingRequest(code);
    return code ? { kind: "demo", code, name: cleanName(pending?.name ?? params.get("name") ?? "", "Host"), autoAllow } : { kind: "idle" };
  }

  const create = params.get("create");
  if (create !== null && confirmed) {
    const code = normalizeCode(create && create !== "1" ? create : makeCode());
    const pending = readPendingRequest(code);
    return code ? {
      kind: "create",
      code,
      name: cleanName(pending?.name ?? params.get("name") ?? "", "Host"),
      title: cleanTitle(pending?.title ?? params.get("title") ?? "", "My workspace"),
      autoAllow,
    } : { kind: "idle" };
  }
  return { kind: "idle" };
}

function initialHostDraft(): HostDraft | null {
  if (typeof window === "undefined") return null;
  const params = mobileParams();
  if (params.get("confirmed") === "1" || params.get("room")) return null;
  const intent = params.get("intent");
  const demo = params.get("demo");
  const create = params.get("create");
  const kind: HostKind | null = intent === "sample" || demo !== null
    ? "demo"
    : intent === "create" || create !== null
      ? "create"
      : null;
  if (!kind) return null;
  const rawCode = kind === "demo" ? demo : create;
  const code = normalizeCode(rawCode && rawCode !== "1" && rawCode !== "review" ? rawCode : makeCode());
  return {
    kind,
    code,
    name: cleanName(params.get("name") ?? "", "Host"),
    title: kind === "create" ? cleanTitle(params.get("title") ?? "", "My workspace") : undefined,
  };
}

function initialJoinCode(): string {
  return normalizeCode(mobileParams().get("room") ?? "");
}

function mobileParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  const hash = window.location.hash;
  const queryIndex = hash.indexOf("?");
  return new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : window.location.search);
}

function writeMobileUrl(
  request: Exclude<Req, { kind: "idle" }>,
  options: { confirmed?: boolean; autoAllow?: boolean; sample?: boolean } = {},
): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  params.set(request.kind === "join" ? "room" : request.kind, request.code);
  if (request.kind === "create" && request.title) params.set("title", request.title);
  if (options.confirmed) params.set("confirmed", "1");
  if (options.autoAllow) params.set("policy", "auto");
  if (options.sample) params.set("sample", "1");
  history.replaceState(null, "", `#mobile?${params.toString()}`);
}

function writeMobileLandingUrl(): void {
  if (typeof window !== "undefined") history.replaceState(null, "", "#mobile");
}

function savePendingRequest(code: string, value: PendingRequest): void {
  try {
    const current = readPendingRequest(code) ?? {};
    sessionStorage.setItem(pendingKey(code), JSON.stringify({ ...current, ...value }));
  } catch { /* ignore */ }
}

function readPendingRequest(code: string): PendingRequest | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(code));
    return raw ? JSON.parse(raw) as PendingRequest : null;
  } catch {
    return null;
  }
}

function clearPendingRequest(code: string): void {
  try { sessionStorage.removeItem(pendingKey(code)); } catch { /* ignore */ }
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
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (value) => (value % 36).toString(36)).join("").toUpperCase();
  return (`NR${suffix}`).slice(0, 12);
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function loadSession(key: string): LiveSession | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LiveSession>;
    if (
      typeof parsed.roomId === "string" &&
      typeof parsed.memberId === "string" &&
      typeof parsed.name === "string" &&
      typeof parsed.token === "string" &&
      /^[a-f0-9]{32,}$/i.test(parsed.token)
    ) {
      return {
        roomId: parsed.roomId,
        memberId: parsed.memberId,
        name: parsed.name,
        token: parsed.token,
        experience: parsed.experience,
      };
    }
    return null;
  } catch {
    return null;
  }
}
