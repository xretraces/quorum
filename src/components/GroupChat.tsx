// src/components/GroupChat.tsx: real-time group chat using Supabase Realtime
import { useCallback, useEffect, useRef, useState } from "react";
import { type Message, myMemberId, supabase } from "../lib/supabase";
import { nextDraftAfterSend } from "../lib/voice-logic";
import { VoiceButton } from "./VoiceButton";

type Props = {
  groupId: string;
  memberName: string;
  onTranscriptChange?: (transcript: string) => void;
  onVoiceError?: (message: string) => void;
  onVoiceInfo?: (message: string) => void;
};

export function GroupChat({ groupId, memberName, onTranscriptChange, onVoiceError, onVoiceInfo }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const meId = myMemberId(groupId);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true });
    if (data) setMessages(data as Message[]);
  }, [groupId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`chat-${groupId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `group_id=eq.${groupId}` },
        (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  useEffect(() => {
    const transcript = messages.map((m) => `${m.sender_name}: ${m.text}`).join("\n");
    onTranscriptChange?.(transcript);
  }, [messages, onTranscriptChange]);

  async function postMessage(body: string, opts?: { clearDraft?: boolean }) {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const { error } = await supabase.from("messages").insert({
        group_id: groupId,
        member_id: meId,
        sender_name: memberName,
        text: trimmed,
      });
      if (error) throw error;
      setText((draft) => nextDraftAfterSend(draft, opts?.clearDraft !== false));
    } finally {
      setSending(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    try {
      await postMessage(text);
    } catch (err) {
      onVoiceError?.(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col h-80 rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-gray-400 text-sm text-center py-4">
            No messages yet. Start planning!
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[80%] rounded-lg p-2 ${
              m.member_id === meId
                ? "ml-auto bg-indigo-600 text-white"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            <p className="text-xs font-semibold opacity-75">
              {m.sender_name}{" "}
              <span className="font-normal">{new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            </p>
            <p className="text-sm break-words">{m.text}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="border-t border-gray-200 p-2 flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type or tap 🎙 — budget, diet, time, ride…"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        <VoiceButton
          disabled={sending}
          extraKeyterms={[memberName]}
          idleLabel="🎙"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          onTranscript={(spoken) => postMessage(spoken, { clearDraft: false })}
          onError={onVoiceError}
          onInfo={onVoiceInfo}
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
