"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSyncEngine } from "@/lib/sync/use-sync-engine";
import { detectVideoType } from "@/lib/sync/types";
import { UniversalPlayer } from "@/components/watchparty/universal-player";
import { VirtualBrowser } from "@/components/watchparty/virtual-browser";
import { ChatPanel } from "@/components/watchparty/chat-panel";
import { QueuePanel } from "@/components/watchparty/queue-panel";
import { ReactionRain } from "@/components/watchparty/reaction-rain";
import {
  ParticipantsList,
  SyncIndicator,
} from "@/components/watchparty/participants-list";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

import {
  Play,
  Users,
  MessageSquare,
  ListVideo,
  Sun,
  Moon,
  Copy,
  Check,
  Plus,
  Sparkles,
  Film,
  Globe,
  Zap,
  MonitorPlay,
  Link2,
  ArrowRight,
  Flame,
  Heart,
  Laugh,
  PartyPopper,
  ThumbsUp,
  Menu,
} from "lucide-react";

// ── Inline theme hook (avoids module resolution issues with Turbopack
// in the user's home directory) ──
type Theme = "light" | "dark";
function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    const initial = stored || "dark";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(initial);
    if (initial === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, []);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem("theme", t);
    if (t === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  };
  return { theme, setTheme };
}

const REACTIONS = [
  { emoji: "🔥", icon: Flame },
  { emoji: "❤️", icon: Heart },
  { emoji: "😂", icon: Laugh },
  { emoji: "🎉", icon: PartyPopper },
  { emoji: "👍", icon: ThumbsUp },
];

function genId() {
  return "u-" + Math.random().toString(36).slice(2, 10);
}

export default function Home() {
  // View state: "landing" | "room"
  const [view, setView] = useState<"landing" | "room">("landing");
  const [roomSlug, setRoomSlug] = useState<string>("");
  const [roomName, setRoomName] = useState<string>("");
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [mobilePanel, setMobilePanel] = useState(false);

  // Generate userId after mount (Math.random would cause hydration mismatch).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserId(genId());
  }, []);

  // Load persisted username after mount (avoids SSR hydration mismatch).
  useEffect(() => {
    const saved = localStorage.getItem("wp:userName");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setUserName(saved);
  }, []);

  // Persist username locally.
  useEffect(() => {
    if (userName) localStorage.setItem("wp:userName", userName);
  }, [userName]);

  // Restore room from URL hash (#/room/slug).
  useEffect(() => {
    const restore = () => {
      const h = window.location.hash;
      const m = h.match(/^#\/room\/(.+)$/);
      if (m) {
        setRoomSlug(m[1]);
        setView("room");
      }
    };
    restore();
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, []);

  const enterRoom = useCallback(
    (slug: string, name?: string) => {
      setRoomSlug(slug);
      if (name) setRoomName(name);
      setView("room");
      window.location.hash = `/room/${slug}`;
    },
    [],
  );

  const leaveRoom = useCallback(() => {
    setView("landing");
    setRoomSlug("");
    setRoomName("");
    if (window.location.hash) {
      history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (view === "landing" || !roomSlug || !userId) {
    return (
      <Landing
        defaultName={userName}
        onName={setUserName}
        onEnter={enterRoom}
      />
    );
  }

  return (
    <RoomView
      roomSlug={roomSlug}
      roomName={roomName}
      userId={userId}
      userName={userName || "Guest"}
      onLeave={leaveRoom}
      mobilePanel={mobilePanel}
      setMobilePanel={setMobilePanel}
    />
  );
}

/* ═══════════════════════ LANDING ═══════════════════════ */

function Landing({
  defaultName,
  onName,
  onEnter,
}: {
  defaultName: string;
  onName: (n: string) => void;
  onEnter: (slug: string, name?: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [joinSlug, setJoinSlug] = useState("");
  const [creating, setCreating] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (defaultName) setName(defaultName);
  }, [defaultName]);

  const createRoom = async () => {
    if (!name.trim()) {
      toast.error("Enter your name first");
      return;
    }
    onName(name.trim());
    setCreating(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${name}'s party` }),
      });
      if (!res.ok) throw new Error("Failed to create room");
      const data = await res.json();
      onEnter(data.slug, data.name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create room");
    } finally {
      setCreating(false);
    }
  };

  const joinRoom = () => {
    if (!name.trim()) {
      toast.error("Enter your name first");
      return;
    }
    const slug = joinSlug
      .trim()
      .toLowerCase()
      .replace(/^#\/room\//, "")
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!slug) {
      toast.error("Enter a room code or link");
      return;
    }
    onName(name.trim());
    onEnter(slug);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-lg shadow-violet-500/20">
              <Play className="h-4 w-4 fill-current" />
            </div>
            <span className="text-base font-semibold tracking-tight">
              Watch<span className="text-primary">Party</span>
            </span>
          </div>
          <Badge variant="secondary" className="hidden sm:flex">
            <Sparkles className="mr-1 h-3 w-3" /> real-time sync
          </Badge>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center px-4 py-10 sm:py-16">
        <div className="mb-3 flex items-center gap-2 rounded-full border bg-card/50 px-3 py-1 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          NTP-grade clock sync · 90ms drift tolerance
        </div>
        <h1 className="max-w-3xl text-center text-4xl font-bold tracking-tight sm:text-6xl">
          Watch anything,
          <br />
          <span className="bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent">
            together in sync.
          </span>
        </h1>
        <p className="mt-5 max-w-xl text-center text-base text-muted-foreground sm:text-lg">
          Paste a link — YouTube, a movie stream, an HLS feed, or any website.
          Your friends see the same frame at the same instant. Chat, react,
          and feel like you&apos;re on the same couch.
        </p>

        {/* Create / Join card */}
        <div className="mt-10 grid w-full max-w-3xl gap-4 sm:grid-cols-2">
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
                <Plus className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-semibold">Start a room</h2>
            </div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="mb-3"
              maxLength={32}
            />
            <Button
              className="w-full"
              onClick={createRoom}
              disabled={creating}
            >
              {creating ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Creating…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Create room <ArrowRight className="h-3.5 w-3.5" />
                </span>
              )}
            </Button>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                <Link2 className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-semibold">Join a room</h2>
            </div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="mb-3"
              maxLength={32}
            />
            <div className="flex gap-2">
              <Input
                value={joinSlug}
                onChange={(e) => setJoinSlug(e.target.value)}
                placeholder="room code or link"
                onKeyDown={(e) => e.key === "Enter" && joinRoom()}
              />
              <Button variant="secondary" onClick={joinRoom}>
                Join
              </Button>
            </div>
          </div>
        </div>

        {/* Feature grid */}
        <div className="mt-16 grid w-full max-w-4xl gap-4 sm:grid-cols-3">
          {[
            {
              icon: Zap,
              title: "Perfect sync",
              desc: "Cristian's clock-sync algorithm keeps everyone on the same frame — drift auto-corrects within 100ms.",
            },
            {
              icon: Globe,
              title: "Universal video",
              desc: "YouTube, HLS (.m3u8), MP4, WebM, or any website via a proxy that strips frame blockers.",
            },
            {
              icon: MonitorPlay,
              title: "Browse together",
              desc: "Co-browse any site in an embedded frame, or queue up a playlist and take turns controlling.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-xl border bg-card/50 p-4"
            >
              <f.icon className="mb-2 h-5 w-5 text-primary" />
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t px-4 py-4 text-center text-xs text-muted-foreground">
        Built with Next.js · Socket.IO · Cristian&apos;s algorithm · No
        account needed
      </footer>
      <Toaster />
    </div>
  );
}

/* ═══════════════════════ ROOM ═══════════════════════ */

function RoomView({
  roomSlug,
  roomName,
  userId,
  userName,
  onLeave,
  mobilePanel,
  setMobilePanel,
}: {
  roomSlug: string;
  roomName: string;
  userId: string;
  userName: string;
  onLeave: () => void;
  mobilePanel: boolean;
  setMobilePanel: (v: boolean) => void;
}) {
  const engine = useSyncEngine({ roomId: roomSlug, userId, userName });
  const { theme, setTheme } = useTheme();
  const [urlInput, setUrlInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"chat" | "queue">("chat");
  const [mode, setMode] = useState<"video" | "vm">("video");

  const shareUrl = useMemo(
    () => (typeof window !== "undefined" ? `${window.location.origin}/#/room/${roomSlug}` : ""),
    [roomSlug],
  );

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      toast.success("Link copied — share it with friends");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const addUrl = () => {
    const u = urlInput.trim();
    if (!u) return;
    engine.queueAdd(u);
    setUrlInput("");
    toast.success("Added to queue");
  };

  const hasVideo = !!engine.playback?.videoUrl;
  const hasNext =
    engine.currentIndex >= 0 && engine.currentIndex + 1 < engine.queue.length;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* ── Top bar ── */}
      <header className="flex shrink-0 items-center gap-2 border-b bg-background/80 px-3 py-2 backdrop-blur sm:px-4">
        <Button variant="ghost" size="sm" onClick={onLeave} className="gap-1.5">
          <Play className="h-3.5 w-3.5 fill-current" />
          <span className="hidden sm:inline">WatchParty</span>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">
            {roomName || `room/${roomSlug}`}
          </h1>
          <p className="hidden text-[10px] text-muted-foreground sm:block">
            {roomSlug}
          </p>
        </div>

        <SyncIndicator
          connected={engine.stats.connected}
          rtt={engine.stats.rtt}
          drift={engine.stats.clockOffset}
        />

        <Button
          variant="outline"
          size="sm"
          onClick={copyLink}
          className="hidden gap-1.5 sm:flex"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          Invite
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>

        {/* Mobile panel toggle */}
        <Sheet open={mobilePanel} onOpenChange={setMobilePanel}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="lg:hidden">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-80 p-0 lg:hidden">
            <SidePanel
              tab={tab}
              setTab={setTab}
              engine={engine}
              userId={userId}
            />
          </SheetContent>
        </Sheet>
      </header>

      {/* ── Main ── */}
      <div className="flex min-h-0 flex-1">
        {/* Player area */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* URL bar + mode switcher */}
          <div className="flex shrink-0 items-center gap-2 border-b bg-card/30 px-3 py-2">
            {/* Mode switcher */}
            <div className="flex shrink-0 rounded-lg border bg-muted/50 p-0.5">
              <button
                onClick={() => setMode("video")}
                className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  mode === "video"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Play className="h-3 w-3" /> Video
              </button>
              <button
                onClick={() => setMode("vm")}
                className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  mode === "vm"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MonitorPlay className="h-3 w-3" /> VM Browser
              </button>
            </div>
            {mode === "video" && (
              <div className="flex flex-1 items-center gap-1.5">
                <Input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="Paste a video URL — YouTube, .m3u8, .mp4, or any site"
                  className="h-8 text-sm"
                  onKeyDown={(e) => e.key === "Enter" && addUrl()}
                />
                <Button size="sm" className="h-8 gap-1" onClick={addUrl}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
            )}
            {mode === "vm" && (
              <div className="flex flex-1 items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  Shared virtual browser — browse any site together in real-time
                </span>
                <Badge variant="secondary" className="ml-auto gap-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  live
                </Badge>
              </div>
            )}
          </div>

          {/* Stage: Video or Virtual Browser */}
          <div className="relative min-h-0 flex-1 bg-black">
            {mode === "video" ? (
              <>
                <div className="absolute inset-0">
                  <UniversalPlayer
                    playback={engine.playback}
                    clockOffset={engine.stats.clockOffset}
                    onIntent={engine.sendIntent}
                    onNext={() => engine.queueNext()}
                    hasNext={hasNext}
                  />
                </div>
                {/* Reaction rain overlay */}
                <ReactionRain reactions={engine.reactions} />
                {/* Reaction bar */}
                <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1 rounded-full border bg-background/80 p-1 shadow-lg backdrop-blur">
                  {REACTIONS.map((r) => (
                    <button
                      key={r.emoji}
                      onClick={() => engine.sendReaction(r.emoji)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform hover:scale-125 hover:bg-accent"
                      title={r.emoji}
                    >
                      {r.emoji}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <VirtualBrowser
                vmUrl="https://vm.kushalneedsmcp.online"
                password="watchparty"
                userName={userName}
              />
            )}
          </div>

          {/* Participants + status bar */}
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t bg-card/30 px-3 py-2">
            <ParticipantsList
              participants={engine.participants}
              youId={userId}
            />
            <div className="ml-auto flex items-center gap-2">
              {!hasVideo && (
                <span className="text-xs text-muted-foreground">
                  Paste a URL to start →
                </span>
              )}
            </div>
          </div>
        </main>

        {/* Desktop side panel */}
        <aside className="hidden w-80 shrink-0 border-l bg-card/30 lg:flex lg:flex-col">
          <SidePanel
            tab={tab}
            setTab={setTab}
            engine={engine}
            userId={userId}
          />
        </aside>
      </div>

      <Toaster />
    </div>
  );
}

/* ─────────────────────────── Side panel ─────────────────────────── */

function SidePanel({
  tab,
  setTab,
  engine,
  userId,
}: {
  tab: "chat" | "queue";
  setTab: (t: "chat" | "queue") => void;
  engine: ReturnType<typeof useSyncEngine>;
  userId: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "chat" | "queue")}
        className="flex h-full flex-col"
      >
        <TabsList className="m-2 grid grid-cols-2">
          <TabsTrigger value="chat" className="gap-1 text-xs">
            <MessageSquare className="h-3.5 w-3.5" /> Chat
          </TabsTrigger>
          <TabsTrigger value="queue" className="gap-1 text-xs">
            <ListVideo className="h-3.5 w-3.5" /> Queue
            {engine.queue.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px]">
                {engine.queue.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="mt-0 min-h-0 flex-1">
          <ChatPanel
            messages={engine.messages}
            onSend={engine.sendChat}
            youColor={engine.you?.color || "#a78bfa"}
          />
        </TabsContent>
        <TabsContent value="queue" className="mt-0 min-h-0 flex-1">
          <QueuePanel
            items={engine.queue}
            currentIndex={engine.currentIndex}
            onSelect={engine.queueSelect}
            onRemove={engine.queueRemove}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
