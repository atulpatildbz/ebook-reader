// Run from the CLI only, e.g. `npx convex run --prod allowlist:grant '{"email":"a@b.c"}'`.
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const normalize = (email: string) => email.trim().toLowerCase();

export const list = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("allowedEmails").collect()).map((r) => r.email),
});

export const grant = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    email = normalize(email);
    if (!email.includes("@")) throw new Error("Expected an email address");
    const existing = await ctx.db.query("allowedEmails").withIndex("by_email", (q) => q.eq("email", email)).first();
    if (existing) return existing._id;
    return await ctx.db.insert("allowedEmails", { email, createdAt: Date.now() });
  },
});

export const revoke = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const existing = await ctx.db
      .query("allowedEmails")
      .withIndex("by_email", (q) => q.eq("email", normalize(email)))
      .first();
    if (!existing) return false;
    await ctx.db.delete(existing._id);
    return true;
  },
});
