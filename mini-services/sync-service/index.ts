/**
 * WatchParty Sync Service
 * ------------------------
 * Socket.IO mini-service running on port 3003.
 *
 * Responsibilities:
 *  - Room state (presence, playback, queue, chat relay)
 *  - Cristian's-algorithm clock sync handshake (clock:req / clock:res)
 *  - Server-authoritative playback state with monotonic seq + global
 *    lastChangedAt, so out-of-order packets are discarded and lag is
 *    compensated on the client.
 *  - Periodic heartbeat so new joiners and drifters re-sync.
 *
 * Frontend connects with: io("/?XTransformPort=3003")
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
}

interface PlaybackState {
  isPlaying: boolean;
  currentTime: number; // seconds, in the video timeline
  playbackRate: number;
  videoUrl: string;
  videoType: string; // "youtube" | "hls" | "mp4" | "webm" | "iframe"
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
        lastChangedAt: Date.now(),
        lastChangedBy: "",
        seq: 0,
      },
      queue: [],
      currentIndex: -1,
      lastActivity: Date.now(),
      vmController: null,
      vmControlQueue: [],
    };
    rooms.set(roomId, r);
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
    lastChangedAt: p.lastChangedAt,
    lastChangedBy: p.lastChangedBy,
    seq: p.seq,
  };
}

function broadcastPresence(io: Server, r: RoomState) {
  io.to(r.roomId).emit("presence:update", {
    participants: publicParticipants(r),
  });
}

function broadcastPlayback(io: Server, r: RoomState) {
  io.to(r.roomId).emit("state:sync", publicPlayback(r));
}

function broadcastQueue(io: Server, r: RoomState) {
  io.to(r.roomId).emit("queue:update", {
    items: r.queue,
    currentIndex: r.currentIndex,
  });
}

// ─────────────────────────── Video type detection ───────────────────────────

function detectVideoType(url: string): string {
  const u = url.toLowerCase().trim();
  if (!u) return "";
  if (/youtube\.com\/watch|youtu\.be\//.test(u)) return "youtube";
  if (/\.m3u8(\?|$)/.test(u)) return "hls";
  if (/\.mp4(\?|$)/.test(u)) return "mp4";
  if (/\.webm(\?|$)/.test(u)) return "webm";
  if (/\.ogg(\?|$)/.test(u)) return "ogg";
  if (/dailymotion\.com/.test(u)) return "dailymotion";
  if (/vimeo\.com/.test(u)) return "vimeo";
  return "iframe"; // fallback: try to load in an iframe via proxy
}

// ─────────────────────────── Server ───────────────────────────

const httpServer = createServer();
const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
  // Connection state recovery — restores client state after brief
  // disconnections (WiFi blip, tab sleep, etc.) without re-joining.
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
});

io.on("connection", (socket: Socket) => {
  let currentRoomId: string | null = null;
  let currentUserId: string | null = null;

  // ── Clock sync (Cristian's algorithm) ──
  socket.on("clock:req", (payload: { t0?: number; t1?: number }) => {
    const t0 = payload?.t0 ?? payload?.t1 ?? Date.now();
    const t1 = Date.now();
    const t2 = Date.now();
    socket.emit("clock:res", { t0, t1, t2 });
  });

  socket.on("ntp_ping", (payload: { clientTime?: number; t0?: number }) => {
    const t0 = payload?.t0 ?? payload?.clientTime ?? Date.now();
    const t1 = Date.now();
    const t2 = Date.now();
    socket.emit("ntp_pong", { t0, t1, t2, clientTime: t0, serverTime: t2 });
  });

  // ── Join room ──
  socket.on(
    "room:join",
    (payload: { roomId: string; userId: string; name: string }) => {
      if (!payload?.roomId || !payload?.userId || !payload?.name) {
        socket.emit("error", { message: "Invalid join payload" });
        return;
      }
      // Leave any previous room.
      if (currentRoomId) socket.leave(currentRoomId);

      const roomId = payload.roomId;
      const r = ensureRoom(roomId);
      const isFirst = r.participants.size === 0;

      const participant: Participant = {
        socketId: socket.id,
        userId: payload.userId,
        name: payload.name.slice(0, 32),
        color: pickColor(),
        isHost: isFirst, // first joiner becomes host
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
      });

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
      seq?: number;
    }) => {
      if (!currentRoomId) return;
      const r = rooms.get(currentRoomId);
      if (!r) return;
      const me = r.participants.get(socket.id);
      if (!me) return;

      // Out-of-order guard: ignore stale seqs.
      if (payload.seq !== undefined && payload.seq < r.playback.seq) return;

      // (Optional) host-lock could go here. For now anyone may control.

      const now = Date.now();
      const p = r.playback;

      // Project currentTime forward to "now" if we were playing, so the
      // incoming intent is interpreted at the right moment.
      let projectedTime = p.currentTime;
      if (p.isPlaying && p.videoUrl) {
        projectedTime = p.currentTime + (now - p.lastChangedAt) / 1000;
      }

      let changed = false;
      if (payload.videoUrl !== undefined && payload.videoUrl !== p.videoUrl) {
        p.videoUrl = payload.videoUrl;
        p.videoType =
          payload.videoType || detectVideoType(payload.videoUrl);
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
        broadcastPlayback(io, r);
      }
    },
  );

  // ── Heartbeat: each client reports its local currentTime periodically ──
  socket.on(
    "heartbeat",
    (payload: { currentTime: number; isPlaying: boolean; clientNow: number }) => {
      if (!currentRoomId) return;
      const r = rooms.get(currentRoomId);
      if (!r) return;
      const me = r.participants.get(socket.id);
      if (!me) return;
      // Track rough RTT via clock sync; just store the reported position.
      // The server doesn't force-correct here — clients self-correct using
      // the authoritative state broadcast. This heartbeat is mostly for
      // presence/latency telemetry.
      me.rtt = Math.abs(payload.clientNow - Date.now());
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

  // ── Reactions (emoji rain) ──
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
    // If nothing is playing, auto-advance and auto-play.
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

  // ── VM cursor + control events ──
  socket.on("vm:cursor", (payload: { x: number; y: number }) => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    // Broadcast cursor position to everyone EXCEPT sender
    socket.to(currentRoomId).emit("vm:cursor", {
      userId: me.userId,
      name: me.name,
      color: me.color,
      x: payload.x,
      y: payload.y,
    });
  });

  socket.on("vm:control:request", () => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    if (!r.vmController) {
      // Grant immediately if no one has control
      r.vmController = me.userId;
      r.vmControlQueue = r.vmControlQueue.filter((id) => id !== me.userId);
      io.to(currentRoomId).emit("vm:control:granted", { userId: me.userId });
      io.to(currentRoomId).emit("vm:control:state", {
        controllerId: r.vmController,
        queue: r.vmControlQueue,
      });
    } else if (!r.vmControlQueue.includes(me.userId)) {
      // Add to queue
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
      // Grant to next in queue
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
    if (me) {
      io.to(currentRoomId).emit("chat:system", {
        text: `${me.name} left`,
        at: Date.now(),
      });
      // If host left, promote the next person.
      if (me.isHost && r.participants.size > 0) {
        const next = Array.from(r.participants.values())[0];
        next.isHost = true;
      }
      broadcastPresence(io, r);
    }
    // Schedule cleanup if empty.
    if (r.participants.size === 0 && currentRoomId) {
      const targetRoomId = currentRoomId;
      setTimeout(() => {
        const stillEmpty = rooms.get(targetRoomId);
        if (
          stillEmpty &&
          stillEmpty.participants.size === 0 &&
          Date.now() - stillEmpty.lastActivity > ROOM_EXPIRY_MS
        ) {
          rooms.delete(targetRoomId);
        }
      }, ROOM_EXPIRY_MS);
    }
  });
});

// Heartbeat: broadcast current authoritative state every HEARTBEAT_MS so
// late joiners / drifted clients re-sync automatically.
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
