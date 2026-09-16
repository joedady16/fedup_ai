/** Runs once when the server boots: schema + first admin account. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { migrate } = await import("@/db/migrate");
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const { hashPassword } = await import("@/lib/auth");
  const { sql } = await import("drizzle-orm");

  /**
   * Postgres may not be accepting connections yet. `depends_on` covers a normal
   * `compose up`, but not a host reboot, where Docker restarts containers in
   * whatever order it likes — without this retry the app would come up with no
   * schema and serve 500s until someone noticed.
   */
  const attempts = 30;
  for (let i = 1; i <= attempts; i++) {
    try {
      await migrate();
      break;
    } catch (e) {
      if (i === attempts) {
        console.error("[fedup] Database never became reachable; giving up.", e);
        return;
      }
      const wait = Math.min(1000 * i, 5000);
      console.warn(`[fedup] Database not ready (attempt ${i}/${attempts}), retrying in ${wait}ms…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

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
