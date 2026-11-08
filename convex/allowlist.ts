// Who may sign in. Managed from the CLI only, e.g.
// `npx convex run --prod allowlist:grant '{"email":"a@b.c"}'`.
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";

const normalize = (email: string) => email.trim().toLowerCase();

const find = (ctx: QueryCtx, email: string) =>
  ctx.db
    .query("allowedEmails")
    .withIndex("by_email", (q) => q.eq("email", normalize(email)))
    .first();

export async function emailAllowed(ctx: QueryCtx, email?: string) {
  return !!email && (await find(ctx, email)) !== null;
}

export const list = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("allowedEmails").collect()).map((r) => r.email),
});

export const grant = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    if (!email.includes("@")) throw new Error("Expected an email address");
    const existing = await find(ctx, email);
    if (existing) return existing._id;
    return await ctx.db.insert("allowedEmails", { email: normalize(email), createdAt: Date.now() });
  },
});

export const revoke = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const existing = await find(ctx, email);
    if (!existing) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});
