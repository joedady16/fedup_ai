import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Sql = ReturnType<typeof postgres>;
type Db = ReturnType<typeof drizzle<typeof schema>>;

// Reuse across hot reloads in dev so we don't exhaust connections.
const g = globalThis as unknown as { _sql?: Sql; _db?: Db };

/**
 * Connects on first use, not at import time — Next evaluates these modules
 * during the build, where DATABASE_URL legitimately isn't set yet.
 */
function conn(): Sql {
  if (g._sql) return g._sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  g._sql = postgres(url, { max: 10 });
  return g._sql;
}

function orm(): Db {
  g._db ??= drizzle(conn(), { schema });
  return g._db;
}

export const sql = new Proxy(function () {} as unknown as Sql, {
  apply: (_t, _self, args: unknown[]) =>
    (conn() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_t, prop) => (conn() as unknown as Record<string | symbol, unknown>)[prop],
}) as Sql;

export const db = new Proxy({} as Db, {
  get: (_t, prop) => (orm() as unknown as Record<string | symbol, unknown>)[prop],
}) as Db;

export { schema };
