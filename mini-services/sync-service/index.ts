/**
 * WatchParty Unified Sync & Streaming Service
 * -------------------------------------------
 * Socket.IO microservice running on port 3003.
 *
 * Responsibilities:
 *  - Authoritative room state (presence, playback, queue, chat, reactions)
 *  - Cristian's-algorithm clock sync handshake (clock:req / clock:res) with NTP low-RTT filtering
 *  - Monotonic seq & server-authoritative playback state
 *  - Command-relay architecture (CMD:play / CMD:pause / CMD:seek / CMD:ts / REC:tsMap)
 *  - Jellyfin-style buffer-aware group wait (buffer:event)
 *  - WebRTC mesh signaling relay for live screen / video streaming (rtc:signal / stream:announce)
 *  - CineVo / third-party extension synchronization (source:set / agent:ad)
 *  - Virtual Browser floor control queue & normalized cursor forwarding (vm:cursor / vm:control)
 *  - Opt-in Video Calls & Media State synchronization (media:update)
 */

import { createServer } from "http";
import { Server, Socket } from "socket.io";

const PORT = 3003;
const HEARTBEAT_MS = 5000;
const ROOM_EXPIRY_MS = 6 * 60 * 60 * 1000; // 6h after last person leaves

// ─────────────────────────── Types ───────────────────────────

interface Participant {
  socketId: string;
  userId: string;
  name: string;
  color: string;
  isHost: boolean;
  joinedAt: number;
  clockOffset: number; // client time - server time (ms), maintained by clock sync
  rtt: number;
  isMicMuted?: boolean;
  isCameraOn?: boolean;
  cameraPrivacyMode?: "blackout" | "blur" | "avatar";
  isBuffering?: boolean;
}

interface PlaybackState {
  isPlaying: boolean;
  currentTime: number; // seconds, in the video timeline
  playbackRate: number;
  videoUrl: string;
  videoType: string; // "youtube" | "hls" | "mp4" | "webm" | "iframe" | "file" | "torrent"
  fileName: string; // for "file" mode: the shared filename (blob URLs are NEVER stored)
  lastChangedAt: number; // GLOBAL (server) timestamp ms
  lastChangedBy: string;
  seq: number;
}

interface RoomState {
  roomId: string;
  participants: Map<string, Participant>; // socketId -> Participant
  playback: PlaybackState;
  queue: { url: string; type: string; addedBy: string; addedAt: number }[];
  currentIndex: number;
  lastActivity: number;
  vmController: string | null; // userId of current VM controller
  vmControlQueue: string[]; // userIds waiting for control
  source: { url: string; setBy: string; setAt: number } | null; // Option C: the external URL (e.g. cinevo.nl) agents should open
  adState: Map<string, boolean>; // socketId -> inAd (agents report ad breaks so server doesn't drift-correct them)
  tsMap: Record<string, number>; // userId -> normalized timestamp
  lastTsMap: number; // when we last broadcast tsMap
  tsInterval?: ReturnType<typeof setInterval>; // 1s tsMap broadcast timer
  streamHost: { userId: string; fileName: string } | null; // who is streaming via WebRTC
}

// ─────────────────────────── State ───────────────────────────

const rooms = new Map<string, RoomState>();

const COLORS = [
  "#f87171", "#fb923c", "#fbbf24", "#a3e635", "#34d399",
  "#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#e879f9",
];
let colorIdx = 0;

function pickColor() {
  const c = COLORS[colorIdx % COLORS.length];
  colorIdx++;
  return c;
}

function ensureRoom(roomId: string): RoomState {
  let r = rooms.get(roomId);
  if (!r) {
    r = {
      roomId,
      participants: new Map(),
      playback: {
        isPlaying: false,
        currentTime: 0,
        playbackRate: 1,
        videoUrl: "",
        videoType: "",
        fileName: "",
        lastChangedAt: Date.now(),
        lastChangedBy: "",
        seq: 0,
      },
      queue: [],
      currentIndex: -1,
      lastActivity: Date.now(),
      vmController: null,
      vmControlQueue: [],
      source: null,
      adState: new Map(),
      tsMap: {},
      lastTsMap: Date.now(),
      streamHost: null,
    };
    rooms.set(roomId, r);

    // tsMap broadcast interval every 1 second
    if (!r.tsInterval) {
      r.tsInterval = setInterval(() => {
        const room = rooms.get(roomId);
        if (!room) return;
        const memberIds = Array.from(room.participants.values()).map((p) => p.userId);
        Object.keys(room.tsMap).forEach((key) => {
          if (!memberIds.includes(key)) delete room.tsMap[key];
        });
        if (room.playback.videoUrl || room.playback.videoType === "file") {
          room.lastTsMap = Date.now();
          io.to(roomId).emit("REC:tsMap", room.tsMap);
        }
      }, 1000);
    }
  }
  return r;
}

function publicParticipants(r: RoomState) {
  return Array.from(r.participants.values()).map((p) => ({
    userId: p.userId,
    name: p.name,
    color: p.color,
    isHost: p.isHost,
    joinedAt: p.joinedAt,
    isMicMuted: p.isMicMuted,
    isCameraOn: p.isCameraOn,
    cameraPrivacyMode: p.cameraPrivacyMode,
  }));
}

function publicPlayback(r: RoomState) {
  const p = r.playback;
  return {
    isPlaying: p.isPlaying,
    currentTime: p.currentTime,
    playbackRate: p.playbackRate,
    videoUrl: p.videoUrl,
    videoType: p.videoType,
    fileName: p.fileName || "",
    lastChangedAt: p.lastChangedAt,
    lastChangedBy: p.lastChangedBy,
    seq: p.seq,
  };
}

function broadcastPresence(ioServer: Server, r: RoomState) {
  ioServer.to(r.roomId).emit("presence:update", {
    participants: publicParticipants(r),
  });
}

function broadcastPlayback(ioServer: Server, r: RoomState) {
  ioServer.to(r.roomId).emit("state:sync", publicPlayback(r));
}

function broadcastQueue(ioServer: Server, r: RoomState) {
  ioServer.to(r.roomId).emit("queue:update", {
    items: r.queue,
    currentIndex: r.currentIndex,
  });
}

// ─────────────────────────── Video type detection ───────────────────────────

function detectVideoType(url: string): string {
  const u = (url || "").toLowerCase().trim();
  if (!u) return "";
  if (/youtube\.com\/watch|youtu\.be\//.test(u)) return "youtube";
  if (/\.m3u8(\?|$)/.test(u)) return "hls";
  if (/\.mp4(\?|$)/.test(u)) return "mp4";
  if (/\.webm(\?|$)/.test(u)) return "webm";
  if (/\.ogg(\?|$)/.test(u)) return "ogg";
  if (u.startsWith("magnet:") || u.startsWith("webtorrent:")) return "torrent";
  if (/dailymotion\.com/.test(u)) return "dailymotion";
  if (/vimeo\.com/.test(u)) return "vimeo";
  return "iframe";
}

// ─────────────────────────── Server ───────────────────────────

const httpServer = createServer();
const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
});

io.on("connection", (socket: Socket) => {
  let currentRoomId: string | null = null;
  let currentUserId: string | null = null;

  // ── Clock sync (Cristian's algorithm) ──
  socket.on("clock:req", (payload: { t1: number; t0?: number }) => {
    const t2 = Date.now();
    const t3 = Date.now();
    socket.emit("clock:res", { t0: payload.t0 ?? payload.t1, t1: payload.t1, t2, t3 });
  });

  // ── Join room ──
  socket.on(
    "room:join",
    (payload: { roomId: string; userId: string; name: string }) => {
      if (!payload?.roomId || !payload?.userId || !payload?.name) {
        socket.emit("error", { message: "Invalid join payload" });
        return;
      }
      if (currentRoomId) socket.leave(currentRoomId);

      const roomId = payload.roomId;
      const r = ensureRoom(roomId);
      const isFirst = r.participants.size === 0;

      const participant: Participant = {
        socketId: socket.id,
        userId: payload.userId,
        name: payload.name.slice(0, 32),
        color: pickColor(),
        isHost: isFirst,
        joinedAt: Date.now(),
        clockOffset: 0,
        rtt: 0,
      };
      r.participants.set(socket.id, participant);
      r.lastActivity = Date.now();

      currentRoomId = roomId;
      currentUserId = payload.userId;
      socket.join(roomId);

      // Send the new participant the current state.
      socket.emit("room:joined", {
        roomId,
        you: {
          userId: participant.userId,
          name: participant.name,
          color: participant.color,
          isHost: participant.isHost,
        },
        participants: publicParticipants(r),
        playback: publicPlayback(r),
        queue: { items: r.queue, currentIndex: r.currentIndex },
        source: r.source,
        tsMap: r.tsMap,
      });

      socket.emit("REC:tsMap", r.tsMap);

      if (r.streamHost) {
        socket.emit("stream:announce", {
          userId: r.streamHost.userId,
          streaming: true,
          fileName: r.streamHost.fileName,
        });
      }

      if (r.source) {
        socket.emit("source:set", r.source);
      }

      broadcastPresence(io, r);
      io.to(roomId).emit("chat:system", {
        text: `${participant.name} joined`,
        at: Date.now(),
      });
    },
  );

  // ── Playback intent (server-authoritative) ──
  socket.on(
    "state:intent",
    (payload: {
      isPlaying?: boolean;
      currentTime?: number;
      playbackRate?: number;
      videoUrl?: string;
      videoType?: string;
      fileName?: string;
      seq?: number;
    }) => {
      if (!currentRoomId) return;
      const r = rooms.get(currentRoomId);
      if (!r) return;
      const me = r.participants.get(socket.id);
      if (!me) return;

      if (payload.seq !== undefined && payload.seq < r.playback.seq) return;

      // Strip blob URLs aggressively
      if (payload.videoUrl && payload.videoUrl.startsWith("blob:")) {
        payload.videoUrl = "file://local";
        payload.videoType = "file";
      }

      const now = Date.now();
      const p = r.playback;

      let projectedTime = p.currentTime;
      if (p.isPlaying && (p.videoUrl || p.videoType === "file")) {
        projectedTime = p.currentTime + (now - p.lastChangedAt) / 1000;
      }

      let changed = false;
      const incomingUrl = payload.videoUrl;
      const incomingType = payload.videoType;
      const isFileMode = incomingType === "file" || incomingUrl === "file://local";

      if (isFileMode) {
        if (p.videoType !== "file" || (payload.fileName && payload.fileName !== p.fileName)) {
          p.videoType = "file";
          p.videoUrl = "";
          if (payload.fileName) p.fileName = payload.fileName;
          projectedTime = 0;
          p.isPlaying = false;
          changed = true;
        }
      } else if (incomingUrl !== undefined && incomingUrl !== p.videoUrl) {
        p.videoUrl = incomingUrl;
        p.videoType = incomingType || detectVideoType(incomingUrl);
        p.fileName = "";
        projectedTime = 0;
        p.isPlaying = false;
        changed = true;
      }

      if (payload.isPlaying !== undefined && payload.isPlaying !== p.isPlaying) {
        p.isPlaying = payload.isPlaying;
        changed = true;
      }
      if (payload.currentTime !== undefined) {
        projectedTime = payload.currentTime;
        changed = true;
      }
      if (
        payload.playbackRate !== undefined &&
        payload.playbackRate !== p.playbackRate
      ) {
        p.playbackRate = payload.playbackRate;
        changed = true;
      }

      if (changed) {
        p.currentTime = projectedTime;
        p.lastChangedAt = now;
        p.lastChangedBy = me.userId;
        p.seq++;
        r.lastActivity = now;
        socket.to(currentRoomId).emit("state:sync", publicPlayback(r));
      }
    },
  );

  // ── Command-relay events ──
  socket.on("CMD:play", () => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    r.playback.isPlaying = true;
    r.playback.lastChangedAt = Date.now();
    r.playback.lastChangedBy = me.userId;
    r.playback.seq++;
    socket.to(currentRoomId).emit("REC:play", { by: me.userId, ts: r.playback.currentTime });
  });

  socket.on("CMD:pause", () => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    r.playback.isPlaying = false;
    r.playback.lastChangedAt = Date.now();
    r.playback.lastChangedBy = me.userId;
    r.playback.seq++;
    socket.to(currentRoomId).emit("REC:pause", { by: me.userId, ts: r.playback.currentTime });
  });

  socket.on("CMD:seek", (data: { time: number; playing: boolean }) => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    const time = Number(data?.time);
    if (!isFinite(time) || time < 0) return;
    r.playback.currentTime = time;
    r.playback.isPlaying = !!data?.playing;
    r.playback.lastChangedAt = Date.now();
    r.playback.lastChangedBy = me.userId;
    r.playback.seq++;
    socket.to(currentRoomId).emit("REC:seek", { time, playing: !!data?.playing, by: me.userId });
  });

  // ── tsMap heartbeat ──
  socket.on("CMD:ts", (data: { ts: number }) => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    const ts = Number(data?.ts);
    if (!isFinite(ts) || ts < 0) return;
    const timeSinceTsMap = Date.now() - (r.lastTsMap || Date.now());
    r.tsMap = r.tsMap || {};
    r.tsMap[me.userId] = ts - timeSinceTsMap / 1000 + 1;
  });

  // ── Buffer-aware group-wait ──
  socket.on("buffer:event", (payload: { type: "waiting" | "playing"; position: number }) => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;

    me.isBuffering = payload.type === "waiting";

    if (payload.type === "waiting") {
      const p = r.playback;
      p.isPlaying = false;
      p.currentTime = payload.position;
      p.lastChangedAt = Date.now();
      p.lastChangedBy = me.userId;
      p.seq++;
      broadcastPlayback(io, r);
      io.to(currentRoomId).emit("chat:system", {
        text: `${me.name} is buffering…`,
        at: Date.now(),
      });
    } else {
      const allReady = Array.from(r.participants.values()).every((p) => !p.isBuffering);
      if (allReady && (r.playback.videoUrl || r.playback.videoType === "file")) {
        const p = r.playback;
        let highestRtt = 0;
        for (const participant of r.participants.values()) {
          highestRtt = Math.max(highestRtt, participant.rtt || 50);
        }
        p.isPlaying = true;
        p.lastChangedAt = Date.now() + Math.max(highestRtt * 2, 500);
        p.lastChangedBy = me.userId;
        p.seq++;
        broadcastPlayback(io, r);
        io.to(currentRoomId).emit("chat:system", {
          text: `Everyone ready — resuming`,
          at: Date.now(),
        });
      }
    }
  });

  // ── Heartbeat telemetry ──
  socket.on(
    "heartbeat",
    (payload: { currentTime?: number; isPlaying?: boolean; clientNow?: number; rtt?: number; clockOffset?: number }) => {
      if (!currentRoomId) return;
      const r = rooms.get(currentRoomId);
      if (!r) return;
      const me = r.participants.get(socket.id);
      if (!me) return;
      if (typeof payload?.rtt === "number" && isFinite(payload.rtt) && payload.rtt >= 0) {
        me.rtt = Math.min(payload.rtt, 2000);
      }
      if (typeof payload?.clockOffset === "number" && isFinite(payload.clockOffset)) {
        me.clockOffset = payload.clockOffset;
      }
    },
  );

  // ── Media update (Webcam/Mic Calls state) ──
  socket.on(
    "media:update",
    (payload: {
      isMicMuted?: boolean;
      isCameraOn?: boolean;
      cameraPrivacyMode?: "blackout" | "blur" | "avatar";
    }) => {
      if (!currentRoomId) return;
      const r = rooms.get(currentRoomId);
      if (!r) return;
      const me = r.participants.get(socket.id);
      if (!me) return;
      if (payload.isMicMuted !== undefined) me.isMicMuted = payload.isMicMuted;
      if (payload.isCameraOn !== undefined) me.isCameraOn = payload.isCameraOn;
      if (payload.cameraPrivacyMode !== undefined) me.cameraPrivacyMode = payload.cameraPrivacyMode;
      broadcastPresence(io, r);
    },
  );

  // ── Chat ──
  socket.on("chat:send", (payload: { text: string }) => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    const text = (payload?.text || "").toString().slice(0, 1000).trim();
    if (!text) return;
    io.to(currentRoomId).emit("chat:new", {
      id: Math.random().toString(36).slice(2),
      userId: me.userId,
      userName: me.name,
      color: me.color,
      text,
      at: Date.now(),
    });
  });

  // ── Reactions ──
  socket.on("reaction", (payload: { emoji: string }) => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    const emoji = (payload?.emoji || "🎉").slice(0, 8);
    io.to(currentRoomId).emit("reaction", {
      emoji,
      userId: me.userId,
      userName: me.name,
      color: me.color,
      at: Date.now(),
    });
  });

  // ── Queue management ──
  socket.on("queue:add", (payload: { url: string }) => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    const url = (payload?.url || "").trim();
    if (!url) return;
    const type = detectVideoType(url);
    r.queue.push({ url, type, addedBy: me.userId, addedAt: Date.now() });
    if (r.currentIndex < 0 || r.currentIndex >= r.queue.length) {
      r.currentIndex = r.queue.length - 1;
      r.playback.videoUrl = url;
      r.playback.videoType = type;
      r.playback.currentTime = 0;
      r.playback.isPlaying = true;
      r.playback.lastChangedAt = Date.now();
      r.playback.lastChangedBy = me.userId;
      r.playback.seq++;
      broadcastPlayback(io, r);
    }
    broadcastQueue(io, r);
  });

  socket.on("queue:next", () => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    if (r.currentIndex + 1 < r.queue.length) {
      r.currentIndex++;
      const item = r.queue[r.currentIndex];
      r.playback.videoUrl = item.url;
      r.playback.videoType = item.type;
      r.playback.currentTime = 0;
      r.playback.isPlaying = false;
      r.playback.lastChangedAt = Date.now();
      r.playback.lastChangedBy = me.userId;
      r.playback.seq++;
      broadcastPlayback(io, r);
      broadcastQueue(io, r);
    }
  });

  socket.on("queue:select", (payload: { index: number }) => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    const idx = payload?.index;
    if (typeof idx !== "number" || idx < 0 || idx >= r.queue.length) return;
    r.currentIndex = idx;
    const item = r.queue[idx];
    r.playback.videoUrl = item.url;
    r.playback.videoType = item.type;
    r.playback.currentTime = 0;
    r.playback.isPlaying = false;
    r.playback.lastChangedAt = Date.now();
    r.playback.lastChangedBy = me.userId;
    r.playback.seq++;
    broadcastPlayback(io, r);
    broadcastQueue(io, r);
  });

  socket.on("queue:remove", (payload: { index: number }) => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    const idx = payload?.index;
    if (typeof idx !== "number" || idx < 0 || idx >= r.queue.length) return;
    r.queue.splice(idx, 1);
    if (idx === r.currentIndex) {
      r.currentIndex = Math.min(r.currentIndex, r.queue.length - 1);
      if (r.currentIndex >= 0) {
        const item = r.queue[r.currentIndex];
        r.playback.videoUrl = item.url;
        r.playback.videoType = item.type;
        r.playback.currentTime = 0;
        r.playback.isPlaying = false;
        r.playback.lastChangedAt = Date.now();
        r.playback.lastChangedBy = me.userId;
        r.playback.seq++;
        broadcastPlayback(io, r);
      }
    } else if (idx < r.currentIndex) {
      r.currentIndex--;
    }
    broadcastQueue(io, r);
  });

  // ── Option C: source URL (cinevo.nl) ──
  socket.on("source:set", (payload: { url: string }) => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    const url = (payload?.url || "").toString().trim().slice(0, 2000);
    if (!url) {
      r.source = null;
    } else {
      r.source = { url, setBy: me.userId, setAt: Date.now() };
    }
    io.to(currentRoomId).emit("source:set", r.source);
  });

  // ── Option C: agent ad-state reporting ──
  socket.on("agent:ad", (payload: { inAd: boolean }) => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    r.adState.set(socket.id, !!payload.inAd);
    const me = r.participants.get(socket.id);
    if (me && payload.inAd) {
      io.to(currentRoomId).emit("chat:system", {
        text: `${me.name} is in an ad break…`,
        at: Date.now(),
      });
    }
  });

  // ── VM cursor + control events ──
  socket.on("vm:cursor", (payload: { x: number; y: number }) => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    socket.to(currentRoomId).emit("vm:cursor", {
      userId: me.userId,
      name: me.name,
      color: me.color,
      x: payload.x,
      y: payload.y,
    });
  });

  // ── WebRTC signaling relay ──
  socket.on("rtc:signal", (payload: { to: string; msg: any }) => {
    if (!currentRoomId) return;
    if (!payload?.to || !payload?.msg) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;

    let targetSocketId: string | null = null;
    for (const [sId, p] of r.participants.entries()) {
      if (p.userId === payload.to) {
        targetSocketId = sId;
        break;
      }
    }

    if (targetSocketId) {
      io.to(targetSocketId).emit("rtc:signal", {
        from: me.userId,
        to: payload.to,
        msg: payload.msg,
      });
    } else {
      socket.to(currentRoomId).emit("rtc:signal", {
        from: me.userId,
        to: payload.to,
        msg: payload.msg,
      });
    }
  });

  // ── Stream host announcement ──
  socket.on("stream:announce", (payload: { streaming: boolean; fileName?: string }) => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    if (payload.streaming) {
      r.streamHost = { userId: me.userId, fileName: payload.fileName || "" };
    } else {
      r.streamHost = null;
    }
    socket.to(currentRoomId).emit("stream:announce", {
      userId: me.userId,
      streaming: !!payload.streaming,
      fileName: payload.fileName || "",
    });
  });

  socket.on("vm:control:request", () => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    if (!r.vmController) {
      r.vmController = me.userId;
      r.vmControlQueue = r.vmControlQueue.filter((id) => id !== me.userId);
      io.to(currentRoomId).emit("vm:control:granted", { userId: me.userId });
      io.to(currentRoomId).emit("vm:control:state", {
        controllerId: r.vmController,
        queue: r.vmControlQueue,
      });
    } else if (!r.vmControlQueue.includes(me.userId)) {
      r.vmControlQueue.push(me.userId);
      io.to(currentRoomId).emit("vm:control:state", {
        controllerId: r.vmController,
        queue: r.vmControlQueue,
      });
    }
  });

  socket.on("vm:control:release", () => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    if (r.vmController === me.userId) {
      r.vmController = r.vmControlQueue.shift() || null;
      io.to(currentRoomId).emit("vm:control:granted", { userId: r.vmController });
      io.to(currentRoomId).emit("vm:control:state", {
        controllerId: r.vmController,
        queue: r.vmControlQueue,
      });
    }
  });

  // ── Disconnect ──
  socket.on("disconnect", () => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    r.participants.delete(socket.id);
    r.adState.delete(socket.id);
    if (me) {
      delete r.tsMap[me.userId];
      if (r.streamHost && r.streamHost.userId === me.userId) {
        r.streamHost = null;
        io.to(currentRoomId).emit("stream:announce", {
          userId: me.userId,
          streaming: false,
        });
      }
      io.to(currentRoomId).emit("chat:system", {
        text: `${me.name} left`,
        at: Date.now(),
      });
      if (me.isHost && r.participants.size > 0) {
        const next = Array.from(r.participants.values())[0];
        next.isHost = true;
      }
      broadcastPresence(io, r);

      // Prevent group buffer deadlock: if disconnected user was buffering, check if remaining members are ready
      if (r.participants.size > 0 && !r.playback.isPlaying) {
        const allReady = Array.from(r.participants.values()).every((p) => !p.isBuffering);
        if (allReady && (r.playback.videoUrl || r.playback.videoType === "file")) {
          const p = r.playback;
          let highestRtt = 0;
          for (const participant of r.participants.values()) {
            highestRtt = Math.max(highestRtt, participant.rtt || 50);
          }
          p.isPlaying = true;
          p.lastChangedAt = Date.now() + Math.max(highestRtt * 2, 500);
          p.lastChangedBy = "system";
          p.seq++;
          broadcastPlayback(io, r);
          io.to(currentRoomId).emit("chat:system", {
            text: `Buffering participant left — resuming playback`,
            at: Date.now(),
          });
        }
      }
    }
    if (r.participants.size === 0 && currentRoomId) {
      const roomToClean = currentRoomId;
      setTimeout(() => {
        const stillEmpty = rooms.get(roomToClean);
        if (
          stillEmpty &&
          stillEmpty.participants.size === 0 &&
          Date.now() - stillEmpty.lastActivity > ROOM_EXPIRY_MS
        ) {
          if (stillEmpty.tsInterval) clearInterval(stillEmpty.tsInterval);
          rooms.delete(roomToClean);
        }
      }, ROOM_EXPIRY_MS);
    }
  });
});

setInterval(() => {
  for (const r of rooms.values()) {
    if (r.participants.size > 0) {
      broadcastPlayback(io, r);
    }
  }
}, HEARTBEAT_MS);

httpServer.listen(PORT, () => {
  console.log(`🎬 WatchParty sync service on port ${PORT}`);
});
