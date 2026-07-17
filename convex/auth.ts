import GitHub from "@auth/core/providers/github";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { nodeRoomEmailVerification, normalizeAuthEmail } from "./authEmail";

const githubConfigured = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
const password = Password({
  verify: nodeRoomEmailVerification,
  profile: (params) => {
    const email = normalizeAuthEmail(params.email);
    params.email = email;
    return { email };
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: githubConfigured ? [GitHub, password] : [password],
  callbacks: {
    beforeSessionCreation: async (ctx, { userId }) => {
      const user = await ctx.db.get(userId);
      if (!user?.emailVerificationTime) throw new Error("email_verification_required");
    },
  },
});
