"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "@/lib/sync/types";
import { Send, Users } from "lucide-react";

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

  // Auto-scroll to bottom when new messages arrive (only if user is at bottom)
  useEffect(() => {
    const el = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (el && isAtBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isAtBottom]);

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

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2.5 bg-muted/30">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Users className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold">Room Chat</h3>
          <p className="text-[10px] text-muted-foreground">
            {participantCount} {participantCount === 1 ? "person" : "people"} online
          </p>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea
        ref={scrollRef}
        className="flex-1 px-2"
        onScroll={handleScroll}
      >
        <div className="flex flex-col gap-1 py-2">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Send className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                No messages yet
              </p>
              <p className="text-xs text-muted-foreground/70">
                Start the conversation 👋
              </p>
            </div>
          )}

          {messages.map((m, i) => {
            const isSystem = m.userId === "system";
            const isMe = m.userId === youId;
            const prevMsg = messages[i - 1];
            const showAvatar =
              !isSystem && (!prevMsg || prevMsg.userId !== m.userId);

            if (isSystem) {
              return (
                <div key={m.id} className="flex justify-center py-1">
                  <span className="rounded-full bg-muted px-3 py-1 text-[10px] text-muted-foreground">
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
                {/* Avatar */}
                <div className="w-7 shrink-0">
                  {showAvatar && (
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: m.color }}
                    >
                      {m.userName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Message bubble */}
                <div
                  className={`flex max-w-[75%] flex-col ${isMe ? "items-end" : "items-start"}`}
                >
                  {showAvatar && !isMe && (
                    <span
                      className="mb-0.5 px-1 text-[10px] font-medium"
                      style={{ color: m.color }}
                    >
                      {m.userName}
                    </span>
                  )}
                  <div
                    className={`rounded-2xl px-3 py-1.5 text-sm ${
                      isMe
                        ? "rounded-br-sm bg-primary text-primary-foreground"
                        : "rounded-bl-sm bg-muted text-foreground"
                    }`}
                  >
                    <p className="break-words leading-snug">{m.text}</p>
                  </div>
                  <span className="mt-0.5 px-1 text-[9px] text-muted-foreground/60">
                    {fmtTime(m.at)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Input */}
      <form onSubmit={submit} className="flex gap-1.5 border-t p-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
          maxLength={1000}
          className="h-9 rounded-full bg-muted text-sm"
        />
        <Button
          type="submit"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full"
          disabled={!text.trim()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
