import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { allowedUser, requireUser } from "./auth";
import { ownBook } from "./books";

type Position = Omit<Doc<"progress">, "_id" | "_creationTime">;

export const findProgress = (ctx: QueryCtx, userId: Id<"users">, bookId: Id<"books">) =>
  ctx.db
    .query("progress")
    .withIndex("by_user_book", (q) => q.eq("userId", userId).eq("bookId", bookId))
    .first();

/** A position as stored: fraction in 0–1, strings cut to size. */
export const stored = (p: Position): Position => ({
  ...p,
  cfi: p.cfi.slice(0, 2000),
  xpointer: p.xpointer?.slice(0, 2000),
  fraction: Math.max(0, Math.min(1, p.fraction)),
  chapter: p.chapter?.slice(0, 300),
  device: p.device.slice(0, 64),
  deviceName: p.deviceName.slice(0, 64),
});

export async function writeProgress(ctx: MutationCtx, existing: Doc<"progress"> | null, row: Position) {
  if (existing) await ctx.db.replace(existing._id, row);
  else await ctx.db.insert("progress", row);
}

/** The synced reading position of one book (live: updates when another device reads on). */
export const get = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    const user = await allowedUser(ctx);
    if (!user) return null;
    const row = await findProgress(ctx, user._id, bookId);
    if (!row) return null;
    return {
      cfi: row.cfi,
      xpointer: row.xpointer ?? null,
      fraction: row.fraction,
      chapter: row.chapter ?? null,
      device: row.device,
      deviceName: row.deviceName,
      updatedAt: row.updatedAt,
    };
  },
});

/**
 * Store the reading position. A position older than the stored one is ignored (`saved: false`).
 * `now` is the server's clock, so a device can tell if its own is wrong.
 */
export const save = mutation({
  args: {
    bookId: v.id("books"),
    cfi: v.string(),
    xpointer: v.optional(v.string()),
    fraction: v.number(),
    chapter: v.optional(v.string()),
    device: v.string(),
    deviceName: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const answer = (saved: boolean) => ({ saved, now: Date.now() });
    if (!(await ownBook(ctx, user._id, args.bookId))) return answer(false);
    // A device with a clock far in the future must not pin the position forever.
    const row = stored({ ...args, userId: user._id, updatedAt: Math.min(args.updatedAt, Date.now() + 60_000) });
    const existing = await findProgress(ctx, user._id, args.bookId);
    if (existing && existing.updatedAt > row.updatedAt) return answer(false);
    if (existing && existing.cfi === row.cfi && existing.device === row.device) return answer(true);
    await writeProgress(ctx, existing, row);
    return answer(true);
  },
});
