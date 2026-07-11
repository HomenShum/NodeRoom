import GitHub from "@auth/core/providers/github";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

const githubConfigured = Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  // Production uses GitHub OAuth. Password auth exists only to make local and
  // isolated preview authentication deterministic without third-party secrets.
  providers: [githubConfigured ? GitHub : Password],
});
