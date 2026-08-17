"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { QueueItem, detectVideoType } from "@/lib/sync/types";
import {
  Play,
  Trash2,
  ListVideo,
  Plus,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Repeat,
} from "lucide-react";

export interface QueuePanelProps {
  items: QueueItem[];
  currentIndex: number;
  onSelect: (i: number) => void;
  onRemove: (i: number) => void;
  onAdd?: (url: string, type?: string) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onMoveUp?: (index: number) => void;
  onMoveDown?: (index: number) => void;
  autoplayNext?: boolean;
  onToggleAutoplay?: (enabled: boolean) => void;
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
  youtube: "bg-rose-500/15 text-rose-400 border border-rose-500/20",
  hls: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  mp4: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  webm: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  iframe: "bg-violet-500/15 text-violet-400 border border-violet-500/20",
  torrent: "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20",
  file: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
};

export function QueuePanel({
  items,
  currentIndex,
  onSelect,
  onRemove,
  onAdd,
  onReorder,
  onMoveUp,
  onMoveDown,
  autoplayNext = true,
  onToggleAutoplay,
}: QueuePanelProps) {
  const [addUrl, setAddUrl] = useState("");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const url = addUrl.trim();
    if (!url || !onAdd) return;
    const type = detectVideoType(url);
    onAdd(url, type);
    setAddUrl("");
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    if (onMoveUp) {
      onMoveUp(index);
    } else if (onReorder) {
      onReorder(index, index - 1);
    }
  };

  const handleMoveDown = (index: number) => {
    if (index >= items.length - 1) return;
    if (onMoveDown) {
      onMoveDown(index);
    } else if (onReorder) {
      onReorder(index, index + 1);
    }
  };

  return (
    <div className="flex h-full flex-col bg-card text-card-foreground">
      {/* Header with Title and Autoplay Toggle */}
      <div className="flex items-center gap-1.5 border-b px-3 py-2 shrink-0">
        <ListVideo className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Playlist Queue
        </h3>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          {items.length}
        </span>

        {onToggleAutoplay && (
          <button
            onClick={() => onToggleAutoplay(!autoplayNext)}
            className={`ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              autoplayNext
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                : "bg-muted text-muted-foreground"
            }`}
            title={autoplayNext ? "Autoplay Next enabled" : "Autoplay Next disabled"}
          >
            <Repeat className="h-3 w-3" />
            <span>Autoplay</span>
          </button>
        )}
      </div>

      {/* Quick Add Bar if onAdd provided */}
      {onAdd && (
        <form onSubmit={handleAdd} className="flex gap-1.5 border-b p-2 shrink-0 bg-muted/20">
          <Input
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            placeholder="Paste video URL to queue…"
            className="h-7 text-xs flex-1"
          />
          <Button
            type="submit"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            disabled={!addUrl.trim()}
          >
            <Plus className="h-3 w-3" /> Add
          </Button>
        </form>
      )}

      {/* Playlist Items List */}
      <ScrollArea className="flex-1 min-h-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <ListVideo className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs font-medium text-foreground">Queue is empty</p>
            <p className="max-w-[200px] text-[11px] text-muted-foreground">
              Add YouTube, HLS streams, or MP4 video links to create a synchronized room playlist.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col p-1.5 gap-1">
            {items.map((item, i) => {
              const active = i === currentIndex;
              return (
                <li key={`${i}-${item.url}`}>
                  <div
                    className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-all ${
                      active
                        ? "bg-accent border border-primary/20 shadow-xs"
                        : "hover:bg-accent/50 border border-transparent"
                    }`}
                  >
                    <button
                      onClick={() => onSelect(i)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold shadow-xs ${
                          active
                            ? "bg-emerald-500 text-white animate-pulse"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {active ? <Play className="h-2.5 w-2.5 fill-current" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[11px] font-medium text-foreground">
                          {shortUrl(item.url)}
                        </span>
                        <span
                          className={`mt-0.5 inline-block rounded px-1.5 py-0 text-[9px] font-semibold ${
                            TYPE_COLORS[item.type] || "bg-muted text-muted-foreground"
                          }`}
                        >
                          {item.type.toUpperCase()}
                        </span>
                      </span>
                    </button>

                    {/* Reorder Up / Down & Remove Buttons */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {(onMoveUp || onReorder) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-muted-foreground hover:text-foreground"
                          disabled={i === 0}
                          onClick={() => handleMoveUp(i)}
                          title="Move up"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                      )}
                      {(onMoveDown || onReorder) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-muted-foreground hover:text-foreground"
                          disabled={i === items.length - 1}
                          onClick={() => handleMoveDown(i)}
                          title="Move down"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-muted-foreground hover:text-destructive"
                        onClick={() => onRemove(i)}
                        title="Remove from queue"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
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
