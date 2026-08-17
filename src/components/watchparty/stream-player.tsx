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
  Radio,
} from "lucide-react";
import { useWebRTCStream } from "@/lib/webrtc/use-webrtc-stream";
import { PlaybackState } from "@/lib/sync/types";

interface StreamPlayerProps {
  playback: PlaybackState | null;
  clockOffset: number;
  onIntent: (patch: Partial<{
    isPlaying: boolean;
    currentTime: number;
    playbackRate: number;
  }>) => void;
  // Command-relay props (for chat log + state sync)
  cmdPlay?: () => void;
  cmdPause?: () => void;
  cmdSeek?: (time: number, playing: boolean) => void;
  // The raw socket for WebRTC signaling
  socket: any;
  userId: string;
  // List of participant userIds (so host can create peers for new viewers)
  participantIds: string[];
  // Whether this user is the host (has the file)
  isHost: boolean;
  // Host: called when they pick a file (to update room state)
  onStreamStart?: (fileName: string) => void;
  onStreamStop?: () => void;
  // Viewer: the host's userId (who is streaming)
  streamingHostId: string | null;
  streamingFileName: string | null;
}

export function StreamPlayer({
  playback,
  clockOffset,
  onIntent,
  cmdPlay,
  cmdPause,
  cmdSeek,
  socket,
  userId,
  participantIds,
  isHost,
  onStreamStart,
  onStreamStop,
  streamingHostId,
  streamingFileName,
}: StreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [localTime, setLocalTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);

  // WebRTC hook — handles both host (captureStream + send) and viewer (receive)
  const webrtc = useWebRTCStream({
    socket,
    userId,
    sourceVideoRef: videoRef, // host: captures from this
    destVideoRef: videoRef,   // viewer: plays received stream here
    isHost,
  });

  // ── HOST: pick a file and start streaming ──
  const handleFilePick = useCallback(async (file: File) => {
    setError(null);
    const url = URL.createObjectURL(file);
    // Wait for the video element to be available (it's always rendered, just hidden)
    const v = videoRef.current;
    if (!v) {
      setError("Video element not ready");
      return;
    }
    v.src = url;
    v.muted = true;
    v.play().then(() => {
      setReady(true);
      setDuration(v.duration || 0);
      webrtc.startStreaming(file.name);
      onStreamStart?.(file.name);
    }).catch((e) => {
      setError("Failed to play file: " + e.message);
    });
  }, [webrtc, onStreamStart]);

  // ── HOST: create peer connections for new viewers ──
  useEffect(() => {
    if (!isHost || !webrtc.streaming) return;
    // Create peers for any viewer who doesn't have one yet
    participantIds.forEach((pid) => {
      if (pid !== userId && !webrtc.peers.find((p) => p.userId === pid)) {
        webrtc.createHostPeer(pid);
      }
    });
  }, [isHost, webrtc.streaming, participantIds, userId, webrtc.peers, webrtc.createHostPeer]);

  // ── Track local time + duration (host only) ──
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isHost) return;
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
  }, [isHost]);

  // ── Fullscreen ──
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ── Controls (host only — viewers can't control the live stream) ──
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !isHost) return;
    if (v.paused) {
      v.play().catch(() => {});
      cmdPlay?.();
    } else {
      v.pause();
      cmdPause?.();
    }
  }, [isHost, cmdPlay, cmdPause]);

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
    if (!v || !isHost) return;
    v.currentTime = t;
    setLocalTime(t);
    cmdSeek?.(t, !v.paused);
  }, [isHost, cmdSeek]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      wrapRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  // Auto-hide controls
  useEffect(() => {
    const t = setTimeout(() => {
      if (playback?.isPlaying) setShowControls(false);
    }, 3000);
    return () => clearTimeout(t);
  }, [playback?.isPlaying, localTime]);

  // Always render the video element (hidden when not streaming) so refs work
  const showFilePicker = isHost && !webrtc.streaming && !webrtc.error;
  const showWaiting = !isHost && !webrtc.streaming && !streamingHostId;
  const showConnecting = !isHost && !webrtc.remoteStream && !!streamingHostId;

  return (
    <div
      ref={wrapRef}
      className="group relative h-full w-full overflow-hidden bg-black"
      onMouseMove={() => setShowControls(true)}
    >
      {/* Always-rendered video element (host: plays local file; viewer: plays remote stream) */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full bg-black object-contain"
        playsInline
        autoPlay
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        style={{ objectFit: "contain", visibility: (webrtc.streaming || ready) ? "visible" : "hidden" }}
      />

      {/* HOST: file picker overlay */}
      {showFilePicker && (
        <div className="absolute inset-0 flex items-center justify-center bg-black p-6">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-violet-500/10">
              <Upload className="h-7 w-7 text-violet-400" />
            </div>
            <p className="text-sm font-semibold text-white">
              Stream a movie to everyone
            </p>
            <p className="mt-1.5 text-xs text-white/50">
              Pick a video file from your device. It&apos;ll stream directly to all
              viewers in real-time via WebRTC. Only you need the file — viewers
              never download it.
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
              <br />Latency: ~200-500ms · Sync: automatic (shared stream)
            </p>
          </div>
        </div>
      )}

      {/* VIEWER: waiting for host */}
      {showWaiting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black p-6">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
              <Loader2 className="h-7 w-7 animate-spin text-white/50" />
            </div>
            <p className="text-sm font-medium text-white/70">
              Waiting for host to start the movie…
            </p>
            <p className="mt-1 text-xs text-white/40">
              The stream will appear here automatically.
            </p>
          </div>
        </div>
      )}

      {/* VIEWER: connecting */}
      {showConnecting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black p-6">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-violet-500/10">
              <Radio className="h-7 w-7 animate-pulse text-violet-400" />
            </div>
            <p className="text-sm font-medium text-white">
              Connecting to host&apos;s stream…
            </p>
            <p className="mt-1 text-xs text-white/50">
              {streamingFileName ? `Waiting for "${streamingFileName}"` : "Establishing WebRTC connection"}
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {webrtc.error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6">
          <div className="max-w-md text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-rose-400" />
            <p className="text-sm font-medium text-white">Streaming error</p>
            <p className="mt-1 text-xs text-white/60">{webrtc.error}</p>
          </div>
        </div>
      )}

      {/* Status bar (top) */}
      <div className="absolute left-3 top-3 flex items-center gap-2">
        {isHost ? (
          <Badge variant="secondary" className="gap-1 bg-violet-600 text-white backdrop-blur">
            <Radio className="h-3 w-3" /> Hosting
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1 bg-emerald-600 text-white backdrop-blur">
            <Wifi className="h-3 w-3" /> Live
          </Badge>
        )}
        {webrtc.peers.length > 0 && (
          <Badge variant="secondary" className="gap-1 bg-black/60 text-white backdrop-blur">
            <Wifi className="h-3 w-3" /> {webrtc.peers.length} peer{webrtc.peers.length !== 1 ? "s" : ""}
          </Badge>
        )}
        {webrtc.fileName && (
          <Badge variant="secondary" className="max-w-[200px] truncate bg-black/60 text-white backdrop-blur">
            {webrtc.fileName}
          </Badge>
        )}
      </div>

      {/* Controls (bottom) — host only, viewers can't control live stream */}
      {isHost && ready && showControls && (
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
              <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="text-white hover:bg-white/10">
                <Maximize className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Viewer: tap-to-unmute overlay (autoplay policy) */}
      {!isHost && webrtc.remoteStream && muted && (
        <button
          className="absolute inset-0 flex items-center justify-center bg-black/40"
          onClick={() => {
            const v = videoRef.current;
            if (v) { v.muted = false; setMuted(false); }
          }}
        >
          <div className="rounded-full bg-white/10 p-4 backdrop-blur">
            <Volume2 className="h-8 w-8 text-white" />
          </div>
        </button>
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
