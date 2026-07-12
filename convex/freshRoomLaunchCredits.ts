import { DEMO_CREDIT_CONFIG } from "../src/nodeagent/core/creditModel";
import { creditsEnforcedFromEnv, launchAdmissionModeFromEnv } from "../src/launch/budgetPolicy";

export const NEW_ROOM_GRANT_CREDITS_ENV = "NODEAGENT_NEW_ROOM_GRANT_CREDITS";

export type FreshRoomLaunchCreditGrant = {
  credits: number;
  source: "pilot" | "promo";
  note: string;
};

const DECIMAL_CREDITS_RE = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

export function freshRoomLaunchCreditGrantFromEnv(
  env: Record<string, string | undefined>,
): FreshRoomLaunchCreditGrant | null {
  const launchMode = launchAdmissionModeFromEnv(env);
  if ((launchMode !== "private_pilot" && launchMode !== "public_launch") || !creditsEnforcedFromEnv(env)) {
    return null;
  }

  const rawCredits = env[NEW_ROOM_GRANT_CREDITS_ENV]?.trim();
  if (!rawCredits || !DECIMAL_CREDITS_RE.test(rawCredits)) return null;

  const requestedCredits = Number(rawCredits);
  if (!Number.isFinite(requestedCredits) || requestedCredits <= 0) return null;

  const credits = Math.round(Math.min(requestedCredits, DEMO_CREDIT_CONFIG.startingCredits) * 100) / 100;
  if (credits <= 0) return null;

  return {
    credits,
    source: launchMode === "private_pilot" ? "pilot" : "promo",
    note: [
      "fresh_room_launch_v1",
      `launch_mode=${launchMode}`,
      "credits_enforced=true",
      `config_env=${NEW_ROOM_GRANT_CREDITS_ENV}`,
      `requested_credits=${requestedCredits}`,
      `granted_credits=${credits}`,
      `cap_credits=${DEMO_CREDIT_CONFIG.startingCredits}`,
    ].join(";"),
  };
}
