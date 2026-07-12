import { query } from "./_generated/server";
import { productionIdentityRequired } from "./lib";
import { freshRoomLaunchCreditGrantFromEnv } from "./freshRoomLaunchCredits";
import {
  creditsEnforcedFromEnv,
  launchAdmissionModeFromEnv,
  launchPauseStateFromEnv,
} from "../src/launch/budgetPolicy";

export const read = query({
  args: {},
  handler: async () => {
    const env = process.env;
    const grant = freshRoomLaunchCreditGrantFromEnv(env);
    return {
      schema: "noderoom-launch-posture-v1" as const,
      identityRequired: productionIdentityRequired(env),
      launchMode: launchAdmissionModeFromEnv(env),
      creditsEnforced: creditsEnforcedFromEnv(env),
      freshRoomGrantCredits: grant?.credits ?? 0,
      ...launchPauseStateFromEnv(env),
    };
  },
});
