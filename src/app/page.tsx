"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSyncEngine } from "@/lib/sync/use-sync-engine";
import { UniversalPlayer } from "@/components/watchparty/universal-player";
import { VirtualBrowser } from "@/components/watchparty/virtual-browser";
import { ChatPanel } from "@/components/watchparty/chat-panel";
import { QueuePanel } from "@/components/watchparty/queue-panel";
import { CallsPanel } from "@/components/watchparty/calls-panel";
import { StreamPlayer } from "@/components/watchparty/stream-player";
import { SyncIndicator } from "@/components/watchparty/participants-list";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

import {
  Play,
  Users,
  Crown,
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
  Menu,
  Upload,
  Video,
  Radio,
  Download,
  ShieldCheck,
  AlertCircle,
  Loader2,
} from "lucide-react";

type Theme = "light" | "dark";
function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");
  useEffect(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    const initial = stored || "light";
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

function genId() {
  return "u-" + Math.random().toString(36).slice(2, 10);
}

export default function Home() {
  const [view, setView] = useState<"landing" | "room">("landing");
  const [roomSlug, setRoomSlug] = useState<string>("");
  const [roomName, setRoomName] = useState<string>("");
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [mobilePanel, setMobilePanel] = useState(false);

  useEffect(() => {
    setUserId(genId());
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("wp:userName");
    if (saved) setUserName(saved);
  }, []);

  useEffect(() => {
    if (userName) localStorage.setItem("wp:userName", userName);
  }, [userName]);

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
    } catch {
      const fallback = Math.random().toString(36).slice(2, 8);
      onEnter(fallback, `${name}'s party`);
    } finally {
      setCreating(false);
    }
  };

  const joinRoom = () => {
    if (!name.trim()) {
      toast.error("Enter your name first");
      return;
    }
    onName(name.trim());
    const clean = joinSlug
      .trim()
      .replace(/^https?:\/\/[^/]+\/#\/room\//, "")
      .replace(/^#\/room\//, "")
      .replace(/^room\//, "");
    if (!clean) {
      toast.error("Enter a valid room code or link");
      return;
    }
    onEnter(clean);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2 font-bold tracking-tight">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow">
            <Play className="h-4 w-4 fill-current translate-x-0.5" />
          </div>
          <span className="text-lg">WatchParty</span>
          <Badge variant="secondary" className="ml-2 text-xs">
            v2.0 Pro
          </Badge>
        </div>
        <div className="flex items-center gap-2">
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
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground mb-6">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>Sub-100ms NTP synchronization & multi-mode streaming</span>
        </div>

        <h1 className="max-w-3xl text-4xl font-extrabold tracking-tight sm:text-6xl">
          Watch together, in{" "}
          <span className="bg-gradient-to-r from-primary via-violet-500 to-fuchsia-500 bg-clip-text text-transparent">
            perfect synchronization
          </span>
          .
        </h1>
        <p className="mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
          Synchronized playback for YouTube, HLS streams, direct MP4s, local files, CineVo, and full interactive virtual desktop co-browsing.
        </p>

        <div className="mt-10 grid w-full max-w-2xl gap-4 sm:grid-cols-2 text-left">
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Play className="h-4 w-4 fill-current translate-x-0.5" />
              </div>
              <h2 className="text-sm font-semibold">Start a new room</h2>
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

        <div className="mt-16 grid w-full max-w-4xl gap-4 sm:grid-cols-3">
          {[
            {
              icon: Zap,
              title: "Sub-100ms Sync",
              desc: "Cristian's clock-sync algorithm keeps everyone on the exact same frame with PI slewing rate control.",
            },
            {
              icon: Film,
              title: "CineVo & Streaming Sync",
              desc: "Chrome MV3 extension directly coordinates playback on CineVo and third-party movie sites.",
            },
            {
              icon: MonitorPlay,
              title: "Virtual Desktop Co-Browsing",
              desc: "Collaborative browser streaming with normalized remote cursor overlays and floor control queues.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-xl border bg-card/50 p-4 text-left"
            >
              <f.icon className="mb-2 h-5 w-5 text-primary" />
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t px-4 py-4 text-center text-xs text-muted-foreground">
        Built with Next.js · Socket.IO · Cristian&apos;s algorithm · WebRTC · No account needed
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
  const [tab, setTab] = useState<"chat" | "queue" | "calls">("chat");
  const [mode, setMode] = useState<"video" | "vm" | "cinevo" | "stream">("video");

  // CineVo mode state
  const [cinevoUrl, setCinevoUrl] = useState("");
  const [extInstalled, setExtInstalled] = useState<boolean | null>(null);

  // Check WatchParty Chrome Extension presence
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window) return;
      if (e.data?.type === "WP_INSTALLED") setExtInstalled(true);
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ type: "WP_CHECK_INSTALLED" }, "*");
    const t = setTimeout(() => window.postMessage({ type: "WP_CHECK_INSTALLED" }, "*"), 1500);
    return () => {
      window.removeEventListener("message", onMsg);
      clearTimeout(t);
    };
  }, []);

  const syncUrl = useMemo(() => {
    if (typeof window === "undefined") return "http://localhost:3003";
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return "http://localhost:3003";
    if (host.startsWith("preview-") || host.includes(".space-z.ai")) {
      return `${window.location.origin}/?XTransformPort=3003`;
    }
    return `${window.location.protocol}//sync.${host}`;
  }, []);

  const openCinevo = () => {
    const url = cinevoUrl.trim();
    if (!url) {
      toast.error("Paste a cinevo.nl movie URL first");
      return;
    }
    if (!extInstalled) {
      toast.error("Install the WatchParty Chrome extension to sync CineVo");
      return;
    }
    window.postMessage(
      {
        type: "WP_START_SYNC",
        payload: {
          roomId: roomSlug,
          userId,
          userName,
          syncUrl,
          cinevoUrl: url,
          color: engine.you?.color || "#a78bfa",
        },
      },
      "*",
    );
    engine.sendSource(url);
    toast.success("Opening CineVo — the sync agent will activate automatically");
  };

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
    engine.sendIntent({ videoUrl: u });
    engine.queueAdd(u);
    setUrlInput("");
    toast.success("Video loaded");
  };

  const hasNext =
    engine.currentIndex >= 0 && engine.currentIndex + 1 < engine.queue.length;

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* ── Top Bar Header ── */}
      <header className="flex shrink-0 items-center gap-2 border-b bg-background/80 px-3 py-2 backdrop-blur sm:px-4">
        <Button variant="ghost" size="sm" onClick={onLeave} className="gap-1.5 font-bold">
          <Play className="h-3.5 w-3.5 fill-current text-primary" />
          <span className="hidden sm:inline">WatchParty</span>
        </Button>

        {/* Mode Switcher */}
        <div className="flex shrink-0 rounded-lg border bg-muted/50 p-1">
          <button
            onClick={() => setMode("video")}
            className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition-all ${
              mode === "video" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Play className="h-3 w-3" /> Video
          </button>
          <button
            onClick={() => setMode("vm")}
            className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition-all ${
              mode === "vm" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <MonitorPlay className="h-3 w-3" /> Virtual PC
          </button>
          <button
            onClick={() => setMode("cinevo")}
            className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition-all ${
              mode === "cinevo" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Film className="h-3 w-3" /> CineVo
          </button>
          <button
            onClick={() => setMode("stream")}
            className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition-all ${
              mode === "stream" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Radio className="h-3 w-3" /> P2P Stream
          </button>
        </div>

        {/* Compact URL bar in header */}
        {mode === "video" && (
          <>
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="YouTube, MP4, HLS, or stream URL…"
              className="h-7 max-w-xs flex-1 text-xs"
              onKeyDown={(e) => e.key === "Enter" && addUrl()}
            />
            <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={addUrl}>
              <Plus className="h-3 w-3" /> Add
            </Button>
            <label className="flex h-7 cursor-pointer items-center gap-1 rounded-md border bg-card/50 px-2 text-xs font-medium hover:bg-accent">
              <Upload className="h-3 w-3" />
              <span className="hidden sm:inline">File</span>
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    const url = URL.createObjectURL(f);
                    engine.loadLocalFile(url, f.name);
                    toast.success("Movie loaded — syncs play/pause/seek with everyone");
                  }
                }}
              />
            </label>
          </>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">
            {roomName || `room/${roomSlug}`}
          </h1>
        </div>

        {/* Participants dropdown */}
        <div className="group relative shrink-0">
          <button className="flex h-8 items-center gap-1.5 rounded-lg border bg-card/50 px-2.5 text-xs font-medium hover:bg-accent transition-colors">
            <Users className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{engine.participants.length}</span>
            <div className="flex -space-x-1">
              {engine.participants.slice(0, 3).map((p) => (
                <div
                  key={p.userId}
                  className="h-5 w-5 rounded-full border-2 border-background text-[9px] font-bold leading-5 text-white flex items-center justify-center"
                  style={{ backgroundColor: p.color }}
                >
                  {p.name.slice(0, 2).toUpperCase()}
                </div>
              ))}
            </div>
          </button>
          <div className="invisible absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border bg-popover p-2 opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100">
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {engine.participants.length} online
            </p>
            <div className="flex flex-col gap-1">
              {engine.participants.map((p) => (
                <div key={p.userId} className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent/50">
                  <div
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: p.color }}
                  >
                    {p.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="truncate text-xs font-medium">
                    {p.userId === userId ? `${p.name} (you)` : p.name}
                  </span>
                  {p.isHost && <Crown className="ml-auto h-3 w-3 text-amber-400" />}
                </div>
              ))}
            </div>
          </div>
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
              userName={userName}
            />
          </SheetContent>
        </Sheet>
      </header>

      {/* ── Main Stage Area ── */}
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 bg-black">
            {mode === "video" ? (
              <div className="absolute inset-0">
                <UniversalPlayer
                  playback={engine.playback}
                  clockOffset={engine.stats.clockOffset}
                  onIntent={engine.sendIntent}
                  onNext={() => engine.queueNext()}
                  hasNext={hasNext}
                  localFile={engine.localFile}
                  onLoadLocalFile={engine.loadLocalFile}
                  cmdPlay={engine.cmdPlay}
                  cmdPause={engine.cmdPause}
                  cmdSeek={engine.cmdSeek}
                  cmdTs={engine.cmdTs}
                  remoteCmd={engine.remoteCmd}
                  tsMap={engine.tsMap}
                  userId={userId}
                />
              </div>
            ) : mode === "vm" ? (
              <VirtualBrowser
                vmUrl={typeof window !== "undefined" ? (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "http://localhost:3004" : (() => { const p = window.location.hostname.split("."); if (p.length >= 3) { p[0] = "vm"; return `${window.location.protocol}//${p.join(".")}`; } return `${window.location.protocol}//vm.${window.location.hostname}`; })()) : "https://vm.kushalneedsmcp.online"}
                password="watchparty"
                userName={userName}
                userColor={engine.you?.color || "#a78bfa"}
                userId={userId}
                remoteCursors={engine.remoteCursors || []}
                controllerId={engine.vmController || null}
                controlQueue={engine.vmControlQueue || []}
                onCursorMove={engine.sendVmCursor}
                onRequestControl={engine.requestVmControl}
                onReleaseControl={engine.releaseVmControl}
              />
            ) : mode === "cinevo" ? (
              <CineVoPanel
                cinevoUrl={cinevoUrl}
                setCinevoUrl={setCinevoUrl}
                onOpen={openCinevo}
                extInstalled={extInstalled}
                roomSlug={roomSlug}
                shareUrl={shareUrl}
                connected={engine.stats.connected}
                drift={engine.stats.clockOffset}
                participants={engine.participants.length}
                sourceUrl={engine.source?.url}
              />
            ) : (
              <StreamPlayer
                playback={engine.playback}
                clockOffset={engine.stats.clockOffset}
                onIntent={engine.sendIntent}
                cmdPlay={engine.cmdPlay}
                cmdPause={engine.cmdPause}
                cmdSeek={engine.cmdSeek}
                cmdTs={engine.cmdTs}
                remoteCmd={engine.remoteCmd}
                tsMap={engine.tsMap}
                socket={engine.socket}
                userId={userId}
                participantIds={engine.participants.map((p) => p.userId)}
                isHost={!!engine.you?.isHost && !engine.streamHost}
                onStreamStart={(fileName) => {
                  toast.success(`Streaming "${fileName}" via WebRTC + WebTorrent P2P`);
                }}
                onSeedFile={(magnetURI, fileName) => {
                  engine.sendIntent({ videoUrl: magnetURI, videoType: "torrent", fileName });
                  toast.success(`Seeding "${fileName}" to room via WebTorrent`);
                }}
                streamingHostId={engine.streamHost?.userId || null}
                streamingFileName={engine.streamHost?.fileName || null}
              />
            )}
          </div>
        </main>

        {/* Desktop Side Panel */}
        <aside className="hidden w-80 shrink-0 border-l bg-card/30 lg:flex lg:flex-col">
          <SidePanel
            tab={tab}
            setTab={setTab}
            engine={engine}
            userId={userId}
            userName={userName}
          />
        </aside>
      </div>

      <Toaster />
    </div>
  );
}

/* ─────────────────────────── Side Panel ─────────────────────────── */

function SidePanel({
  tab,
  setTab,
  engine,
  userId,
  userName,
}: {
  tab: "chat" | "queue" | "calls";
  setTab: (t: "chat" | "queue" | "calls") => void;
  engine: ReturnType<typeof useSyncEngine>;
  userId: string;
  userName: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "chat" | "queue" | "calls")}
        className="flex h-full flex-col"
      >
        <TabsList className="m-2 grid grid-cols-3">
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
          <TabsTrigger value="calls" className="gap-1 text-xs">
            <Video className="h-3.5 w-3.5" /> Calls
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="mt-0 min-h-0 flex-1">
          <ChatPanel
            messages={engine.messages}
            onSend={engine.sendChat}
            youColor={engine.you?.color || "#a78bfa"}
            youId={userId}
            participantCount={engine.participants.length}
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
        <TabsContent value="calls" className="mt-0 min-h-0 flex-1">
          <CallsPanel
            participants={engine.participants}
            youId={userId}
            youName={userName}
            youColor={engine.you?.color || "#a78bfa"}
            vmController={engine.vmController}
            onUpdateMediaState={engine.sendMediaState}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ═══════════════════════ CINEVO PANEL ═══════════════════════ */

function CineVoPanel({
  cinevoUrl,
  setCinevoUrl,
  onOpen,
  extInstalled,
  roomSlug,
  shareUrl,
  connected,
  drift,
  participants,
  sourceUrl,
}: {
  cinevoUrl: string;
  setCinevoUrl: (v: string) => void;
  onOpen: () => void;
  extInstalled: boolean | null;
  roomSlug: string;
  shareUrl: string;
  connected: boolean;
  drift: number;
  participants: number;
  sourceUrl?: string;
}) {
  return (
    <div className="absolute inset-0 overflow-y-auto bg-gradient-to-br from-background via-background to-violet-950/30">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-500/30">
            <Film className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            CineVo Direct Sync
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Everyone opens the movie on CineVo in their own browser. The WatchParty extension synchronizes the playhead in real-time.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-center justify-center gap-3 text-xs">
          <Badge variant={connected ? "default" : "secondary"} className="gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
            {connected ? "Sync engine online" : "Connecting…"}
          </Badge>
          {connected && (
            <Badge variant="secondary" className="gap-1">
              <Zap className="h-3 w-3" /> {Math.abs(Math.round(drift))}ms drift
            </Badge>
          )}
          <Badge variant="secondary" className="gap-1">
            <Users className="h-3 w-3" /> {participants} watching
          </Badge>
        </div>

        <div className={`mb-6 rounded-xl border p-4 ${extInstalled ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
          <div className="flex items-start gap-3">
            {extInstalled ? (
              <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-500" />
            ) : extInstalled === null ? (
              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
            )}
            <div className="flex-1">
              <p className="text-sm font-semibold">
                {extInstalled ? "WatchParty Extension Active" : extInstalled === null ? "Detecting Extension…" : "Extension Required"}
              </p>
              {extInstalled ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The extension is installed and ready. When you open CineVo, the floating sync agent will automatically keep you in sync.
                </p>
              ) : (
                <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                  <p>To watch movies on CineVo together without server lag:</p>
                  <ol className="list-decimal list-inside space-y-1 text-zinc-300">
                    <li>Download the extension zip file</li>
                    <li>Open <code>chrome://extensions</code> in Chrome/Brave/Edge</li>
                    <li>Enable &ldquo;Developer mode&rdquo; and click &ldquo;Load unpacked&rdquo; (select the <code>extension</code> folder)</li>
                  </ol>
                  <a
                    href="/watchparty-extension.zip"
                    download
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground mt-2"
                  >
                    <Download className="h-3.5 w-3.5" /> Download Extension (.zip)
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm space-y-4">
          <div>
            <label className="text-xs font-semibold">CineVo Movie URL</label>
            <div className="mt-1.5 flex gap-2">
              <Input
                value={cinevoUrl}
                onChange={(e) => setCinevoUrl(e.target.value)}
                placeholder="https://cinevo.nl/movie/..."
                className="text-xs"
              />
              <Button onClick={onOpen} className="gap-1 text-xs">
                Open & Sync <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {sourceUrl && (
            <div className="rounded-lg bg-muted/40 p-3 text-xs">
              <p className="font-semibold text-muted-foreground">Currently Playing in Room:</p>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block truncate text-primary hover:underline font-mono"
              >
                {sourceUrl}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
