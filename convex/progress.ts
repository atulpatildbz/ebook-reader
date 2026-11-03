import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { allowedUser, requireUser } from "./auth";

/** The synced reading position of one book (live: updates when another device reads on). */
export const get = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    const user = await allowedUser(ctx);
    if (!user) return null;
    const row = await ctx.db
      .query("progress")
      .withIndex("by_user_book", (q) => q.eq("userId", user._id).eq("bookId", bookId))
      .first();
    if (!row) return null;
    return {
      cfi: row.cfi,
      fraction: row.fraction,
      chapter: row.chapter ?? null,
      device: row.device,
      deviceName: row.deviceName,
      updatedAt: row.updatedAt,
    };
  },
});

/** Store the reading position. A position older than the stored one is ignored (returns false). */
export const save = mutation({
  args: {
    bookId: v.id("books"),
    cfi: v.string(),
    fraction: v.number(),
    chapter: v.optional(v.string()),
    device: v.string(),
    deviceName: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const book = await ctx.db.get(args.bookId);
    if (!book || book.userId !== user._id) return false;
    // A device with a clock far in the future must not pin the position forever.
    const updatedAt = Math.min(args.updatedAt, Date.now() + 60_000);
    const row = {
      userId: user._id,
      bookId: args.bookId,
      cfi: args.cfi.slice(0, 2000),
      fraction: Math.max(0, Math.min(1, args.fraction)),
      chapter: args.chapter?.slice(0, 300),
      device: args.device.slice(0, 64),
      deviceName: args.deviceName.slice(0, 64),
      updatedAt,
    };
    const existing = await ctx.db
      .query("progress")
      .withIndex("by_user_book", (q) => q.eq("userId", user._id).eq("bookId", args.bookId))
      .first();
    if (!existing) {
      await ctx.db.insert("progress", row);
      return true;
    }
    if (existing.updatedAt > updatedAt) return false;
    if (existing.cfi === row.cfi && existing.device === row.device) return true;
    await ctx.db.replace(existing._id, row);
    return true;
  },
});
