import { sql } from "./index";
import { EMBED_DIMS } from "./schema";

/**
 * Hand-written, idempotent DDL. Runs on every boot; cheap when there's nothing
 * to do. Keeps drizzle-kit out of the production image.
 */
export async function migrate() {
  await sql.unsafe(`
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'adult',
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title text NOT NULL DEFAULT 'New chat',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role text NOT NULL,
      content text NOT NULL,
      model text,
      attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename text NOT NULL,
      mime text NOT NULL,
      size_bytes integer NOT NULL,
      storage_path text NOT NULL,
      shared boolean NOT NULL DEFAULT true,
      status text NOT NULL DEFAULT 'processing',
      error text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shared boolean NOT NULL DEFAULT true,
      idx integer NOT NULL,
      content text NOT NULL,
      embedding vector(${EMBED_DIMS})
    );

    CREATE TABLE IF NOT EXISTS memories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content text NOT NULL,
      kind text NOT NULL DEFAULT 'fact',
      embedding vector(${EMBED_DIMS}),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS generated_images (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
      prompt text NOT NULL,
      storage_path text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS safety_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      surface text NOT NULL,
      prompt text NOT NULL,
      reason text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- Added after first release; safe to re-run.
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
    ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    ALTER TABLE memories ADD COLUMN IF NOT EXISTS source_conversation_id uuid
      REFERENCES conversations(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS conversations_sort_idx
      ON conversations(user_id, pinned DESC, updated_at DESC);

    CREATE INDEX IF NOT EXISTS chunks_embedding_idx
      ON chunks USING hnsw (embedding vector_cosine_ops);
    CREATE INDEX IF NOT EXISTS memories_embedding_idx
      ON memories USING hnsw (embedding vector_cosine_ops);
  `);
}
