"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users, type Role } from "@/db/schema";
import {
  createSession, destroySession, hashPassword, requireAdmin, verifyPassword,
} from "@/lib/auth";

export type FormState = { error?: string; ok?: string };

const Login = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = Login.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);

  // Same message either way, so we don't reveal which emails exist.
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: "Wrong email or password." };
  }

  await createSession({ id: user.id, email: user.email, name: user.name, role: user.role });
  redirect("/chat");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

const NewUser = z.object({
  email: z.string().email("Enter a valid email address."),
  name: z.string().min(1, "Enter a name."),
  password: z.string().min(8, "Use at least 8 characters."),
  role: z.enum(["admin", "adult", "kid"]),
});

export async function createUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();

  const parsed = NewUser.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    name: String(formData.get("name") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    role: String(formData.get("role") ?? "kid") as Role,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);
  if (existing) return { error: "That email already has an account." };

  await db.insert(users).values({
    email: parsed.data.email,
    name: parsed.data.name,
    role: parsed.data.role,
    passwordHash: await hashPassword(parsed.data.password),
  });

  revalidatePath("/admin");
  return { ok: `Created an account for ${parsed.data.name}.` };
}

export async function deleteUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (id === admin.id) return { error: "You can't delete your own account." };

  await db.delete(users).where(eq(users.id, id));
  revalidatePath("/admin");
  return { ok: "Account removed." };
}
