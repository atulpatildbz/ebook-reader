// E-reader sync: the KOReader sync protocol (as spoken by CrossPoint on the Xteink), backed by the
// same `progress` rows the web reader uses. Positions arrive as KOReader XPointers; the browser
// turns them into CFIs (and back), since only it can read the book's chapters.
import SparkMD5 from "spark-md5";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { allowedUser, emailAllowed } from "./auth";

export const md5Hex = (s: string) => SparkMD5.hash(s);

export async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** KOReader's document id: MD5 of 1 KB read at offsets 0, 1 K, 4 K, 16 K, … 1 G (those inside the file). */
async function partialMd5(file: Blob) {
  const md5 = new SparkMD5.ArrayBuffer();
  for (let i = -1; i <= 10; i++) {
    const offset = i < 0 ? 0 : 1024 << (2 * i);
    if (offset >= file.size) break;
    md5.append(await file.slice(offset, offset + 1024).arrayBuffer());
  }
  return md5.end();
}

// ---- Naming books the way devices do ----

export const fingerprint = internalAction({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    const book = await ctx.runQuery(internal.kosync.bookFile, { bookId });
    if (!book || book.format !== "epub") return; // CrossPoint reads EPUB only
    const file = await ctx.storage.get(book.fileId);
    if (!file) return;
    await ctx.runMutation(internal.kosync.setIds, { bookId, koFile: md5Hex(book.fileName), koBin: await partialMd5(file) });
  },
});

export const bookFile = internalQuery({
  args: { bookId: v.id("books") },
  handler: (ctx, { bookId }) => ctx.db.get(bookId),
});

export const setIds = internalMutation({
  args: { bookId: v.id("books"), koFile: v.string(), koBin: v.string() },
  handler: async (ctx, { bookId, ...ids }) => {
    if (await ctx.db.get(bookId)) await ctx.db.patch(bookId, ids);
  },
});

/** Name every book uploaded before e-reader sync existed. */
export const fingerprintAll = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const books = await ctx.db
      .query("books")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    let n = 0;
    for (const b of books) {
      if (b.format === "epub" && !b.koBin) await ctx.scheduler.runAfter(n++ * 500, internal.kosync.fingerprint, { bookId: b._id });
    }
    return n;
  },
});

// ---- The device's password ----

/** The e-reader sign-in, without the password (shown only once, when made). */
export const account = query({
  args: {},
  handler: async (ctx) => {
    const user = await allowedUser(ctx);
    if (!user) return null;
    const key = await ctx.db
      .query("readerKeys")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    return { username: key?.username ?? usernameFor(user.email ?? ""), createdAt: key?.createdAt ?? null };
  },
});

const usernameFor = (email: string) => email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "") || "reader";

/** Make a new password for e-readers (replacing any earlier one) and return it, once. */
export const createKey = action({
  args: {},
  handler: async (ctx): Promise<{ username: string; password: string }> => {
    const userId = await getAuthUserId(ctx);
    const email = userId ? await ctx.runQuery(internal.kosync.allowedEmail, { userId }) : null;
    if (!userId || !email) throw new ConvexError("not-signed-in");
    // 16 characters without look-alikes (no i, l, o, 0, 1): about 79 bits, in groups of four.
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    let raw = "";
    while (raw.length < 16) {
      for (const b of crypto.getRandomValues(new Uint8Array(32))) {
        if (b < 248 && raw.length < 16) raw += alphabet[b % 31]; // 248 = 8 × 31: no bias
      }
    }
    const password = raw.match(/.{4}/g)!.join("-");
    const username = usernameFor(email);
    await ctx.runMutation(internal.kosync.storeKey, { userId, username, keyHash: await sha256Hex(md5Hex(password)) });
    return { username, password };
  },
});

export const allowedEmail = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return user && (await emailAllowed(ctx, user.email)) ? user.email! : null;
  },
});

export const storeKey = internalMutation({
  args: { userId: v.id("users"), username: v.string(), keyHash: v.string() },
  handler: async (ctx, args) => {
    const taken = await ctx.db
      .query("readerKeys")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();
    if (taken && taken.userId !== args.userId) throw new ConvexError("That username is taken");
    const mine = await ctx.db
      .query("readerKeys")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (mine) await ctx.db.patch(mine._id, { ...args, createdAt: Date.now() });
    else await ctx.db.insert("readerKeys", { ...args, createdAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.kosync.fingerprintAll, { userId: args.userId });
  },
});

// ---- What the HTTP API (convex/http.ts) needs ----

/** The user a device's x-auth-user / x-auth-key belong to, if still allowlisted. */
export const authorize = internalQuery({
  args: { username: v.string(), keyHash: v.string() },
  handler: async (ctx, { username, keyHash }) => {
    const key = await ctx.db
      .query("readerKeys")
      .withIndex("by_username", (q) => q.eq("username", username))
      .first();
    if (!key || key.keyHash !== keyHash) return null;
    const user = await ctx.db.get(key.userId);
    return user && (await emailAllowed(ctx, user.email)) ? user._id : null;
  },
});

async function findBook(ctx: { db: import("./_generated/server").QueryCtx["db"] }, userId: Id<"users">, document: string) {
  return (
    (await ctx.db
      .query("books")
      .withIndex("by_user_kobin", (q) => q.eq("userId", userId).eq("koBin", document))
      .first()) ??
    (await ctx.db
      .query("books")
      .withIndex("by_user_kofile", (q) => q.eq("userId", userId).eq("koFile", document))
      .first())
  );
}

export const getProgress = internalQuery({
  args: { userId: v.id("users"), document: v.string() },
  handler: async (ctx, { userId, document }) => {
    const book = await findBook(ctx, userId, document);
    if (!book) return null;
    return await ctx.db
      .query("progress")
      .withIndex("by_user_book", (q) => q.eq("userId", userId).eq("bookId", book._id))
      .first();
  },
});

/** A position reported by an e-reader. Returns false when the book isn't in the library. */
export const putProgress = internalMutation({
  args: { userId: v.id("users"), document: v.string(), xpointer: v.string(), fraction: v.number(), device: v.string(), deviceName: v.string() },
  handler: async (ctx, { userId, document, xpointer, fraction, device, deviceName }) => {
    const book = await findBook(ctx, userId, document);
    if (!book) return false;
    const existing = await ctx.db
      .query("progress")
      .withIndex("by_user_book", (q) => q.eq("userId", userId).eq("bookId", book._id))
      .first();
    fraction = Math.max(0, Math.min(1, fraction));
    // A device that just took the synced position reports it back in its own words; that is not
    // reading on, and must not prompt the other devices to "go there".
    if (existing && existing.device !== device && Math.abs(existing.fraction - fraction) < 0.002) return true;
    const row = {
      userId,
      bookId: book._id,
      cfi: "",
      xpointer: xpointer.slice(0, 2000),
      fraction,
      device: device.slice(0, 64),
      deviceName: deviceName.slice(0, 64),
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("progress", row);
    return true;
  },
});
