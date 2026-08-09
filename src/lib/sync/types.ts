// Shared types between client and the sync service.

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number; // seconds
  playbackRate: number;
  videoUrl: string;
  videoType: string; // "youtube" | "hls" | "mp4" | "webm" | "iframe" | ...
  lastChangedAt: number; // server-global ms timestamp
  lastChangedBy: string;
  seq: number;
}

export interface Participant {
  userId: string;
  name: string;
  color: string;
  isHost: boolean;
  joinedAt: number;
}

export interface QueueItem {
  url: string;
  type: string;
  addedBy: string;
  addedAt: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  color: string;
  text: string;
  at: number;
}

export interface Reaction {
  emoji: string;
  userId: string;
  userName: string;
  color: string;
  at: number;
}

export function detectVideoType(url: string): string {
  const u = (url || "").toLowerCase().trim();
  if (!u) return "";
  if (/youtube\.com\/watch|youtu\.be\//.test(u)) return "youtube";
  if (/\.m3u8(\?|$)/.test(u)) return "hls";
  if (/\.mp4(\?|$)/.test(u)) return "mp4";
  if (/\.webm(\?|$)/.test(u)) return "webm";
  if (/\.ogg(\?|$)/.test(u)) return "ogg";
  if (/vimeo\.com/.test(u)) return "vimeo";
  if (/dailymotion\.com/.test(u)) return "dailymotion";
  if (/twitch\.tv/.test(u)) return "twitch";
  return "iframe";
}

export function youtubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([\w-]{11})/,
  );
  return m ? m[1] : null;
}
