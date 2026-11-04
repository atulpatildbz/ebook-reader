import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { requireUser, allowedUser } from "./auth";
import { format } from "./schema";
import { internal } from "./_generated/api";

const MAX_BOOK_BYTES = 300 * 1024 * 1024;
const MAX_COVER_BYTES = 2 * 1024 * 1024;

/** Who is signed in (null: nobody, or an account that is not allowed). */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await allowedUser(ctx);
    return user ? { email: user.email ?? "", name: user.name ?? "", image: user.image ?? null } : null;
  },
});

/** The library, most recently read first, with each book's progress. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await allowedUser(ctx);
    if (!user) return null;
    const books = await ctx.db
      .query("books")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const progress = await ctx.db
      .query("progress")
      .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
      .collect();
    const byBook = new Map(progress.map((p) => [p.bookId, p]));
    const rows = await Promise.all(
      books.map(async (b) => {
        const p = byBook.get(b._id);
        return {
          _id: b._id,
          title: b.title,
          author: b.author,
          format: b.format,
          size: b.size,
          sha256: b.sha256,
          addedAt: b.addedAt,
          coverUrl: b.coverId ? await ctx.storage.getUrl(b.coverId) : null,
          progress: p
            ? { fraction: p.fraction, chapter: p.chapter ?? null, updatedAt: p.updatedAt, deviceName: p.deviceName }
            : null,
        };
      }),
    );
    rows.sort(
      (a, b) =>
        (b.progress?.updatedAt ?? b.addedAt) - (a.progress?.updatedAt ?? a.addedAt),
    );
    return rows;
  },
});

/** Everything needed to open one book: a download URL for the file and the synced position. */
export const get = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    const user = await requireUser(ctx);
    const book = await ctx.db.get(bookId);
    if (!book || book.userId !== user._id) return null;
    return {
      _id: book._id,
      title: book.title,
      author: book.author,
      format: book.format,
      fileName: book.fileName,
      size: book.size,
      sha256: book.sha256,
      fileUrl: await ctx.storage.getUrl(book.fileId),
    };
  },
});

export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Is this file already in the library? (checked before uploading it again) */
export const findBySha = query({
  args: { sha256: v.string() },
  handler: async (ctx, { sha256 }) => {
    const user = await requireUser(ctx);
    const row = await ctx.db
      .query("books")
      .withIndex("by_user_sha", (q) => q.eq("userId", user._id).eq("sha256", sha256))
      .first();
    return row?._id ?? null;
  },
});

/** Add an uploaded file (and its cover, extracted in the browser) to the library. */
export const create = mutation({
  args: {
    fileId: v.id("_storage"),
    coverId: v.optional(v.id("_storage")),
    title: v.string(),
    author: v.string(),
    format,
    fileName: v.string(),
    sha256: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const meta = await ctx.db.system.get(args.fileId);
    if (!meta) throw new ConvexError("Upload not found");
    const cover = args.coverId ? await ctx.db.system.get(args.coverId) : null;
    const discard = async () => {
      await ctx.storage.delete(args.fileId);
      if (args.coverId) await ctx.storage.delete(args.coverId);
    };
    if (meta.size > MAX_BOOK_BYTES) {
      await discard();
      throw new ConvexError("This file is larger than 300 MB");
    }
    if (cover && (cover.size > MAX_COVER_BYTES || !cover.contentType?.startsWith("image/"))) {
      await ctx.storage.delete(args.coverId!);
      args.coverId = undefined;
    }
    const existing = await ctx.db
      .query("books")
      .withIndex("by_user_sha", (q) => q.eq("userId", user._id).eq("sha256", args.sha256))
      .first();
    if (existing) {
      await discard();
      return existing._id;
    }
    const bookId = await ctx.db.insert("books", {
      userId: user._id,
      title: args.title.trim().slice(0, 500) || args.fileName,
      author: args.author.trim().slice(0, 300),
      format: args.format,
      fileName: args.fileName.slice(0, 300),
      fileId: args.fileId,
      coverId: args.coverId,
      size: meta.size,
      sha256: args.sha256,
      addedAt: Date.now(),
    });
    // Work out how e-readers name this book, so their reading position can be matched to it.
    await ctx.scheduler.runAfter(0, internal.kosync.fingerprint, { bookId });
    return bookId;
  },
});

export const rename = mutation({
  args: { bookId: v.id("books"), title: v.string(), author: v.string() },
  handler: async (ctx, { bookId, title, author }) => {
    const user = await requireUser(ctx);
    const book = await ctx.db.get(bookId);
    if (!book || book.userId !== user._id) throw new ConvexError("Book not found");
    await ctx.db.patch(bookId, { title: title.trim().slice(0, 500) || book.title, author: author.trim().slice(0, 300) });
  },
});

/** Remove a book, its file, cover and reading position. */
export const remove = mutation({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    const user = await requireUser(ctx);
    const book = await ctx.db.get(bookId);
    if (!book || book.userId !== user._id) return;
    await ctx.storage.delete(book.fileId);
    if (book.coverId) await ctx.storage.delete(book.coverId);
    const progress = await ctx.db
      .query("progress")
      .withIndex("by_user_book", (q) => q.eq("userId", user._id).eq("bookId", bookId))
      .collect();
    for (const p of progress) await ctx.db.delete(p._id);
    await ctx.db.delete(bookId);
  },
});
