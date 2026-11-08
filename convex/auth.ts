import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import Google from "@auth/core/providers/google";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { emailAllowed } from "./allowlist";
import { NOT_ALLOWED } from "./shared";

const normalize = (url?: string) => (url ? url.replace(/\/$/, "") : null);

function isLoopback(url: string) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
  callbacks: {
    // After Google, come back to the page that asked: the site (SITE_URL) or a local dev server.
    async redirect({ redirectTo }) {
      const site = normalize(process.env.SITE_URL);
      if (!site) throw new Error("Missing environment variable SITE_URL");
      if (redirectTo.startsWith("?") || redirectTo.startsWith("/")) return `${site}${redirectTo}`;
      if (redirectTo.startsWith(site)) {
        const after = redirectTo[site.length];
        if (after === undefined || after === "?" || after === "/" || after === "#") return redirectTo;
      }
      if (isLoopback(redirectTo)) return redirectTo;
      throw new Error(`Invalid redirectTo ${redirectTo} for SITE_URL ${site}`);
    },
    // Only allowlisted accounts get a session.
    async beforeSessionCreation(ctx, { userId }) {
      if (!(await allowedUserById(ctx as unknown as QueryCtx, userId))) throw new ConvexError(NOT_ALLOWED);
    },
  },
});

/** The user, if their email is (still) allowlisted. */
export async function allowedUserById(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  return user && (await emailAllowed(ctx, user.email)) ? user : null;
}

/** The signed-in user, if their email is (still) allowlisted. */
export async function allowedUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  return userId ? allowedUserById(ctx, userId) : null;
}

export async function requireUser(ctx: QueryCtx) {
  const user = await allowedUser(ctx);
  if (!user) throw new ConvexError("not-signed-in");
  return user;
}
