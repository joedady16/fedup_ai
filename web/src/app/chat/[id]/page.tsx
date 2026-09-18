import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { listConversations, loadMessages } from "@/lib/chat-data";
import { smartModeAvailable } from "@/lib/ai/anthropic";
import { imagesEnabled } from "@/lib/ai/images";
import ChatShell from "@/components/ChatShell";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const history = await loadMessages(user.id, id);
  if (!history) notFound();

  return (
    <ChatShell
      key={id}
      user={{ name: user.name, role: user.role }}
      conversations={await listConversations(user.id)}
      initialMessages={history}
      conversationId={id}
      smartAvailable={smartModeAvailable()}
      imagesAvailable={imagesEnabled()}
    />
  );
}
