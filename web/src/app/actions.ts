"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { db } from "@/db";
import { conversations, generatedImages, memories, users, type Role } from "@/db/schema";
import {
  createSession, destroySession, hashPassword, requireAdmin, requireUser, verifyPassword,
} from "@/lib/auth";
import { IMAGES_DIR } from "@/lib/ai/images";

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

// ---------------------------------------------------------------------------
// Conversation management
// ---------------------------------------------------------------------------

/** Confirms the conversation belongs to the caller before touching it. */
async function ownedConversation(id: string) {
  const user = await requireUser();
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)))
    .limit(1);
  if (!row) throw new Error("NOT_FOUND");
  return { user, row };
}

export async function togglePinAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { row } = await ownedConversation(id);
  await db
    .update(conversations)
    .set({ pinned: !row.pinned })
    .where(eq(conversations.id, id));
  revalidatePath("/chat");
}

export async function toggleArchiveAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { row } = await ownedConversation(id);
  await db
    .update(conversations)
    // Archiving also unpins: a pinned-but-hidden chat makes no sense.
    .set({ archivedAt: row.archivedAt ? null : new Date(), pinned: false })
    .where(eq(conversations.id, id));
  revalidatePath("/chat");
}

/**
 * Deletes a conversation and everything that belongs only to it.
 *
 * Memories are per-user and outlive the chat that taught them, so forgetting
 * is opt-in — otherwise deleting a chat would leave the assistant still
 * quoting things from it, which is not what "delete" implies.
 */
export async function deleteConversationAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const forget = formData.get("forget") === "true";
  const { row } = await ownedConversation(id);

  const pictures = await db
    .select({ storagePath: generatedImages.storagePath })
    .from(generatedImages)
    .where(eq(generatedImages.conversationId, id));

  if (forget) {
    await db.delete(memories).where(eq(memories.sourceConversationId, id));
  }

  // messages and generated_images rows cascade or null out via the schema.
  await db.delete(generatedImages).where(eq(generatedImages.conversationId, id));
  await db.delete(conversations).where(eq(conversations.id, row.id));

  // Remove the image files too, so deleting really deletes.
  for (const p of pictures) {
    const name = p.storagePath.split("/").pop();
    if (name && /^[\w-]+\.(png|svg)$/.test(name)) {
      await unlink(path.join(IMAGES_DIR, name)).catch(() => {
        /* already gone */
      });
    }
  }

  revalidatePath("/chat");
  redirect("/chat");
}

export async function renameConversationAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim().slice(0, 120);
  if (!title) return;
  await ownedConversation(id);
  await db.update(conversations).set({ title }).where(eq(conversations.id, id));
  revalidatePath("/chat");
}
