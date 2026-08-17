"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { PlaybackState } from "@/lib/sync/types";
import { useVideoController } from "@/lib/sync/use-video-controller";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Upload,
  Users,
  Globe,
  Loader2,
  AlertCircle,
} from "lucide-react";

interface TorrentPlayerProps {
  playback: PlaybackState | null;
  clockOffset: number;
  onIntent: (intent: Partial<PlaybackState>) => void;
  // Local file / command sync
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
  userId?: string;
  // Host: called when host picks a file to seed
  onSeedFile?: (magnetURI: string, fileName: string) => void;
  // Whether this viewer is the host (has the file)
  isHost: boolean;
}

let wtClient: any = null;
let wtLoadPromise: Promise<any> | null = null;

function loadWebTorrent(): Promise<any> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("WebTorrent is only supported in browser environments"));
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

export function TorrentPlayer({
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
  onSeedFile,
  isHost,
}: TorrentPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const torrentRef = useRef<any>(null);
  const seedingRef = useRef<any>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [peers, setPeers] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [localTime, setLocalTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const magnetURI = playback?.videoUrl || "";
  const isMagnet = magnetURI.startsWith("magnet:") || magnetURI.startsWith("webtorrent:");

  // Use the video controller for sync
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

  // ── HOST: seed a file when picked ──
  const handleFilePick = useCallback(async (file: File) => {
    setError(null);
    setStatus(`Preparing "${file.name}" (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);

    // 1. Instant 0-second local video playback for host
    const localUrl = URL.createObjectURL(file);
    const videoEl = videoRef.current;
    if (videoEl) {
      videoEl.src = localUrl;
      videoEl.load();
      videoEl.play().catch(() => {});
    }
    setReady(true);

    // 2. Start seeding via WebTorrent in background
    try {
      const client = await loadWebTorrent();
      setStatus(`Seeding "${file.name}"…`);
      client.seed(file, (torrent: any) => {
        seedingRef.current = torrent;
        const magnet = torrent.magnetURI;
        setStatus(`Seeding — ${torrent.numPeers} peer(s) connected`);
        setPeers(torrent.numPeers);
        // Sync magnet to room
        onSeedFile?.(magnet, file.name);

        torrent.on("wire", () => {
          setPeers(torrent.numPeers);
          setStatus(`Seeding — ${torrent.numPeers} peer(s) connected`);
        });

        torrent.on("upload", () => {
          const speed = Math.round(torrent.uploadSpeed / 1024);
          setStatus(`Seeding — ${torrent.numPeers} peer(s), ↑ ${speed} KB/s`);
        });
      });
    } catch (e) {
      console.warn("WebTorrent background seed notice:", e);
    }
  }, [onSeedFile]);

  // ── VIEWER: join the torrent when magnetURI arrives ──
  // If we're the seeder (seedingRef is set), don't join — we already have it.
  useEffect(() => {
    if (!isMagnet || seedingRef.current) return;
    let cancelled = false;
    setError(null);
    setReady(false);
    setStatus("Loading WebTorrent…");

    loadWebTorrent().then((client) => {
      if (cancelled) return;
      setStatus("Connecting to host swarm…");

      // Add the torrent
      const torrent = client.add(magnetURI, (t: any) => {
        if (cancelled) return;
        setStatus("Buffering media stream…");
        const videoEl = videoRef.current;
        if (!videoEl) return;

        // Render the largest video file
        const videoFiles = (t.files || []).filter((f: any) =>
          f.name.match(/\.(mp4|m4v|webm|mkv|mov|avi|ogv)$/i) || f.name.length > 0,
        );
        const file = videoFiles.sort((a: any, b: any) => b.length - a.length)[0] || t.files[0];

        if (file) {
          setReady(true);
          try {
            if (typeof file.renderTo === "function") {
              file.renderTo(videoEl, { autoplay: false }, (err: any) => {
                if (cancelled) return;
                if (!err) {
                  setDuration(videoEl.duration || 0);
                  setStatus(`Streaming — ${t.numPeers} peer(s)`);
                }
              });
            } else if (typeof file.streamTo === "function") {
              file.streamTo(videoEl).then(() => {
                if (cancelled) return;
                setDuration(videoEl.duration || 0);
                setStatus(`Streaming — ${t.numPeers} peer(s)`);
              });
            } else {
              file.getBlobURL((err: any, url: string) => {
                if (cancelled) return;
                if (!err && url) {
                  videoEl.src = url;
                  setStatus(`Streaming — ${t.numPeers} peer(s)`);
                }
              });
            }
          } catch (err) {
            console.error("WebTorrent file render error:", err);
          }
        }
      });

      torrentRef.current = torrent;

      // Track progress + peers
      torrent.on("download", () => {
        if (cancelled) return;
        setProgress(torrent.progress * 100);
        setPeers(torrent.numPeers);
        setStatus(`Streaming — ${torrent.numPeers} peer(s), ↓ ${Math.round(torrent.downloadSpeed / 1024)} KB/s`);
      });
      torrent.on("wire", () => {
        if (cancelled) return;
        setPeers(torrent.numPeers);
      });
      torrent.on("error", (err: any) => {
        if (cancelled) return;
        setError("Torrent error: " + err.message);
      });
    }).catch((e) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : "Failed to load WebTorrent");
    });

    return () => {
      cancelled = true;
      if (torrentRef.current) {
        try { torrentRef.current.destroy(); } catch {}
        torrentRef.current = null;
      }
    };
  }, [magnetURI, isHost, isMagnet]);

  // ── Track local time ──
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

  // ── Fullscreen ──
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    else v.pause();
  }, []);

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
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="group relative flex h-full w-full items-center justify-center bg-black overflow-hidden select-none"
    >
      {/* ── Strict 16:9 widescreen stage container ── */}
      <div className="relative w-full h-full max-w-[calc(100vh*16/9)] max-h-[calc(100vw*9/16)] aspect-video flex items-center justify-center bg-black">
        {/* Video element */}
        <video
          ref={videoRef}
          playsInline
          className={`h-full w-full object-contain ${ready ? "block" : "hidden"}`}
        />

        {/* Not playing yet: Host file picker or Viewer waiting screen */}
        {!ready && (
          <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
            {isHost ? (
              <div className="max-w-md space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20 text-white">
                  <Globe className="h-8 w-8" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">WebTorrent P2P Stream</h3>
                  <p className="mt-1 text-xs text-zinc-400">
                    Seed any video file directly to room members over peer-to-peer WebTorrent swarms. No server storage needed.
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-zinc-950 shadow hover:bg-emerald-400 transition-colors">
                  <Upload className="h-4 w-4" /> Pick Video to Seed
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFilePick(f);
                    }}
                  />
                </label>
                {status && (
                  <div className="flex items-center justify-center gap-2 text-xs text-emerald-400">
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
            ) : isMagnet ? (
              <div className="max-w-md space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20 text-white animate-pulse">
                  <Globe className="h-8 w-8" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Connecting to Torrent Swarm</h3>
                  <p className="mt-1 text-xs text-zinc-400">
                    Downloading video stream directly from host and connected peers.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>{status || "Connecting…"}</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
                {error && (
                  <div className="flex items-center justify-center gap-2 text-xs text-rose-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="max-w-md space-y-4">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-800 text-zinc-400">
                  <Globe className="h-8 w-8" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">No Torrent Active</h3>
                  <p className="mt-1 text-xs text-zinc-400">
                    Waiting for the host to start seeding a movie via WebTorrent…
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Overlay Badges ── */}
      {ready && (
        <div className="absolute top-3 left-3 z-20 flex items-center gap-2 pointer-events-none">
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-400 backdrop-blur">
            <Globe className="h-3 w-3" /> WebTorrent P2P
          </span>
          <span className="flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-zinc-300 backdrop-blur">
            <Users className="h-3 w-3" /> {peers} peer(s)
          </span>
          {status && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-emerald-300/90 backdrop-blur">
              {status}
            </span>
          )}
        </div>
      )}

      {/* ── Controls Bar ── */}
      {ready && (
        <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 opacity-0 transition-opacity group-hover:opacity-100">
          <div className="mb-2 flex items-center gap-3">
            <div className="flex-1">
              <Slider
                value={[localTime]}
                min={0}
                max={duration || 100}
                step={0.1}
                onValueChange={onSeek}
              />
            </div>
            <span className="font-mono text-xs text-white/80">
              {fmtTime(localTime)} / {fmtTime(duration)}
            </span>
          </div>
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
                <span className="text-[10px] text-white/50">{status}</span>
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
