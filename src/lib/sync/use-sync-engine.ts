"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  PlaybackState,
  Participant,
  QueueItem,
  ChatMessage,
  Reaction,
} from "./types";

// Minimal Socket type (avoids importing socket.io-client at build time,
// which Turbopack can't resolve when the project is in the user's home dir).
interface Socket {
  on(event: string, fn: (...args: unknown[]) => void): Socket;
  on(event: string, fn: (arg: unknown) => void): Socket;
  emit(event: string, ...args: unknown[]): Socket;
  disconnect(): Socket;
  id?: string;
}

type IoFn = (url: string, opts: Record<string, unknown>) => Socket;

// Load socket.io-client from CDN at runtime (NOT via import, because
// Turbopack can't resolve the npm package from the home directory).
// We fetch the script text and eval it to avoid React 19's "script tag"
// detection that fires when document.createElement('script') is used.
let ioPromise: Promise<IoFn> | null = null;
async function getIo(): Promise<IoFn> {
  if (typeof window === "undefined") {
    return (() => ({})) as IoFn;
  }
  const w = window as any;
  if (w.io) return w.io as IoFn;
  if (!ioPromise) {
    ioPromise = fetch("https://cdn.socket.io/4.8.3/socket.io.min.js")
      .then((r) => r.text())
      .then((code) => {
        // Execute via new Function to avoid createElement('script')
        new Function(code)();
        if (!w.io) throw new Error("socket.io failed to initialize");
        return w.io as IoFn;
      });
  }
  return ioPromise;
}

export interface SyncStats {
  connected: boolean;
  clockOffset: number; // ms: serverNow ≈ clientNow + clockOffset
  rtt: number; // ms round-trip time
  lastDriftMs: number; // estimated drift at last sync
}

export interface UseSyncEngineArgs {
  roomId: string | null;
  userId: string;
  userName: string;
}

export interface RemoteCursor {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

export interface SyncEngine {
  stats: SyncStats;
  playback: PlaybackState | null;
  participants: Participant[];
  queue: QueueItem[];
  currentIndex: number;
  messages: ChatMessage[];
  reactions: Reaction[];
  you: Participant | null;
  // VM cursor + control
  remoteCursors: RemoteCursor[];
  vmController: string | null;
  vmControlQueue: string[];
  sendVmCursor: (x: number, y: number) => void;
  requestVmControl: () => void;
  releaseVmControl: () => void;
  // Actions
  sendIntent: (patch: Partial<{
    isPlaying: boolean;
    currentTime: number;
    playbackRate: number;
    videoUrl: string;
    videoType: string;
  }>) => void;
  sendChat: (text: string) => void;
  sendReaction: (emoji: string) => void;
  queueAdd: (url: string) => void;
  queueNext: () => void;
  queueSelect: (index: number) => void;
  queueRemove: (index: number) => void;
}

/**
 * useSyncEngine
 *
 * Connects to the WatchParty sync service (port 3003 via Caddy
 * XTransformPort), performs Cristian's-algorithm clock sync on connect +
 * every 30s, and exposes the authoritative room state plus action
 * senders.
 *
 * NOTE: this hook only carries state. The actual <video> element control
 * (the guard-flag echo-loop fix + 3-tier drift correction) lives in
 * useVideoController, which calls sendIntent / reads playback.
 */
export function useSyncEngine({
  roomId,
  userId,
  userName,
}: UseSyncEngineArgs): SyncEngine {
  const socketRef = useRef<Socket | null>(null);
  const [stats, setStats] = useState<SyncStats>({
    connected: false,
    clockOffset: 0,
    rtt: 0,
    lastDriftMs: 0,
  });
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [you, setYou] = useState<Participant | null>(null);
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [vmController, setVmController] = useState<string | null>(null);
  const [vmControlQueue, setVmControlQueue] = useState<string[]>([]);

  // ── Clock sync (Cristian's algorithm) ──
  const runClockSync = useCallback((sock: Socket) => {
    const t1 = Date.now();
    sock.emit("clock:req", { t1 });
  }, []);

  useEffect(() => {
    if (!roomId || !userId || !userName) return;
    let cancelled = false;
    let sock: Socket | null = null;

    // Determine the sync socket URL based on where we're running.
    // Auto-detects: if on a tunnel domain (e.g. wp.example.com), use
    // sync.example.com. If localhost, use localhost:3003.
    const host = typeof window !== "undefined" ? window.location.hostname : "";
    const proto = typeof window !== "undefined" ? window.location.protocol : "https:";
    let syncUrl: string;
    if (host === "localhost" || host === "127.0.0.1") {
      syncUrl = "http://localhost:3003";
    } else if (host.startsWith("preview-") || host.includes(".space-z.ai")) {
      // Sandbox preview — use Caddy XTransformPort pattern
      syncUrl = "/?XTransformPort=3003";
    } else {
      // Production tunnel — derive sync subdomain from host
      // e.g. wp.kushalneedsmcp.online → sync.kushalneedsmcp.online
      const parts = host.split(".");
      if (parts.length >= 3) {
        parts[0] = "sync";
        syncUrl = `${proto}//${parts.join(".")}`;
      } else {
        syncUrl = `${proto}//sync.${host}`;
      }
    }


    getIo().then((ioFn) => {
      if (cancelled) return;
      sock = ioFn(syncUrl, {
        path: "/",
        transports: ["websocket", "polling"],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });
      socketRef.current = sock;

      sock.on("connect", () => {
        setStats((s) => ({ ...s, connected: true }));
        sock!.emit("room:join", { roomId, userId, name: userName });
        runClockSync(sock!);
      });

      sock.on("disconnect", (reason: string) => {
        setStats((s) => ({ ...s, connected: false }));
      });

      sock.on("connect_error", (err: Error) => {
        setStats((s) => ({ ...s, connected: false }));
      });

      sock.on("clock:res", (p: { t1: number; t2: number; t3: number }) => {
        const t4 = Date.now();
        const rtt = t4 - p.t1;
        const serverNow = p.t3 + rtt / 2;
        const offset = serverNow - t4;
        setStats((s) => ({
          ...s,
          clockOffset: offset,
          rtt,
          lastDriftMs: Math.abs(offset),
        }));
      });

      sock.on("room:joined", (p: {
        roomId: string;
        you: Participant;
        participants: Participant[];
        playback: PlaybackState;
        queue: { items: QueueItem[]; currentIndex: number };
      }) => {
        setYou(p.you);
        setParticipants(p.participants);
        setPlayback(p.playback);
        setQueue(p.queue.items);
        setCurrentIndex(p.queue.currentIndex);
      });

      sock.on("presence:update", (p: { participants: Participant[] }) => {
        setParticipants(p.participants);
        setYou((prev) =>
          prev
            ? p.participants.find((x) => x.userId === prev.userId) ?? prev
            : prev,
        );
      });

      sock.on("state:sync", (p: PlaybackState) => {
        setPlayback(p);
      });

      sock.on("queue:update", (p: { items: QueueItem[]; currentIndex: number }) => {
        setQueue(p.items);
        setCurrentIndex(p.currentIndex);
      });

      sock.on("chat:new", (m: ChatMessage) => {
        setMessages((prev) => [...prev.slice(-199), m]);
      });

      sock.on("chat:system", (m: { text: string; at: number }) => {
        setMessages((prev) => [
          ...prev.slice(-199),
          {
            id: `sys-${m.at}-${Math.random().toString(36).slice(2, 6)}`,
            userId: "system",
            userName: "System",
            color: "#94a3b8",
            text: m.text,
            at: m.at,
          },
        ]);
      });

      sock.on("reaction", (r: Reaction) => {
        setReactions((prev) => [...prev.slice(-30), r]);
        setTimeout(() => {
          setReactions((prev) => prev.filter((x) => x !== r));
        }, 4000);
      });

      // ── VM cursor + control ──
      sock.on("vm:cursor", (c: RemoteCursor) => {
        setRemoteCursors((prev) => {
          const filtered = prev.filter((p) => p.userId !== c.userId);
          return [...filtered, c];
        });
        // Expire cursor after 5s of no movement
        setTimeout(() => {
          setRemoteCursors((prev) => prev.filter((p) => p !== c));
        }, 5000);
      });

      sock.on("vm:control:state", (s: { controllerId: string | null; queue: string[] }) => {
        setVmController(s.controllerId);
        setVmControlQueue(s.queue);
      });

      sock.on("vm:control:granted", (s: { userId: string | null }) => {
        setVmController(s.userId);
      });
    }).catch((err) => {
      console.error("[sync] failed to load socket.io:", err.message);
    });

    const clockInterval = setInterval(() => {
      if (socketRef.current) runClockSync(socketRef.current);
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(clockInterval);
      if (sock) {
        sock.disconnect();
        socketRef.current = null;
      }
    };
  }, [roomId, userId, userName, runClockSync]);

  const sendIntent = useCallback(
    (patch: Partial<{
      isPlaying: boolean;
      currentTime: number;
      playbackRate: number;
      videoUrl: string;
      videoType: string;
    }>) => {
      socketRef.current?.emit("state:intent", patch);
    },
    [],
  );

  const sendChat = useCallback((text: string) => {
    socketRef.current?.emit("chat:send", { text });
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    socketRef.current?.emit("reaction", { emoji });
  }, []);

  const queueAdd = useCallback((url: string) => {
    socketRef.current?.emit("queue:add", { url });
  }, []);

  const queueNext = useCallback(() => {
    socketRef.current?.emit("queue:next", {});
  }, []);

  const queueSelect = useCallback((index: number) => {
    socketRef.current?.emit("queue:select", { index });
  }, []);

  const queueRemove = useCallback((index: number) => {
    socketRef.current?.emit("queue:remove", { index });
  }, []);

  const sendVmCursor = useCallback((x: number, y: number) => {
    socketRef.current?.emit("vm:cursor", { x, y });
  }, []);

  const requestVmControl = useCallback(() => {
    socketRef.current?.emit("vm:control:request", {});
  }, []);

  const releaseVmControl = useCallback(() => {
    socketRef.current?.emit("vm:control:release", {});
  }, []);

  return {
    stats,
    playback,
    participants,
    queue,
    currentIndex,
    messages,
    reactions,
    you,
    remoteCursors,
    vmController,
    vmControlQueue,
    sendVmCursor,
    requestVmControl,
    releaseVmControl,
    sendIntent,
    sendChat,
    sendReaction,
    queueAdd,
    queueNext,
    queueSelect,
    queueRemove,
  };
}
