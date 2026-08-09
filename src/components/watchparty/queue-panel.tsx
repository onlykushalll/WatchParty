"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { QueueItem } from "@/lib/sync/types";
import { Play, Trash2, ListVideo } from "lucide-react";

interface QueuePanelProps {
  items: QueueItem[];
  currentIndex: number;
  onSelect: (i: number) => void;
  onRemove: (i: number) => void;
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    const path = url.pathname + url.search;
    return (url.hostname + path).slice(0, 48);
  } catch {
    return u.slice(0, 48);
  }
}

const TYPE_COLORS: Record<string, string> = {
  youtube: "bg-rose-500/15 text-rose-300",
  hls: "bg-amber-500/15 text-amber-300",
  mp4: "bg-emerald-500/15 text-emerald-300",
  webm: "bg-emerald-500/15 text-emerald-300",
  iframe: "bg-violet-500/15 text-violet-300",
};

export function QueuePanel({
  items,
  currentIndex,
  onSelect,
  onRemove,
}: QueuePanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <ListVideo className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Queue
        </h3>
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {items.length}
        </span>
      </div>
      <ScrollArea className="flex-1">
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Queue is empty. Add a video URL to build a playlist.
          </p>
        ) : (
          <ul className="flex flex-col p-1.5">
            {items.map((item, i) => {
              const active = i === currentIndex;
              return (
                <li key={`${i}-${item.url}`}>
                  <div
                    className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                      active ? "bg-accent" : "hover:bg-accent/50"
                    }`}
                  >
                    <button
                      onClick={() => onSelect(i)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold ${
                          active
                            ? "bg-emerald-500 text-white"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {active ? <Play className="h-2.5 w-2.5" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[11px]">
                          {shortUrl(item.url)}
                        </span>
                        <span
                          className={`mt-0.5 inline-block rounded px-1 py-0 text-[9px] ${
                            TYPE_COLORS[item.type] || "bg-muted text-muted-foreground"
                          }`}
                        >
                          {item.type}
                        </span>
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                      onClick={() => onRemove(i)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
