// lib/chatPrewarm.js
import { supabase } from "./supabase";
import { setCachedGroupMessages, fetchGroupMessagesEnriched } from "./groupChatCache";

export async function prewarmLatestChats({ chatsLimit = 5, msgsLimit = 5 } = {}) {
  // must be authed
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return;

  const { data: threads } = await supabase
    .from("chat_threads")
    .select("chat_id,is_group,last_sent_at")
    .eq("owner_id", uid)
    .order("last_sent_at", { ascending: false, nullsFirst: true })
    .limit(chatsLimit);

  const groupChats = (threads || []).filter((t) => t.is_group && t.chat_id).map((t) => t.chat_id);

  // warm group caches (enriched) with only last N messages
  await Promise.all(
    groupChats.map(async (chatId) => {
      try {
        const enriched = await fetchGroupMessagesEnriched(chatId, msgsLimit);
        await setCachedGroupMessages(chatId, enriched);
      } catch {}
    })
  );
}
