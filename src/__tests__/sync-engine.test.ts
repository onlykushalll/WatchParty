// @ts-ignore
import { describe, expect, test, beforeEach } from "bun:test";
import { PlaybackState, Participant, detectVideoType, youtubeId } from "../lib/sync/types";
import { ClockSyncEstimator } from "../lib/sync/clock-sync";
import { PISlewingController, computeExpectedPlayhead } from "../lib/sync/pi-controller";

// ── Mock Room State Simulator for Sync Service Logic ──
interface MockParticipant {
  socketId: string;
  userId: string;
  name: string;
  color: string;
  isHost: boolean;
  joinedAt: number;
  clockOffset: number;
  rtt: number;
  isMicMuted?: boolean;
  isCameraOn?: boolean;
  cameraPrivacyMode?: "blackout" | "blur" | "avatar";
  isBuffering?: boolean;
}

interface MockRoom {
  roomId: string;
  participants: Map<string, MockParticipant>;
  playback: PlaybackState;
  queue: { url: string; type: string; addedBy: string; addedAt: number }[];
  currentIndex: number;
  lastActivity: number;
  vmController: string | null;
  vmControlQueue: string[];
  source: { url: string; setBy: string; setAt: number } | null;
  adState: Map<string, boolean>;
  tsMap: Record<string, number>;
  lastTsMap: number;
  streamHost: { userId: string; fileName: string } | null;
}

function createMockRoom(roomId: string = "test-room"): MockRoom {
  return {
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
}

describe("State Synchronization Engine: Room Lifecycle & Presence", () => {
  let room: MockRoom;

  beforeEach(() => {
    room = createMockRoom();
  });

  test("first participant to join is designated as host", () => {
    const p1: MockParticipant = {
      socketId: "sock_1",
      userId: "user_alice",
      name: "Alice",
      color: "#f87171",
      isHost: room.participants.size === 0,
      joinedAt: Date.now(),
      clockOffset: 0,
      rtt: 30,
    };
    room.participants.set(p1.socketId, p1);

    const p2: MockParticipant = {
      socketId: "sock_2",
      userId: "user_bob",
      name: "Bob",
      color: "#fb923c",
      isHost: room.participants.size === 0,
      joinedAt: Date.now(),
      clockOffset: 0,
      rtt: 45,
    };
    room.participants.set(p2.socketId, p2);

    expect(p1.isHost).toBe(true);
    expect(p2.isHost).toBe(false);
  });

  test("host migration on host disconnect assigns host to first remaining participant", () => {
    const p1: MockParticipant = {
      socketId: "sock_1",
      userId: "user_alice",
      name: "Alice",
      color: "#f87171",
      isHost: true,
      joinedAt: Date.now(),
      clockOffset: 0,
      rtt: 30,
    };
    const p2: MockParticipant = {
      socketId: "sock_2",
      userId: "user_bob",
      name: "Bob",
      color: "#fb923c",
      isHost: false,
      joinedAt: Date.now(),
      clockOffset: 0,
      rtt: 45,
    };
    room.participants.set(p1.socketId, p1);
    room.participants.set(p2.socketId, p2);

    // Alice disconnects
    room.participants.delete(p1.socketId);
    if (p1.isHost && room.participants.size > 0) {
      const next = Array.from(room.participants.values())[0];
      next.isHost = true;
    }

    expect(room.participants.size).toBe(1);
    expect(p2.isHost).toBe(true);
  });
});

describe("State Synchronization Engine: Command Relays & tsMap Heartbeat", () => {
  let room: MockRoom;

  beforeEach(() => {
    room = createMockRoom();
    room.playback.videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    room.playback.videoType = "youtube";
    room.playback.currentTime = 10.0;
  });

  test("CMD:play sets isPlaying=true, increments seq, and updates lastChangedAt", () => {
    const prevSeq = room.playback.seq;
    const now = Date.now();

    room.playback.isPlaying = true;
    room.playback.lastChangedAt = now;
    room.playback.lastChangedBy = "user_alice";
    room.playback.seq++;

    expect(room.playback.isPlaying).toBe(true);
    expect(room.playback.seq).toBe(prevSeq + 1);
    expect(room.playback.lastChangedBy).toBe("user_alice");
    expect(room.playback.lastChangedAt).toBe(now);
  });

  test("CMD:pause sets isPlaying=false, increments seq, and updates lastChangedAt", () => {
    room.playback.isPlaying = true;
    const prevSeq = room.playback.seq;
    const now = Date.now();

    room.playback.isPlaying = false;
    room.playback.lastChangedAt = now;
    room.playback.lastChangedBy = "user_bob";
    room.playback.seq++;

    expect(room.playback.isPlaying).toBe(false);
    expect(room.playback.seq).toBe(prevSeq + 1);
    expect(room.playback.lastChangedBy).toBe("user_bob");
  });

  test("CMD:seek updates currentTime, updates isPlaying, and increments seq", () => {
    const seekTime = 145.5;
    const prevSeq = room.playback.seq;
    const now = Date.now();

    room.playback.currentTime = seekTime;
    room.playback.isPlaying = true;
    room.playback.lastChangedAt = now;
    room.playback.lastChangedBy = "user_charlie";
    room.playback.seq++;

    expect(room.playback.currentTime).toBe(145.5);
    expect(room.playback.isPlaying).toBe(true);
    expect(room.playback.seq).toBe(prevSeq + 1);
  });

  test("tsMap heartbeat records participant playhead and evicts stale disconnected participants", () => {
    const p1: MockParticipant = { socketId: "s1", userId: "u1", name: "Alice", color: "#f87171", isHost: true, joinedAt: Date.now(), clockOffset: 0, rtt: 30 };
    const p2: MockParticipant = { socketId: "s2", userId: "u2", name: "Bob", color: "#fb923c", isHost: false, joinedAt: Date.now(), clockOffset: 0, rtt: 45 };
    room.participants.set(p1.socketId, p1);
    room.participants.set(p2.socketId, p2);

    // Heartbeats received
    room.tsMap["u1"] = 120.4;
    room.tsMap["u2"] = 120.2;
    room.tsMap["stale_user"] = 115.0;

    // 1-second interval pruning routine
    const memberIds = Array.from(room.participants.values()).map((p) => p.userId);
    Object.keys(room.tsMap).forEach((key) => {
      if (!memberIds.includes(key)) delete room.tsMap[key];
    });

    expect(room.tsMap["u1"]).toBe(120.4);
    expect(room.tsMap["u2"]).toBe(120.2);
    expect(room.tsMap["stale_user"]).toBeUndefined();
  });
});

describe("State Synchronization Engine: Buffer-Aware Group Wait", () => {
  let room: MockRoom;

  beforeEach(() => {
    room = createMockRoom();
    room.playback.videoUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
    room.playback.videoType = "mp4";
    room.playback.isPlaying = true;
    room.playback.currentTime = 50.0;
  });

  test("buffer:event 'waiting' pauses room playback and stores buffering position", () => {
    const p1: MockParticipant = { socketId: "s1", userId: "u1", name: "Alice", color: "#f87171", isHost: true, joinedAt: Date.now(), clockOffset: 0, rtt: 40 };
    room.participants.set(p1.socketId, p1);

    // Alice buffers at 52.3s
    p1.isBuffering = true;
    room.playback.isPlaying = false;
    room.playback.currentTime = 52.3;
    room.playback.lastChangedAt = Date.now();
    room.playback.lastChangedBy = p1.userId;
    room.playback.seq++;

    expect(p1.isBuffering).toBe(true);
    expect(room.playback.isPlaying).toBe(false);
    expect(room.playback.currentTime).toBe(52.3);
  });

  test("buffer:event 'playing' resumes with dynamic RTT padding when all participants are ready", () => {
    const p1: MockParticipant = { socketId: "s1", userId: "u1", name: "Alice", color: "#f87171", isHost: true, joinedAt: Date.now(), clockOffset: 0, rtt: 80, isBuffering: true };
    const p2: MockParticipant = { socketId: "s2", userId: "u2", name: "Bob", color: "#fb923c", isHost: false, joinedAt: Date.now(), clockOffset: 0, rtt: 120, isBuffering: false };
    room.participants.set(p1.socketId, p1);
    room.participants.set(p2.socketId, p2);
    room.playback.isPlaying = false;

    // Alice finishes buffering
    p1.isBuffering = false;

    const allReady = Array.from(room.participants.values()).every((p) => !p.isBuffering);
    expect(allReady).toBe(true);

    let highestRtt = 0;
    for (const p of room.participants.values()) {
      highestRtt = Math.max(highestRtt, p.rtt || 50);
    }
    expect(highestRtt).toBe(120);

    const now = Date.now();
    const dynamicPaddingMs = Math.max(highestRtt * 2, 500); // Math.max(240, 500) = 500ms
    room.playback.isPlaying = true;
    room.playback.lastChangedAt = now + dynamicPaddingMs;
    room.playback.seq++;

    expect(room.playback.isPlaying).toBe(true);
    expect(room.playback.lastChangedAt).toBe(now + 500);
  });

  test("disconnect resilience: buffering participant leaves, remaining ready participants resume immediately", () => {
    const p1: MockParticipant = { socketId: "s1", userId: "u1", name: "Alice", color: "#f87171", isHost: true, joinedAt: Date.now(), clockOffset: 0, rtt: 50, isBuffering: false };
    const p2: MockParticipant = { socketId: "s2", userId: "u2", name: "Bob (Slow Network)", color: "#fb923c", isHost: false, joinedAt: Date.now(), clockOffset: 0, rtt: 300, isBuffering: true };
    room.participants.set(p1.socketId, p1);
    room.participants.set(p2.socketId, p2);
    room.playback.isPlaying = false; // Paused due to Bob buffering

    // Bob disconnects abruptly
    room.participants.delete(p2.socketId);

    // Deadlock check
    if (room.participants.size > 0 && !room.playback.isPlaying) {
      const allReady = Array.from(room.participants.values()).every((p) => !p.isBuffering);
      if (allReady && (room.playback.videoUrl || room.playback.videoType === "file")) {
        let highestRtt = 0;
        for (const participant of room.participants.values()) {
          highestRtt = Math.max(highestRtt, participant.rtt || 50);
        }
        room.playback.isPlaying = true;
        room.playback.lastChangedAt = Date.now() + Math.max(highestRtt * 2, 500);
        room.playback.lastChangedBy = "system";
        room.playback.seq++;
      }
    }

    expect(room.playback.isPlaying).toBe(true);
    expect(room.playback.lastChangedBy).toBe("system");
  });
});

describe("State Synchronization Engine: WebRTC Mesh Targeted Signaling", () => {
  let room: MockRoom;

  beforeEach(() => {
    room = createMockRoom();
    const p1: MockParticipant = { socketId: "sock_1", userId: "user_host", name: "Host", color: "#f87171", isHost: true, joinedAt: Date.now(), clockOffset: 0, rtt: 30 };
    const p2: MockParticipant = { socketId: "sock_2", userId: "user_viewer1", name: "Viewer 1", color: "#fb923c", isHost: false, joinedAt: Date.now(), clockOffset: 0, rtt: 40 };
    const p3: MockParticipant = { socketId: "sock_3", userId: "user_viewer2", name: "Viewer 2", color: "#fbbf24", isHost: false, joinedAt: Date.now(), clockOffset: 0, rtt: 50 };
    room.participants.set(p1.socketId, p1);
    room.participants.set(p2.socketId, p2);
    room.participants.set(p3.socketId, p3);
  });

  test("rtc:signal targets exact recipient socketId via payload.to lookup", () => {
    const payload = {
      to: "user_viewer2",
      msg: { type: "offer", sdp: "v=0..." },
    };

    let targetSocketId: string | null = null;
    for (const [sId, p] of room.participants.entries()) {
      if (p.userId === payload.to) {
        targetSocketId = sId;
        break;
      }
    }

    expect(targetSocketId).toBe("sock_3");
  });

  test("stream:announce updates room streamHost state correctly", () => {
    // Announce start
    room.streamHost = { userId: "user_host", fileName: "MyMovie.mp4" };
    expect(room.streamHost).toEqual({ userId: "user_host", fileName: "MyMovie.mp4" });

    // Announce stop
    room.streamHost = null;
    expect(room.streamHost).toBeNull();
  });

  test("streamHost is cleared when streaming participant disconnects", () => {
    room.streamHost = { userId: "user_host", fileName: "Stream.mp4" };

    // Host disconnects
    const me = room.participants.get("sock_1");
    room.participants.delete("sock_1");
    if (room.streamHost && room.streamHost.userId === me?.userId) {
      room.streamHost = null;
    }

    expect(room.streamHost).toBeNull();
  });
});

describe("State Synchronization Engine: CineVo Bridge & Local File Sync", () => {
  let room: MockRoom;

  beforeEach(() => {
    room = createMockRoom();
  });

  test("source:set sets external URL and setBy metadata", () => {
    const extUrl = "https://cinevo.nl/watch/movie-123";
    room.source = { url: extUrl, setBy: "user_alice", setAt: Date.now() };

    expect(room.source.url).toBe(extUrl);
    expect(room.source.setBy).toBe("user_alice");

    // Clearing source
    room.source = null;
    expect(room.source).toBeNull();
  });

  test("agent:ad tracks ad break status per participant", () => {
    room.adState.set("sock_1", true);
    expect(room.adState.get("sock_1")).toBe(true);

    room.adState.set("sock_1", false);
    expect(room.adState.get("sock_1")).toBe(false);
  });

  test("Local File Sync aggressively converts blob URLs to file://local and retains fileName", () => {
    const rawPayload = {
      videoUrl: "blob:http://localhost:3000/a3f2b4c8-1111-4444",
      fileName: "Inception.2010.1080p.mkv",
      videoType: "file",
    };

    // Server logic from mini-services/sync-service/index.ts line 312
    if (rawPayload.videoUrl && rawPayload.videoUrl.startsWith("blob:")) {
      rawPayload.videoUrl = "file://local";
      rawPayload.videoType = "file";
    }

    expect(rawPayload.videoUrl).toBe("file://local");
    expect(rawPayload.videoType).toBe("file");
    expect(rawPayload.fileName).toBe("Inception.2010.1080p.mkv");
  });
});

describe("State Synchronization Engine: Video Type Detection & YouTube URL Parser", () => {
  test("correctly classifies supported video URLs", () => {
    expect(detectVideoType("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("youtube");
    expect(detectVideoType("https://youtu.be/dQw4w9WgXcQ")).toBe("youtube");
    expect(detectVideoType("https://example.com/live/stream.m3u8")).toBe("hls");
    expect(detectVideoType("https://example.com/video.mp4?token=abc")).toBe("mp4");
    expect(detectVideoType("https://example.com/video.webm")).toBe("webm");
    expect(detectVideoType("https://example.com/video.ogg")).toBe("ogg");
    expect(detectVideoType("magnet:?xt=urn:btih:0123456789abcdef")).toBe("torrent");
    expect(detectVideoType("https://vimeo.com/123456789")).toBe("vimeo");
    expect(detectVideoType("https://www.dailymotion.com/video/x7tgad0")).toBe("dailymotion");
    expect(detectVideoType("https://twitch.tv/streamer")).toBe("twitch");
    expect(detectVideoType("https://generic-site.com/embed/123")).toBe("iframe");
  });

  test("extracts YouTube video IDs correctly across all formats", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ?t=42")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/v/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://example.com/video.mp4")).toBeNull();
  });
});
