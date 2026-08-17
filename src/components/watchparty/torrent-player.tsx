"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
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
  Wifi,
  Users,
} from "lucide-react";
import { useVideoController } from "@/lib/sync/use-video-controller";
import { PlaybackState } from "@/lib/sync/types";

interface TorrentPlayerProps {
  playback: PlaybackState | null;
  clockOffset: number;
  onIntent: (patch: Partial<{
    isPlaying: boolean;
    currentTime: number;
    playbackRate: number;
  }>) => void;
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
  userId?: string;
  // Host: called when host picks a file to seed
  onSeedFile?: (magnetURI: string, fileName: string) => void;
  // Whether this viewer is the host (has the file)
  isHost: boolean;
}

// WebTorrent is loaded from esm.sh (which serves the npm package as a
// browser-ready ES module with all node polyfills handled). We use a runtime
// import() via a variable so Turbopack doesn't try to resolve it at build time.
let wtClient: any = null;
let wtLoadPromise: Promise<any> | null = null;

function loadWebTorrent(): Promise<any> {
  if (wtClient) return Promise.resolve(wtClient);
  if (wtLoadPromise) return wtLoadPromise;
  // Use a variable so Turbopack/Next.js doesn't try to bundle this import
  const pkg = "web" + "torrent";
  const url = "https://esm.sh/" + pkg + "@3.0.21";
  wtLoadPromise = (new Function("u", "return import(u)"))(url)
    .then((mod: any) => {
      const WebTorrent = mod.default || mod.WebTorrent || mod;
      if (!WebTorrent) throw new Error("WebTorrent class not found");
      wtClient = new WebTorrent({
        tracker: {
          rtcConfig: {
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              { urls: "stun:global.stun.twilio.com:3478" },
            ],
          },
        },
      });
      return wtClient;
    })
    .catch((e) => {
      wtLoadPromise = null;
      throw e;
    });
  return wtLoadPromise!;
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    setStatus("Loading WebTorrent…");
    try {
      const client = await loadWebTorrent();
      setStatus(`Seeding "${file.name}" (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);
      // Seed the file
      client.seed(file, (torrent: any) => {
        seedingRef.current = torrent;
        const magnet = torrent.magnetURI;
        setStatus(`Seeding — ${torrent.numPeers} peer(s) connected`);
        setPeers(torrent.numPeers);
        // Tell the parent to sync the magnet URI to the room
        onSeedFile?.(magnet, file.name);
        // Also play locally
        const videoEl = videoRef.current;
        if (videoEl) {
          const fileObj = torrent.files[0];
          fileObj.streamTo(videoEl).then(() => {
            setReady(true);
            setDuration(videoEl.duration || 0);
          });
        }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to seed file");
      setStatus("");
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
      setStatus("Connecting to host…");

      // Add the torrent
      const torrent = client.add(magnetURI, (t: any) => {
        if (cancelled) return;
        setStatus("Downloading from host…");
        const videoEl = videoRef.current;
        if (!videoEl) return;

        // Stream the first file to the video element
        const file = t.files[0];
        file.streamTo(videoEl).then(() => {
          if (cancelled) return;
          setReady(true);
          setDuration(videoEl.duration || 0);
          setStatus(`Streaming — ${t.numPeers} peer(s)`);
        });
      });

      torrentRef.current = torrent;

      // Track progress + peers
      torrent.on("download", () => {
        if (cancelled) return;
        setProgress(torrent.progress * 100);
        setPeers(torrent.numPeers);
        setStatus(`Streaming — ${torrent.numPeers} peer(s), ${Math.round(torrent.downloadSpeed / 1024)} KB/s`);
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
  }, [videoRef.current]);

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
  }, [videoRef]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, [videoRef]);

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
    if (v) {
      v.currentTime = t;
      setLocalTime(t);
    }
    onIntent({ currentTime: t });
  }, [videoRef, onIntent]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      wrapRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  // ── No video yet: anyone can pick a file to seed ──
  if (!isMagnet) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-violet-500/10">
            <Upload className="h-7 w-7 text-violet-400" />
          </div>
          <p className="text-sm font-semibold text-white">
            Pick a movie to stream to everyone
          </p>
          <p className="mt-1.5 text-xs text-white/50">
            Pick a video file from your device and it&apos;ll stream directly
            to all viewers via WebTorrent (P2P). Only one person needs the file.
          </p>
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
          <Button
            className="mt-4 gap-2"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" /> Choose movie file
          </Button>
          <p className="mt-3 text-[10px] text-white/30">
            Supports MP4, WebM, MKV — anything your browser can play.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="group relative h-full w-full overflow-hidden bg-black"
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full bg-black object-contain"
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        style={{ objectFit: "contain" }}
      />

      {/* Loading / status overlay */}
      {!ready && !error && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black/60">
          <Loader2 className="h-10 w-10 animate-spin text-violet-400" />
          <p className="mt-3 text-sm text-white/80">{status}</p>
          {progress > 0 && progress < 100 && (
            <div className="mt-2 w-48 rounded-full bg-white/10">
              <div
                className="h-1.5 rounded-full bg-violet-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6">
          <div className="max-w-md text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-rose-400" />
            <p className="text-sm font-medium text-white">Streaming error</p>
            <p className="mt-1 text-xs text-white/60">{error}</p>
          </div>
        </div>
      )}

      {/* Status bar (top) */}
      {ready && (
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <Badge variant="secondary" className="gap-1 bg-black/60 text-white backdrop-blur">
            <Wifi className="h-3 w-3" /> {peers} peer{peers !== 1 ? "s" : ""}
          </Badge>
          {progress < 100 && (
            <Badge variant="secondary" className="gap-1 bg-black/60 text-white backdrop-blur">
              {Math.round(progress)}% buffered
            </Badge>
          )}
        </div>
      )}

      {/* Controls (bottom) */}
      {ready && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs tabular-nums text-white/80">
              {fmtTime(localTime)}
            </span>
            <Slider
              value={[localTime]}
              min={0}
              max={duration || 100}
              step={0.1}
              onValueChange={onSeek}
              className="flex-1"
            />
            <span className="text-xs tabular-nums text-white/80">
              {fmtTime(duration)}
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
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
