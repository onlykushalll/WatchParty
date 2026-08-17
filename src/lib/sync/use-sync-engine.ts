"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  PlaybackState,
  Participant,
  QueueItem,
  ChatMessage,
  Reaction,
} from "./types";

interface Socket {
  on(event: string, fn: (arg: any) => void): Socket;
  emit(event: string, ...args: any[]): Socket;
  disconnect(): Socket;
  id?: string;
}

type IoFn = (url: string, opts: Record<string, unknown>) => Socket;

let ioPromise: Promise<IoFn> | null = null;
async function getIo(): Promise<IoFn> {
  if (typeof window === "undefined") {
    return (() => ({} as unknown as Socket)) as IoFn;
  }
  const w = window as any;
  if (w.io) return w.io as IoFn;
  if (!ioPromise) {
    ioPromise = fetch("https://cdn.socket.io/4.8.3/socket.io.min.js")
      .then((r) => r.text())
      .then((code) => {
        new Function(code)();
        if (!w.io) throw new Error("socket.io failed to initialize");
        return w.io as IoFn;
      });
  }
  return ioPromise;
}

export interface SyncStats {
  connected: boolean;
  clockOffset: number;
  rtt: number;
  lastDriftMs: number;
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
  remoteCursors: RemoteCursor[];
  vmController: string | null;
  vmControlQueue: string[];
  sendVmCursor: (x: number, y: number) => void;
  requestVmControl: () => void;
  releaseVmControl: () => void;
  sendMediaState: (state: Partial<{
    isMicMuted: boolean;
    isCameraOn: boolean;
    cameraPrivacyMode: "blackout" | "blur" | "avatar";
  }>) => void;
  source: { url: string; setBy: string; setAt: number } | null;
  sendSource: (url: string) => void;
  localFile: { url: string; name: string } | null;
  loadLocalFile: (url: string, name: string) => void;
  sendIntent: (patch: Partial<{
    isPlaying: boolean;
    currentTime: number;
    playbackRate: number;
    videoUrl: string;
    videoType: string;
    fileName?: string;
  }>) => void;
  cmdPlay: () => void;
  cmdPause: () => void;
  cmdSeek: (time: number, playing: boolean) => void;
  cmdTs: (ts: number) => void;
  remoteCmd: {
    play: { by: string; ts: number } | null;
    pause: { by: string; ts: number } | null;
    seek: { time: number; playing: boolean; by: string } | null;
  };
  tsMap: Record<string, number>;
  socket: any;
  streamHost: { userId: string; fileName: string } | null;
  sendChat: (text: string) => void;
  sendReaction: (emoji: string) => void;
  queueAdd: (url: string) => void;
  queueNext: () => void;
  queueSelect: (index: number) => void;
  queueRemove: (index: number) => void;
}

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
  const [source, setSource] = useState<{ url: string; setBy: string; setAt: number } | null>(null);
  const [localFile, setLocalFile] = useState<{ url: string; name: string } | null>(null);
  const [tsMap, setTsMap] = useState<Record<string, number>>({});
  const [remoteCmd, setRemoteCmd] = useState<{
    play: { by: string; ts: number } | null;
    pause: { by: string; ts: number } | null;
    seek: { time: number; playing: boolean; by: string } | null;
  }>({ play: null, pause: null, seek: null });
  const [streamHost, setStreamHost] = useState<{ userId: string; fileName: string } | null>(null);

  const clockSamplesRef = useRef<Array<{ t0: number; t1: number; serverTime: number }>>([]);

  const runClockSync = useCallback((sock: Socket) => {
    const t0 = performance.now();
    sock.emit("clock:req", { t1: Date.now(), t0 });
  }, []);

  useEffect(() => {
    if (!roomId || !userId || !userName) return;
    let cancelled = false;
    let sock: Socket | null = null;

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
        runClockSync(sock!);
      });

      sock.on("disconnect", () => {
        setStats((s) => ({ ...s, connected: false }));
      });

      sock.on("connect_error", () => {
        setStats((s) => ({ ...s, connected: false }));
      });

      sock.on("clock:res", (p: { t1: number; t2: number; t3: number }) => {
        const t4 = Date.now();
        const rtt = t4 - p.t1;
        clockSamplesRef.current.push({ t0: p.t1, t1: t4, serverTime: p.t3 });
        if (clockSamplesRef.current.length > 8) clockSamplesRef.current.shift();

        const sorted = clockSamplesRef.current.slice().sort(
          (a, b) => (a.t1 - a.t0) - (b.t1 - b.t0),
        );
        const best = sorted[0];
        if (best) {
          const bestRtt = best.t1 - best.t0;
          const bestOffset = best.serverTime + bestRtt / 2 - best.t1;
          setStats((s) => ({
            ...s,
            clockOffset: bestOffset,
            rtt: bestRtt,
            lastDriftMs: Math.abs(bestOffset),
          }));
        }
      });

      sock.on("room:joined", (p: {
        roomId: string;
        you: Participant;
        participants: Participant[];
        playback: PlaybackState;
        queue: { items: QueueItem[]; currentIndex: number };
        source?: { url: string; setBy: string; setAt: number } | null;
        tsMap?: Record<string, number>;
      }) => {
        setYou(p.you);
        setParticipants(p.participants);
        setPlayback(p.playback);
        setQueue(p.queue.items);
        setCurrentIndex(p.queue.currentIndex);
        if (p.source) setSource(p.source);
        if (p.tsMap) setTsMap(p.tsMap);
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

      sock.on("source:set", (s: { url: string; setBy: string; setAt: number } | null) => {
        setSource(s);
      });

      sock.on("REC:play", (p: { by: string; ts: number }) => {
        setRemoteCmd((prev) => ({ ...prev, play: p, pause: null }));
      });
      sock.on("REC:pause", (p: { by: string; ts: number }) => {
        setRemoteCmd((prev) => ({ ...prev, play: null, pause: p }));
      });
      sock.on("REC:seek", (p: { time: number; playing: boolean; by: string }) => {
        setRemoteCmd((prev) => ({ ...prev, seek: p }));
      });
      sock.on("REC:tsMap", (map: Record<string, number>) => {
        setTsMap(map);
      });

      sock.on("stream:announce", (p: { userId: string; streaming: boolean; fileName?: string }) => {
        if (p.streaming) {
          setStreamHost({ userId: p.userId, fileName: p.fileName || "" });
        } else {
          setStreamHost(null);
        }
      });
    }).catch((err) => {
      console.error("[sync] failed to load socket.io:", err.message);
    });

    const clockInterval = setInterval(() => {
      if (socketRef.current) runClockSync(socketRef.current);
    }, 5000);

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
      fileName?: string;
    }>) => {
      socketRef.current?.emit("state:intent", patch);
    },
    [],
  );

  const cmdPlay = useCallback(() => {
    socketRef.current?.emit("CMD:play", {});
  }, []);
  const cmdPause = useCallback(() => {
    socketRef.current?.emit("CMD:pause", {});
  }, []);
  const cmdSeek = useCallback((time: number, playing: boolean) => {
    socketRef.current?.emit("CMD:seek", { time, playing });
  }, []);
  const cmdTs = useCallback((ts: number) => {
    socketRef.current?.emit("CMD:ts", { ts });
  }, []);

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

  const sendMediaState = useCallback(
    (mediaPatch: Partial<{
      isMicMuted: boolean;
      isCameraOn: boolean;
      cameraPrivacyMode: "blackout" | "blur" | "avatar";
    }>) => {
      socketRef.current?.emit("media:update", mediaPatch);
    },
    [],
  );

  useEffect(() => {
    const onBuffer = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      socketRef.current?.emit("buffer:event", detail);
    };
    window.addEventListener("wp:buffer", onBuffer);
    return () => window.removeEventListener("wp:buffer", onBuffer);
  }, []);

  const requestVmControl = useCallback(() => {
    socketRef.current?.emit("vm:control:request", {});
  }, []);

  const releaseVmControl = useCallback(() => {
    socketRef.current?.emit("vm:control:release", {});
  }, []);

  const sendSource = useCallback((url: string) => {
    socketRef.current?.emit("source:set", { url });
  }, []);

  const loadLocalFile = useCallback((url: string, name: string) => {
    setLocalFile({ url, name });
    socketRef.current?.emit("state:intent", {
      videoUrl: "file://local",
      videoType: "file",
      fileName: name,
    });
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
    sendMediaState,
    source,
    sendSource,
    localFile,
    loadLocalFile,
    sendIntent,
    cmdPlay,
    cmdPause,
    cmdSeek,
    cmdTs,
    remoteCmd,
    tsMap,
    socket: socketRef.current,
    streamHost,
    sendChat,
    sendReaction,
    queueAdd,
    queueNext,
    queueSelect,
    queueRemove,
  };
}
