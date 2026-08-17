"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "@/lib/sync/types";
import { Send, Users, CheckCheck, Smile } from "lucide-react";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  youColor: string;
  youId: string;
  participantCount: number;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatPanel({
  messages,
  onSend,
  youColor,
  youId,
  participantCount,
}: ChatPanelProps) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Filter out noisy system spam (e.g. buffering, left, ready) to keep conversation clean
  const cleanMessages = useMemo(() => {
    return messages.filter((m) => {
      if (m.userId === "system") {
        const t = (m.text || "").toLowerCase();
        if (t.includes("buffering") || t.includes("left") || t.includes("ready") || t.includes("resuming")) {
          return false;
        }
      }
      return true;
    });
  }, [messages]);

  // Auto-scroll to bottom when new messages arrive (only if user is at bottom)
  useEffect(() => {
    const el = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (el && isAtBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [cleanMessages, isAtBottom]);

  const handleScroll = () => {
    const el = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (el) {
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      setIsAtBottom(atBottom);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
    setIsAtBottom(true);
  };

  const quickEmoji = (emoji: string) => {
    onSend(emoji);
    setIsAtBottom(true);
  };

  return (
    <div className="flex h-full flex-col bg-[#0b141a] text-zinc-100 font-sans selection:bg-[#00a884] selection:text-white">
      {/* WhatsApp Emerald Header */}
      <div className="flex items-center gap-2.5 border-b border-[#222d34] bg-[#1f2c34] px-3 py-2.5 shadow-sm">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#00a884] text-white shadow-md">
          <Users className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold text-[#e9edef] tracking-tight">
            WatchParty Group Chat
          </h3>
          <p className="flex items-center gap-1 text-[10px] text-[#8696a0]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#00a884] animate-pulse" />
            {participantCount} {participantCount === 1 ? "participant" : "participants"} online
          </p>
        </div>
        <div className="flex items-center gap-1">
          <span className="rounded bg-[#005c4b]/40 px-2 py-0.5 font-mono text-[10px] text-[#00a884] border border-[#005c4b]">
            WhatsApp Mode
          </span>
        </div>
      </div>

      {/* WhatsApp Wallpaper Texture Canvas Area */}
      <div className="relative flex-1 min-h-0 bg-[#0b141a]">
        {/* Subtle WhatsApp Wallpaper Pattern Overlay */}
        <div
          className="absolute inset-0 pointer-events-none opacity-5"
          style={{
            backgroundImage: `radial-gradient(#00a884 1px, transparent 1px)`,
            backgroundSize: "16px 16px",
          }}
        />

        <ScrollArea
          ref={scrollRef}
          className="h-full px-3"
          onScroll={handleScroll}
        >
          <div className="flex flex-col gap-1.5 py-3">
            {cleanMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#111b21] border border-[#222d34]">
                  <Send className="h-5 w-5 text-[#00a884]" />
                </div>
                <p className="text-xs font-semibold text-[#e9edef]">
                  WhatsApp Room Chat
                </p>
                <p className="max-w-[200px] text-[11px] text-[#8696a0]">
                  Messages are end-to-end synchronized across all party members.
                </p>
              </div>
            )}

            {cleanMessages.map((m, i) => {
              const isSystem = m.userId === "system";
              const isMe = m.userId === youId;
              const prevMsg = cleanMessages[i - 1];
              const showAvatar =
                !isSystem && (!prevMsg || prevMsg.userId !== m.userId);

              if (isSystem) {
                return (
                  <div key={m.id} className="flex justify-center py-1">
                    <span className="rounded-lg bg-[#182229]/90 border border-[#005c4b]/30 px-3 py-1 text-[10px] font-medium text-[#00a884] shadow-sm">
                      {m.text}
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={m.id}
                  className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}
                >
                  {/* Avatar for incoming messages */}
                  {!isMe && (
                    <div className="w-7 shrink-0">
                      {showAvatar && (
                        <div
                          className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm"
                          style={{ backgroundColor: m.color }}
                        >
                          {m.userName.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Message bubble */}
                  <div
                    className={`flex max-w-[80%] flex-col ${
                      isMe ? "items-end" : "items-start"
                    }`}
                  >
                    {showAvatar && !isMe && (
                      <span className="mb-0.5 text-[10px] font-semibold text-[#00a884]">
                        {m.userName}
                      </span>
                    )}
                    <div
                      className={`relative rounded-xl px-3 py-1.5 shadow-sm text-xs leading-relaxed break-words max-w-full ${
                        isMe
                          ? "rounded-tr-none bg-[#005c4b] text-[#e9edef]"
                          : "rounded-tl-none bg-[#202c33] text-[#e9edef]"
                      }`}
                    >
                      <span>{m.text}</span>
                      <div
                        className={`flex items-center gap-1 mt-0.5 justify-end text-[9px] ${
                          isMe ? "text-[#8696a0]" : "text-[#8696a0]"
                        }`}
                      >
                        <span>{fmtTime(m.at)}</span>
                        {isMe && (
                          <CheckCheck className="h-3 w-3 text-[#53bdeb]" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Quick Emoji Bar */}
      <div className="flex items-center justify-around border-t border-[#222d34] bg-[#1f2c34] px-2 py-1.5 text-sm">
        {["👍", "❤️", "😂", "😮", "🎉", "🔥", "👏"].map((emoji) => (
          <button
            key={emoji}
            onClick={() => quickEmoji(emoji)}
            className="rounded-full p-1 hover:bg-[#2a3942] transition-colors active:scale-125"
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* WhatsApp Message Input Bar */}
      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-[#222d34] bg-[#1f2c34] p-2"
      >
        <div className="relative flex-1">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message…"
            className="h-9 rounded-lg bg-[#2a3942] border-0 text-[#e9edef] placeholder:text-[#8696a0] pr-8 text-xs focus-visible:ring-1 focus-visible:ring-[#00a884]"
          />
          <Smile className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8696a0] pointer-events-none" />
        </div>
        <Button
          type="submit"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full bg-[#00a884] text-white hover:bg-[#00a884]/90 shadow-md transition-all active:scale-95"
          disabled={!text.trim()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
