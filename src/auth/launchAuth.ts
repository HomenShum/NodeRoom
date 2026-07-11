export type LaunchAuthProvider = "github" | "password";

type LaunchAuthEnv = {
  VITE_NODEROOM_AUTH_REQUIRED?: string;
  VITE_NODEROOM_AUTH_PROVIDER?: string;
};

export function launchAuthRequired(env: LaunchAuthEnv = import.meta.env): boolean {
  return env.VITE_NODEROOM_AUTH_REQUIRED === "1";
}

export function launchAuthProvider(env: LaunchAuthEnv = import.meta.env): LaunchAuthProvider {
  return env.VITE_NODEROOM_AUTH_PROVIDER === "password" ? "password" : "github";
}

export function authIntentLabel(kind: "join" | "create" | "demo"): string {
  if (kind === "join") return "join this room";
  if (kind === "demo") return "start a sample room";
  return "create this workspace";
}

export function clearPersistedRoomSessions(storage: Pick<Storage, "key" | "length" | "removeItem">): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith("noderoom:live:")) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
