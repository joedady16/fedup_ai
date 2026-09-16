import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { listConversations } from "@/lib/chat-data";
import { smartModeAvailable } from "@/lib/ai/anthropic";
import { imagesEnabled } from "@/lib/ai/images";
import ChatShell from "@/components/ChatShell";

export const dynamic = "force-dynamic";

export default async function NewChatPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  return (
    <ChatShell
      user={{ name: user.name, role: user.role }}
      conversations={await listConversations(user.id)}
      initialMessages={[]}
      conversationId={null}
      smartAvailable={smartModeAvailable()}
      imagesAvailable={imagesEnabled()}
    />
  );
}
