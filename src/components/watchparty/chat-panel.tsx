"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "@/lib/sync/types";
import { Send } from "lucide-react";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  youColor: string;
}

export function ChatPanel({ messages, onSend, youColor }: ChatPanelProps) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Chat
        </h3>
      </div>
      <ScrollArea ref={scrollRef} className="flex-1 px-2">
        <div className="flex flex-col gap-1.5 py-2">
          {messages.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No messages yet. Say hi! 👋
            </p>
          )}
          {messages.map((m) => {
            const isSystem = m.userId === "system";
            if (isSystem) {
              return (
                <div key={m.id} className="px-2 py-0.5 text-center">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {m.text}
                  </span>
                </div>
              );
            }
            return (
              <div key={m.id} className="flex gap-2 px-1">
                <div
                  className="mt-0.5 h-6 w-6 shrink-0 rounded-full text-center text-[10px] font-bold leading-6 text-white"
                  style={{ backgroundColor: m.color }}
                >
                  {m.userName.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="truncate text-xs font-medium" style={{ color: m.color }}>
                      {m.userName}
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="break-words text-sm leading-snug">{m.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <form onSubmit={submit} className="flex gap-1.5 border-t p-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message…"
          maxLength={1000}
          className="h-8 text-sm"
        />
        <Button type="submit" size="icon" className="h-8 w-8 shrink-0">
          <Send className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  );
}
