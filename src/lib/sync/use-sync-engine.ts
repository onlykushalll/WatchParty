"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  PlaybackState,
  Participant,
  QueueItem,
  ChatMessage,
  Reaction,
} from "./types";

import { ClockSyncEstimator } from "./clock-sync";

// Minimal Socket type (avoids importing socket.io-client at build time,
// which Turbopack can't resolve when the project is in the user's home dir).
interface Socket {
  on(event: string, fn: (...args: any[]) => void): Socket;
  on(event: string, fn: (arg: any) => void): Socket;
  emit(event: string, ...args: any[]): Socket;
  disconnect(): Socket;
  id?: string;
  connected?: boolean;
}

type IoFn = (url: string, opts: Record<string, unknown>) => Socket;

// Load socket.io-client from CDN at runtime (NOT via import, because
// Turbopack can't resolve the npm package from the home directory).
// We fetch the script text and eval it to avoid React 19's "script tag"
// detection that fires when document.createElement('script') is used.
let ioPromise: Promise<IoFn> | null = null;
async function getIo(): Promise<IoFn> {
  if (typeof window === "undefined") {
    return (() => ({})) as unknown as IoFn;
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
 * every 10s (with 8 initial probes on connect), and exposes the authoritative room state plus action
 * senders.
 */
export function useSyncEngine({
  roomId,
  userId,
  userName,
}: UseSyncEngineArgs): SyncEngine {
  const socketRef = useRef<Socket | null>(null);
  const estimatorRef = useRef(new ClockSyncEstimator());
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
  const runClockProbe = useCallback((sock: Socket) => {
    sock.emit("clock:req", { t0: Date.now() });
  }, []);

  const runInitialProbeBurst = useCallback((sock: Socket) => {
    estimatorRef.current.reset();
    let count = 0;
    const burst = () => {
      if (count < 8 && sock.connected !== false) {
        sock.emit("clock:req", { t0: Date.now() });
        count++;
        setTimeout(burst, 50);
      }
    };
    burst();
  }, []);

  useEffect(() => {
    if (!roomId || !userId || !userName) return;
    let cancelled = false;
    let sock: Socket | null = null;

    // Determine the sync socket URL based on where we're running.
    const host = typeof window !== "undefined" ? window.location.hostname : "";
    const proto = typeof window !== "undefined" ? window.location.protocol : "https:";
    let syncUrl: string;
    if (host === "localhost" || host === "127.0.0.1") {
      syncUrl = "http://localhost:3003";
    } else if (host.startsWith("preview-") || host.includes(".space-z.ai")) {
      syncUrl = "/?XTransformPort=3003";
    } else {
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
        runInitialProbeBurst(sock!);
      });

      sock.on("disconnect", () => {
        setStats((s) => ({ ...s, connected: false }));
      });

      sock.on("connect_error", () => {
        setStats((s) => ({ ...s, connected: false }));
      });

      sock.on("clock:res", (p: { t0?: number; t1: number; t2: number; t3?: number }) => {
        const t3 = Date.now();
        const t0 = p.t0 ?? p.t1;
        const t1 = p.t1;
        const t2 = p.t2 ?? p.t1;
        const res = estimatorRef.current.processProbe(t0, t1, t2, t3);
        setStats((s) => ({
          ...s,
          clockOffset: res.offset,
          rtt: res.rtt,
          lastDriftMs: Math.abs(res.offset),
        }));
      });

      sock.on("ntp_pong", (p: { t0?: number; t1: number; t2: number; t3?: number }) => {
        const t3 = Date.now();
        const t0 = p.t0 ?? p.t1;
        const t1 = p.t1;
        const t2 = p.t2 ?? p.t1;
        const res = estimatorRef.current.processProbe(t0, t1, t2, t3);
        setStats((s) => ({
          ...s,
          clockOffset: res.offset,
          rtt: res.rtt,
          lastDriftMs: Math.abs(res.offset),
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
      if (socketRef.current) runClockProbe(socketRef.current);
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(clockInterval);
      if (sock) {
        sock.disconnect();
        socketRef.current = null;
      }
    };
  }, [roomId, userId, userName, runClockProbe, runInitialProbeBurst]);

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
