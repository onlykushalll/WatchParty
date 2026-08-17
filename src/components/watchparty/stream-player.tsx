"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Loader2,
  Upload,
  AlertCircle,
  Users,
  Radio,
  Globe,
  Zap,
  ArrowRight,
} from "lucide-react";
import { useWebRTCStream } from "@/lib/webrtc/use-webrtc-stream";
import { PlaybackState } from "@/lib/sync/types";
import { useVideoController } from "@/lib/sync/use-video-controller";

interface StreamPlayerProps {
  playback: PlaybackState | null;
  clockOffset: number;
  onIntent: (patch: Partial<PlaybackState>) => void;
  // Command-relay props
  cmdPlay?: () => void;
  cmdPause?: () => void;
  cmdSeek?: (time: number, playing: boolean) => void;
  cmdTs?: (ts: number) => void;
  remoteCmd?: {
    play: { by: string; ts: number } | null;
    pause: { by: string; ts: number } | null;
    seek: { time: number; playing: boolean; by: string } | null;
  };
  tsMap?: Record<string, number>;
  // The raw socket for WebRTC signaling
  socket: any;
  userId: string;
  // List of participant userIds
  participantIds: string[];
  // Whether this user is the host
  isHost: boolean;
  onStreamStart?: (fileName: string) => void;
  onStreamStop?: () => void;
  onSeedFile?: (magnetURI: string, fileName: string) => void;
  streamingHostId: string | null;
  streamingFileName: string | null;
}

let wtClient: any = null;
let wtLoadPromise: Promise<any> | null = null;

function loadWebTorrent(): Promise<any> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("WebTorrent is only supported in browser"));
  }
  const w = window as any;
  if (wtClient) return Promise.resolve(wtClient);
  if (w.WebTorrent) {
    const WT = w.WebTorrent;
    wtClient = new WT({
      tracker: {
        rtcConfig: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:global.stun.twilio.com:3478" },
          ],
        },
      },
    });
    return Promise.resolve(wtClient);
  }
  if (wtLoadPromise) return wtLoadPromise;

  wtLoadPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("webtorrent-script");
    if (existing) {
      const check = setInterval(() => {
        if (w.WebTorrent) {
          clearInterval(check);
          const WT = w.WebTorrent;
          wtClient = new WT({
            tracker: {
              rtcConfig: {
                iceServers: [
                  { urls: "stun:stun.l.google.com:19302" },
                  { urls: "stun:global.stun.twilio.com:3478" },
                ],
              },
            },
          });
          resolve(wtClient);
        }
      }, 50);
      return;
    }

    const script = document.createElement("script");
    script.id = "webtorrent-script";
    script.src = "https://cdn.jsdelivr.net/npm/webtorrent@latest/webtorrent.min.js";
    script.async = true;
    script.onload = () => {
      if (w.WebTorrent) {
        const WT = w.WebTorrent;
        wtClient = new WT({
          tracker: {
            rtcConfig: {
              iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:global.stun.twilio.com:3478" },
              ],
            },
          },
        });
        resolve(wtClient);
      } else {
        reject(new Error("WebTorrent library failed to load"));
      }
    };
    script.onerror = () => {
      wtLoadPromise = null;
      reject(new Error("Failed to load WebTorrent from CDN"));
    };
    document.head.appendChild(script);
  });

  return wtLoadPromise;
}

export function StreamPlayer({
  playback,
  clockOffset,
  onIntent,
  cmdPlay,
  cmdPause,
  cmdSeek,
  cmdTs,
  remoteCmd,
  tsMap,
  socket,
  userId,
  participantIds,
  isHost,
  onStreamStart,
  onStreamStop,
  onSeedFile,
  streamingHostId,
  streamingFileName,
}: StreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const torrentRef = useRef<any>(null);
  const seedingRef = useRef<any>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [magnetInput, setMagnetInput] = useState<string>("");
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [localTime, setLocalTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [streamType, setStreamType] = useState<"webrtc" | "torrent" | "direct">("webrtc");
  const [torrentPeers, setTorrentPeers] = useState(0);

  const magnetURI = playback?.videoUrl || "";
  const isMagnet = magnetURI.startsWith("magnet:") || magnetURI.startsWith("webtorrent:");

  // WebRTC hook — handles peer mesh streaming
  const webrtc = useWebRTCStream({
    socket,
    userId,
    sourceVideoRef: videoRef,
    destVideoRef: videoRef,
    isHost,
  });

  // State synchronization controller
  useVideoController({
    videoRef,
    playback,
    clockOffset,
    onIntent,
    cmdPlay,
    cmdPause,
    cmdSeek,
    cmdTs,
    remoteCmd,
    tsMap,
    userId,
  });

  // ── HOST: Pick a file and broadcast via WebRTC + WebTorrent ──
  const handleFilePick = useCallback(async (file: File) => {
    setError(null);
    setStatus(`Loading "${file.name}" (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);

    const url = URL.createObjectURL(file);
    const v = videoRef.current;
    if (!v) {
      setError("Video element not initialized");
      return;
    }

    // 1. Instant local playback for host
    v.src = url;
    v.muted = false;
    setMuted(false);
    v.play().then(() => {
      setReady(true);
      setDuration(v.duration || 0);
      setStreamType("webrtc");
      webrtc.startStreaming(file.name);
      onStreamStart?.(file.name);
    }).catch(() => {
      // Autoplay with audio blocked fallback
      v.muted = true;
      setMuted(true);
      v.play().catch(() => {});
      setReady(true);
      webrtc.startStreaming(file.name);
      onStreamStart?.(file.name);
    });

    // 2. Background WebTorrent Seeding (for swarm caching & large file delivery)
    try {
      const client = await loadWebTorrent();
      client.seed(file, (torrent: any) => {
        seedingRef.current = torrent;
        const magnet = torrent.magnetURI;
        setTorrentPeers(torrent.numPeers);
        onSeedFile?.(magnet, file.name);

        torrent.on("wire", () => setTorrentPeers(torrent.numPeers));
        torrent.on("upload", () => {
          const speed = Math.round(torrent.uploadSpeed / 1024);
          setStatus(`P2P Seeding — ${torrent.numPeers} peer(s), ↑ ${speed} KB/s`);
        });
      });
    } catch (e) {
      console.warn("Background WebTorrent notice:", e);
    }
  }, [webrtc, onStreamStart, onSeedFile]);

  // ── HOST: Handle Magnet Link input ──
  const handleMagnetSubmit = useCallback(async (uri: string) => {
    const clean = uri.trim();
    if (!clean) return;
    setError(null);
    setStatus("Connecting to magnet swarm…");

    try {
      const client = await loadWebTorrent();
      const torrent = client.add(clean, (t: any) => {
        setStatus(`Streaming torrent — ${t.numPeers} peer(s)`);
        const v = videoRef.current;
        if (!v) return;
        const file = (t.files || []).sort((a: any, b: any) => b.length - a.length)[0] || t.files[0];
        if (file) {
          setReady(true);
          setStreamType("torrent");
          if (typeof file.renderTo === "function") {
            file.renderTo(v, { autoplay: false }, () => {
              setDuration(v.duration || 0);
            });
          } else if (typeof file.streamTo === "function") {
            file.streamTo(v).then(() => setDuration(v.duration || 0));
          }
        }
      });
      torrentRef.current = torrent;
      onIntent({ videoUrl: clean, videoType: "torrent" });
      onSeedFile?.(clean, "Magnet Stream");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load magnet");
    }
  }, [onIntent, onSeedFile]);

  // ── HOST: Create peer connections for new room viewers ──
  useEffect(() => {
    if (!isHost || !webrtc.streaming) return;
    participantIds.forEach((pid) => {
      if (pid !== userId && !webrtc.peers.find((p) => p.userId === pid)) {
        webrtc.createHostPeer(pid);
      }
    });
  }, [isHost, webrtc.streaming, participantIds, userId, webrtc.peers, webrtc.createHostPeer]);

  // ── VIEWER: Connect to Magnet if room switched to torrent ──
  useEffect(() => {
    if (isHost || !isMagnet || seedingRef.current) return;
    let cancelled = false;
    setError(null);
    setStatus("Connecting to P2P swarm…");

    loadWebTorrent().then((client) => {
      if (cancelled) return;
      const torrent = client.add(magnetURI, (t: any) => {
        if (cancelled) return;
        const v = videoRef.current;
        if (!v) return;
        const file = (t.files || []).sort((a: any, b: any) => b.length - a.length)[0] || t.files[0];
        if (file) {
          setReady(true);
          setStreamType("torrent");
          if (typeof file.renderTo === "function") {
            file.renderTo(v, { autoplay: false }, () => {
              setDuration(v.duration || 0);
              setStatus(`Streaming — ${t.numPeers} peer(s)`);
            });
          } else if (typeof file.streamTo === "function") {
            file.streamTo(v).then(() => {
              setDuration(v.duration || 0);
              setStatus(`Streaming — ${t.numPeers} peer(s)`);
            });
          }
        }
      });
      torrentRef.current = torrent;
      torrent.on("download", () => {
        if (cancelled) return;
        setTorrentPeers(torrent.numPeers);
        setStatus(`Streaming — ${torrent.numPeers} peer(s), ↓ ${Math.round(torrent.downloadSpeed / 1024)} KB/s`);
      });
      torrent.on("wire", () => {
        if (cancelled) return;
        setTorrentPeers(torrent.numPeers);
      });
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (torrentRef.current) {
        try { torrentRef.current.destroy(); } catch {}
        torrentRef.current = null;
      }
    };
  }, [magnetURI, isHost, isMagnet]);

  // ── VIEWER: Auto-detect WebRTC stream from host ──
  useEffect(() => {
    if (!isHost && webrtc.remoteStream && !ready && !isMagnet) {
      setReady(true);
      setStreamType("webrtc");
    }
  }, [isHost, webrtc.remoteStream, ready, isMagnet]);

  // ── Track local video time ──
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setLocalTime(v.currentTime);
    const onDur = () => setDuration(v.duration || 0);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onDur);
    v.addEventListener("loadedmetadata", onDur);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("loadedmetadata", onDur);
    };
  }, []);

  // ── Fullscreen handler ──
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
      cmdPlay?.();
    } else {
      v.pause();
      cmdPause?.();
    }
  }, [cmdPlay, cmdPause]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const onVolumeChange = useCallback((val: number[]) => {
    const vol = val[0] ?? 1;
    setVolume(vol);
    const v = videoRef.current;
    if (v) {
      v.volume = vol;
      v.muted = vol === 0;
      setMuted(vol === 0);
    }
  }, []);

  const onSeek = useCallback((val: number[]) => {
    const t = val[0];
    const v = videoRef.current;
    if (v && Number.isFinite(t)) {
      v.currentTime = t;
      cmdSeek?.(t, !v.paused);
    }
  }, [cmdSeek]);

  const toggleFullscreen = useCallback(() => {
    if (!wrapRef.current) return;
    if (!document.fullscreenElement) {
      wrapRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const activePeerCount = isHost ? webrtc.peers.length + torrentPeers : webrtc.peers.length + torrentPeers;

  return (
    <div
      ref={wrapRef}
      onMouseMove={() => setShowControls(true)}
      className="group relative flex h-full w-full items-center justify-center bg-black overflow-hidden select-none"
    >
      {/* ── Strict 16:9 widescreen stage container ── */}
      <div className="relative w-full h-full max-w-[calc(100vh*16/9)] max-h-[calc(100vw*9/16)] aspect-video flex items-center justify-center bg-black">
        {/* Video Element */}
        <video
          ref={videoRef}
          playsInline
          className={`h-full w-full object-contain ${ready ? "block" : "hidden"}`}
        />

        {/* Not Ready: Host File/Magnet Picker or Viewer Waiting Screen */}
        {!ready && (
          <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
            {isHost ? (
              <div className="max-w-md space-y-5">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/30 text-white">
                  <Radio className="h-8 w-8" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white tracking-tight">P2P File & Torrent Stream</h3>
                  <p className="mt-1 text-xs text-zinc-400">
                    Stream local movie files or magnet links directly to everyone in your room via zero-lag WebRTC peer mesh and WebTorrent swarms.
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors">
                    <Upload className="h-4 w-4" /> Pick Video File to Stream
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFilePick(f);
                      }}
                    />
                  </label>

                  <div className="flex items-center gap-2">
                    <div className="h-px flex-1 bg-zinc-800" />
                    <span className="text-[10px] uppercase font-semibold text-zinc-500">or enter magnet link</span>
                    <div className="h-px flex-1 bg-zinc-800" />
                  </div>

                  <div className="flex gap-2">
                    <Input
                      value={magnetInput}
                      onChange={(e) => setMagnetInput(e.target.value)}
                      placeholder="magnet:?xt=urn:btih:..."
                      className="text-xs bg-zinc-900/80 border-zinc-800"
                      onKeyDown={(e) => e.key === "Enter" && handleMagnetSubmit(magnetInput)}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-xs shrink-0 gap-1"
                      onClick={() => handleMagnetSubmit(magnetInput)}
                    >
                      <Globe className="h-3 w-3" /> Stream <ArrowRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {status && (
                  <div className="flex items-center justify-center gap-2 text-xs text-primary animate-pulse">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>{status}</span>
                  </div>
                )}
                {error && (
                  <div className="flex items-center justify-center gap-2 text-xs text-rose-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="max-w-md space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800 text-zinc-400 animate-pulse">
                  <Radio className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    {streamingHostId ? "Connecting to Host Stream…" : "Waiting for Host"}
                  </h3>
                  <p className="mt-1 text-xs text-zinc-400">
                    {streamingHostId
                      ? `Receiving "${streamingFileName || "live media stream"}" over peer-to-peer connection…`
                      : "The host has not started a P2P stream yet. When they pick a file or torrent, it will play here automatically."}
                  </p>
                </div>
                {streamingHostId && (
                  <div className="flex items-center justify-center gap-2 text-xs text-primary">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Connecting WebRTC peer mesh…</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Top Live Stream Badges ── */}
      {ready && (
        <div className="absolute top-3 left-3 z-20 flex items-center gap-2 pointer-events-none">
          <Badge variant="default" className="gap-1.5 bg-violet-600/90 text-white backdrop-blur shadow-sm">
            <Radio className="h-3 w-3 animate-pulse text-emerald-300" />
            <span>P2P Stream</span>
          </Badge>
          <Badge variant="secondary" className="gap-1 bg-black/60 text-zinc-300 backdrop-blur border-0">
            <Users className="h-3 w-3 text-primary" />
            <span>{Math.max(1, activePeerCount)} connected</span>
          </Badge>
          {isHost && (
            <Badge variant="outline" className="text-[10px] bg-black/40 border-violet-500/40 text-violet-300">
              Host Broadcaster
            </Badge>
          )}
        </div>
      )}

      {/* ── Hover Controls Bar ── */}
      {ready && (
        <div
          className={`absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 transition-opacity duration-200 ${
            showControls ? "opacity-100" : "opacity-0"
          }`}
        >
          {duration > 0 && (
            <div className="mb-2 flex items-center gap-3">
              <div className="flex-1">
                <Slider
                  value={[localTime]}
                  min={0}
                  max={duration}
                  step={0.1}
                  onValueChange={onSeek}
                />
              </div>
              <span className="font-mono text-xs text-white/80">
                {fmtTime(localTime)} / {fmtTime(duration)}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={togglePlay} className="text-white hover:bg-white/10">
              {playback?.isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleMute} className="text-white hover:bg-white/10">
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </Button>
            <div className="w-20">
              <Slider
                value={[muted ? 0 : volume]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={onVolumeChange}
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              {status && (
                <span className="text-[10px] text-zinc-400 font-mono hidden sm:inline">{status}</span>
              )}
              <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="text-white hover:bg-white/10">
                <Maximize className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
