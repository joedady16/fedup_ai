import {
  pgTable, uuid, text, timestamp, integer, boolean, jsonb, vector, index,
} from "drizzle-orm/pg-core";

/** nomic-embed-text produces 768-dimensional vectors. */
export const EMBED_DIMS = 768;

export type Role = "admin" | "adult" | "kid";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<Role>().notNull().default("adult"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New chat"),
  pinned: boolean("pinned").notNull().default(false),
  /** Null means active. Archiving hides a chat without destroying anything. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant" | "system">().notNull(),
  content: text("content").notNull(),
  model: text("model"),
  /** Attached image URLs (generated pictures, or uploaded images). */
  attachments: jsonb("attachments").$type<string[]>().default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path").notNull(),
  /** Shared docs are searchable by the whole family; private ones only by the owner. */
  shared: boolean("shared").notNull().default(true),
  status: text("status").$type<"processing" | "ready" | "failed">().notNull().default("processing"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const chunks = pgTable("chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  shared: boolean("shared").notNull().default(true),
  idx: integer("idx").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: EMBED_DIMS }),
}, (t) => [
  index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
]);

/** Durable facts the app learns about a person from their prompts. */
export const memories = pgTable("memories", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  kind: text("kind").$type<"preference" | "fact" | "project">().notNull().default("fact"),
  /** Which chat taught us this, so deleting that chat can also forget it. */
  sourceConversationId: uuid("source_conversation_id")
    .references(() => conversations.id, { onDelete: "set null" }),
  embedding: vector("embedding", { dimensions: EMBED_DIMS }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("memories_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
]);

export const generatedImages = pgTable("generated_images", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  prompt: text("prompt").notNull(),
  storagePath: text("storage_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Every blocked prompt, so a parent can see what happened. */
export const safetyEvents = pgTable("safety_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  surface: text("surface").$type<"chat" | "image">().notNull(),
  prompt: text("prompt").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
