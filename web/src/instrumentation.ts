/** Runs once when the server boots: schema + first admin account. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { migrate } = await import("@/db/migrate");
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const { hashPassword } = await import("@/lib/auth");
  const { sql } = await import("drizzle-orm");

  await migrate();

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);

  if (count === 0) {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
      console.warn("[fedup] No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env.");
      return;
    }
    await db.insert(users).values({
      email: email.toLowerCase(),
      name: email.split("@")[0],
      passwordHash: await hashPassword(password),
      role: "admin",
    });
    console.log(`[fedup] Created first admin account: ${email}`);
  }
}
