"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSyncEngine } from "@/lib/sync/use-sync-engine";
import { detectVideoType } from "@/lib/sync/types";
import { UniversalPlayer } from "@/components/watchparty/universal-player";
import { VirtualBrowser } from "@/components/watchparty/virtual-browser";
import { ChatPanel } from "@/components/watchparty/chat-panel";
import { QueuePanel } from "@/components/watchparty/queue-panel";
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
  Crown,
  MessageSquare,
  ListVideo,
  Sun,
  Moon,
  Copy,
  Check,
  Plus,
  Sparkles,
  Globe,
  Zap,
  MonitorPlay,
  Link2,
  ArrowRight,
  Menu,
  Upload,
  ExternalLink,
  Pause,
  Video,
  VideoOff,
  Radio,
} from "lucide-react";

// ── Inline theme hook (avoids module resolution issues) ──
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

  // Generate userId after mount (avoids hydration mismatch).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUserId(genId());
  }, []);

  // Load persisted username after mount.
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
    <div className="flex min-h-screen flex-col bg-background text-foreground transition-colors duration-300">
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
            <Sparkles className="mr-1 h-3 w-3 text-violet-500" /> real-time sync v3.0
          </Badge>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4 text-slate-700" />
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center px-4 py-10 sm:py-16">
        <div className="mb-3 flex items-center gap-2 rounded-full border bg-card/50 px-3 py-1 text-xs text-muted-foreground shadow-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Cristian&apos;s NTP Clock Sync · 100ms Slewing Rate Controller
        </div>
        <h1 className="max-w-3xl text-center text-4xl font-bold tracking-tight sm:text-6xl">
          Watch anything,
          <br />
          <span className="bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent">
            together in sync.
          </span>
        </h1>
        <p className="mt-5 max-w-xl text-center text-base text-muted-foreground sm:text-lg">
          Paste a link — YouTube, HLS (.m3u8), MP4, or co-browse any website together in a shared Virtual Machine desktop shell.
        </p>

        {/* Create / Join card */}
        <div className="mt-10 grid w-full max-w-3xl gap-4 sm:grid-cols-2">
          <div className="rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md">
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
              className="w-full bg-violet-600 hover:bg-violet-700 text-white"
              onClick={createRoom}
              disabled={creating}
            >
              {creating ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Creating…
                </span>
              ) : (
                <span className="flex items-center gap-2 font-medium">
                  Create room <ArrowRight className="h-3.5 w-3.5" />
                </span>
              )}
            </Button>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md">
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
              title: "Cristian's NTP Sync",
              desc: "Proportional slewing rate controller keeps video frames aligned within 100ms without audio popping.",
            },
            {
              icon: Globe,
              title: "Universal Video Support",
              desc: "YouTube native player, HLS (.m3u8), direct MP4/WebM files, or local drag-and-drop video playback.",
            },
            {
              icon: MonitorPlay,
              title: "Shared Virtual PC (VM)",
              desc: "Interactive co-browsing desktop with normalized multi-user remote cursors and control pass-off queue.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-xl border bg-card/50 p-4 transition-all hover:bg-card"
            >
              <f.icon className="mb-2 h-5 w-5 text-violet-500" />
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t px-4 py-4 text-center text-xs text-muted-foreground">
        Built with Next.js · Socket.IO · Cristian&apos;s NTP Sync · Zero-camera opt-in privacy
      </footer>
      <Toaster />
    </div>
  );
}

/* ═══════════════════════ ROOM VIEW ═══════════════════════ */

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
  const [mode, setMode] = useState<"video" | "vm" | "external">("video");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [externalUrl, setExternalUrl] = useState("https://cinevo.nl");
  const [camEnabled, setCamEnabled] = useState(false);

  // Auto-calculate VM Endpoint URL (Local vs Cloudflare Tunnel vs Production)
  const vmUrl = useMemo(() => {
    if (typeof window === "undefined") return "http://localhost:3004";
    const host = window.location.hostname;
    const proto = window.location.protocol;
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:3004";
    } else if (host.startsWith("preview-") || host.includes(".space-z.ai")) {
      return "/?XTransformPort=3004";
    } else {
      const parts = host.split(".");
      if (parts.length >= 3) {
        parts[0] = "vm";
        return `${proto}//${parts.join(".")}`;
      }
      return `${proto}//vm.${host}`;
    }
  }, []);

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

  const openExternal = () => {
    const url = externalUrl.trim();
    if (!url) return;
    if (!url.match(/^https?:\/\//)) {
      toast.error("Enter a full URL (https://...)");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    toast.success("Opened in new tab");
  };

  const startCountdown = () => {
    setCountdown(3);
    let n = 3;
    const interval = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(interval);
        setCountdown(null);
        engine.sendChat("🎬 3-2-1 sync — PRESS PLAY NOW!");
        toast.success("PRESS PLAY on the video NOW!");
      } else {
        setCountdown(n);
      }
    }, 1000);
  };

  const syncPause = () => {
    engine.sendChat("⏸️ Pause — everyone pause!");
    toast.success("Sync signal sent — everyone pause!");
  };

  const hasNext =
    engine.currentIndex >= 0 && engine.currentIndex + 1 < engine.queue.length;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground transition-colors duration-300">
      {/* ── Top Header Navigation ── */}
      <header className="flex shrink-0 items-center gap-2 border-b bg-background/80 px-3 py-2 backdrop-blur sm:px-4">
        <Button variant="ghost" size="sm" onClick={onLeave} className="gap-1.5 font-bold">
          <Play className="h-4 w-4 fill-current text-violet-500" />
          <span className="hidden sm:inline">WatchParty</span>
        </Button>

        {/* Mode Switcher: Video vs Virtual PC vs External */}
        <div className="flex shrink-0 rounded-lg border bg-muted/50 p-1">
          <button
            onClick={() => setMode("video")}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-all ${
              mode === "video"
                ? "bg-background text-violet-500 shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Play className="h-3 w-3" /> Video Player
          </button>
          <button
            onClick={() => setMode("vm")}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-all ${
              mode === "vm"
                ? "bg-background text-cyan-500 shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Globe className="h-3 w-3" /> Virtual PC (VM)
          </button>
          <button
            onClick={() => setMode("external")}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-all ${
              mode === "external"
                ? "bg-background text-pink-500 shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ExternalLink className="h-3 w-3" /> Watch Together
          </button>
        </div>

        {/* Video Mode URL Quick-Add Bar */}
        {mode === "video" && (
          <>
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste YouTube, HLS (.m3u8), or MP4 URL…"
              className="h-7 max-w-xs flex-1 text-xs"
              onKeyDown={(e) => e.key === "Enter" && addUrl()}
            />
            <Button size="sm" className="h-7 gap-1 bg-violet-600 hover:bg-violet-700 text-white px-2.5 text-xs" onClick={addUrl}>
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
                    engine.queueAdd(url);
                    toast.success("Local video file added");
                  }
                }}
              />
            </label>
          </>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xs font-semibold text-muted-foreground">
            {roomName || `room/${roomSlug}`}
          </h1>
        </div>

        {/* Room Participants Hover Card */}
        <div className="group relative shrink-0">
          <button className="flex h-8 items-center gap-1.5 rounded-lg border bg-card/50 px-2.5 text-xs font-medium hover:bg-accent transition-colors">
            <Users className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{engine.participants.length}</span>
            <div className="flex -space-x-1">
              {engine.participants.slice(0, 3).map((p) => (
                <div
                  key={p.userId}
                  className="h-5 w-5 rounded-full border-2 border-background text-[9px] font-bold leading-5 text-white text-center"
                  style={{ backgroundColor: p.color }}
                >
                  {p.name.slice(0, 2).toUpperCase()}
                </div>
              ))}
            </div>
          </button>

          {/* Hover Dropdown Menu */}
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
          className="hidden gap-1.5 sm:flex text-xs h-8"
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
          className="h-8 w-8"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4 text-amber-400" />
          ) : (
            <Moon className="h-4 w-4 text-slate-700" />
          )}
        </Button>

        {/* Mobile Panel Toggle */}
        <Sheet open={mobilePanel} onOpenChange={setMobilePanel}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="h-8 w-8 lg:hidden">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-80 p-0 lg:hidden">
            <SidePanel
              tab={tab}
              setTab={setTab}
              engine={engine}
              userId={userId}
              camEnabled={camEnabled}
              setCamEnabled={setCamEnabled}
            />
          </SheetContent>
        </Sheet>
      </header>

      {/* ── Main Canvas Stage (Strict 16:9 Aspect Ratio Widescreen Protection) ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className="flex min-w-0 flex-1 flex-col items-center justify-center bg-zinc-950 p-2 sm:p-4">
          
          {/* 16:9 Widescreen Container: NEVER STRETCHED */}
          <div
            className="relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-black shadow-2xl"
            style={{
              aspectRatio: "16 / 9",
              maxHeight: "calc(100vh - 120px)",
              maxWidth: "min(100%, calc((100vh - 120px) * (16 / 9)))",
            }}
          >
            {mode === "video" && (
              <UniversalPlayer
                playback={engine.playback}
                clockOffset={engine.stats.clockOffset}
                onIntent={engine.sendIntent}
                onNext={() => engine.queueNext()}
                hasNext={hasNext}
              />
            )}

            {mode === "vm" && (
              <VirtualBrowser
                vmUrl={vmUrl}
                password=""
                userName={userName}
                userColor={engine.you?.color || "#a78bfa"}
                userId={userId}
                remoteCursors={engine.remoteCursors}
                controllerId={engine.vmController}
                controlQueue={engine.vmControlQueue}
                onCursorMove={engine.sendVmCursor}
                onRequestControl={engine.requestVmControl}
                onReleaseControl={engine.releaseVmControl}
              />
            )}

            {mode === "external" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-zinc-950 p-6">
                {countdown !== null && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur">
                    <span className="text-[120px] font-bold text-violet-400 animate-pulse">{countdown}</span>
                  </div>
                )}
                <div className="text-center">
                  <h2 className="text-xl font-bold text-white">Watch Together Sync</h2>
                  <p className="mt-1 text-xs text-zinc-400">
                    Open any movie site in an external browser tab, then trigger synchronization.
                  </p>
                </div>

                <div className="flex w-full max-w-md items-center gap-2">
                  <Input
                    value={externalUrl}
                    onChange={(e) => setExternalUrl(e.target.value)}
                    placeholder="https://cinevo.nl/watch/movie/..."
                    className="h-9 flex-1 bg-zinc-900 text-xs text-white"
                  />
                  <Button className="h-9 gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs" onClick={openExternal}>
                    <ExternalLink className="h-3.5 w-3.5" /> Open
                  </Button>
                </div>

                <div className="flex gap-3">
                  <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs" onClick={startCountdown}>
                    <Play className="h-4 w-4" /> 3-2-1 Sync Start
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs border-zinc-700 text-zinc-200" onClick={syncPause}>
                    <Pause className="h-4 w-4" /> Sync Pause
                  </Button>
                </div>
              </div>
            )}
          </div>

        </main>

        {/* Desktop Sidebar (WhatsApp Chat, Queue, Opt-in Calls) */}
        <aside className="hidden w-80 shrink-0 border-l bg-card/30 lg:flex lg:flex-col">
          <SidePanel
            tab={tab}
            setTab={setTab}
            engine={engine}
            userId={userId}
            camEnabled={camEnabled}
            setCamEnabled={setCamEnabled}
          />
        </aside>
      </div>

      <Toaster />
    </div>
  );
}

/* ─────────────────────────── Side Panel Component ─────────────────────────── */

function SidePanel({
  tab,
  setTab,
  engine,
  userId,
  camEnabled,
  setCamEnabled,
}: {
  tab: "chat" | "queue" | "calls";
  setTab: (t: "chat" | "queue" | "calls") => void;
  engine: ReturnType<typeof useSyncEngine>;
  userId: string;
  camEnabled: boolean;
  setCamEnabled: (v: boolean) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "chat" | "queue" | "calls")}
        className="flex h-full flex-col"
      >
        <TabsList className="m-2 grid grid-cols-3 bg-muted/60 p-1">
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

        <TabsContent value="calls" className="mt-0 min-h-0 flex-1 p-3">
          {!camEnabled ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-muted-foreground/30 p-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10 text-violet-500">
                <VideoOff className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Camera is Off</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your privacy comes first. Click below if you wish to enable your webcam and mic.
                </p>
              </div>
              <Button
                size="sm"
                className="mt-2 gap-2 bg-violet-600 hover:bg-violet-700 text-white"
                onClick={() => {
                  setCamEnabled(true);
                  toast.success("Webcam opt-in enabled");
                }}
              >
                <Video className="h-4 w-4" /> Enable Camera & Mic
              </Button>
            </div>
          ) : (
            <div className="flex h-full flex-col gap-3">
              <div className="relative aspect-video overflow-hidden rounded-lg border bg-black shadow-md">
                <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white">
                  <Radio className="h-3 w-3 text-emerald-400 animate-pulse" /> You (Host)
                </div>
                <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                  Webcam Active (Opt-In)
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-auto text-xs text-rose-500 border-rose-500/20 hover:bg-rose-500/10"
                onClick={() => setCamEnabled(false)}
              >
                Turn Off Camera
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
