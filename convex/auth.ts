import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import Google from "@auth/core/providers/google";
import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";

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
      const user = await ctx.db.get(userId);
      if (!(await emailAllowed(ctx as unknown as QueryCtx, user?.email))) {
        throw new ConvexError("not-allowed");
      }
    },
  },
});

export async function emailAllowed(ctx: QueryCtx, email?: string) {
  if (!email) return false;
  const row = await ctx.db
    .query("allowedEmails")
    .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
    .first();
  return row !== null;
}

/** The signed-in user, if their email is (still) allowlisted. */
export async function allowedUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user || !(await emailAllowed(ctx, user.email))) return null;
  return user;
}

export async function requireUser(ctx: QueryCtx) {
  const user = await allowedUser(ctx);
  if (!user) throw new ConvexError("not-signed-in");
  return user;
}
