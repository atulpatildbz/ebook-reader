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
  })
    .index("by_user", ["userId"])
    .index("by_user_sha", ["userId", "sha256"]),

  // Where the reader is in a book. `updatedAt` is the reading device's clock; the newest wins.
  progress: defineTable({
    userId: v.id("users"),
    bookId: v.id("books"),
    // EPUB CFI from foliate-js (for PDFs a page CFI); exact position on any device.
    cfi: v.string(),
    fraction: v.number(),
    chapter: v.optional(v.string()),
    device: v.string(),
    deviceName: v.string(),
    updatedAt: v.number(),
  })
    .index("by_user_book", ["userId", "bookId"])
    .index("by_user_updated", ["userId", "updatedAt"]),
});
