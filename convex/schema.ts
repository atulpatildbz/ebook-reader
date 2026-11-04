import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const format = v.union(
  v.literal("epub"),
  v.literal("mobi"),
  v.literal("azw3"),
  v.literal("pdf"),
  v.literal("fb2"),
  v.literal("cbz"),
);

export default defineSchema({
  ...authTables,
  // Who may sign in (checked before a session is created, and again on every call).
  allowedEmails: defineTable({
    email: v.string(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  // One row per uploaded book. The file itself lives in Convex file storage, private to the owner.
  books: defineTable({
    userId: v.id("users"),
    title: v.string(),
    author: v.string(),
    format,
    fileName: v.string(),
    fileId: v.id("_storage"),
    coverId: v.optional(v.id("_storage")),
    size: v.number(),
    // SHA-256 of the file: the same book uploaded twice is stored once, and devices cache by it.
    sha256: v.string(),
    addedAt: v.number(),
    // How KOReader-sync devices (CrossPoint on the Xteink) name this book: MD5 of the file name,
    // and KOReader's partial MD5 of the file's bytes. Filled in shortly after upload (EPUB only).
    koFile: v.optional(v.string()),
    koBin: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_user_sha", ["userId", "sha256"])
    .index("by_user_kofile", ["userId", "koFile"])
    .index("by_user_kobin", ["userId", "koBin"]),

  // Where the reader is in a book. `updatedAt` is the reading device's clock; the newest wins.
  progress: defineTable({
    userId: v.id("users"),
    bookId: v.id("books"),
    // EPUB CFI from foliate-js (for PDFs a page CFI); exact position on any device. Empty when
    // the position came from an e-reader, which reports only `xpointer`.
    cfi: v.string(),
    // The same position as a KOReader XPointer (/body/DocFragment[3]/body/p[4]/text().17), the
    // form KOReader-sync devices read and write. Converted to and from CFIs in the browser.
    xpointer: v.optional(v.string()),
    fraction: v.number(),
    chapter: v.optional(v.string()),
    device: v.string(),
    deviceName: v.string(),
    updatedAt: v.number(),
  })
    .index("by_user_book", ["userId", "bookId"])
    .index("by_user_updated", ["userId", "updatedAt"]),

  // The password e-readers sign in to the KOReader sync API with (one per user). Devices send
  // MD5(password); stored is SHA-256 of that, so the table alone can't be replayed.
  readerKeys: defineTable({
    userId: v.id("users"),
    username: v.string(),
    keyHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_username", ["username"]),
});
