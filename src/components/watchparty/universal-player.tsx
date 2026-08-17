"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { PlaybackState, youtubeId } from "@/lib/sync/types";
import { useVideoController } from "@/lib/sync/use-video-controller";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Loader2,
  SkipForward,
  AlertCircle,
  ExternalLink,
  Upload,
} from "lucide-react";

interface UniversalPlayerProps {
  playback: PlaybackState | null;
  clockOffset: number;
  onIntent: (patch: Partial<{
    isPlaying: boolean;
    currentTime: number;
    playbackRate: number;
  }>) => void;
  onNext?: () => void;
  hasNext?: boolean;
  localFile?: { url: string; name: string } | null;
  onLoadLocalFile?: (url: string, name: string) => void;
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

export function UniversalPlayer({
  playback,
  clockOffset,
  onIntent,
  onNext,
  hasNext,
  localFile,
  onLoadLocalFile,
  cmdPlay,
  cmdPause,
  cmdSeek,
  cmdTs,
  remoteCmd,
  tsMap,
  userId,
}: UniversalPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [localTime, setLocalTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoType = playback?.videoType || "";
  const effectiveVideoUrl = videoType === "file"
    ? (localFile?.url || "")
    : (playback?.videoUrl || "");
  const videoUrl = effectiveVideoUrl;
  const ytid = videoType === "youtube" ? youtubeId(videoUrl) : null;
  const isNativeVideo = ["mp4", "webm", "hls", "ogg", "file"].includes(videoType);

  useVideoController({
    videoRef,
    playback: isNativeVideo ? playback : null,
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

  // ── HLS setup ──
  useEffect(() => {
    if (videoType !== "hls") return;
    const v = videoRef.current;
    if (!v || !videoUrl) return;
    setError(null);
    setReady(false);

    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = videoUrl;
      v.load();
      const onLoaded = () => setReady(true);
      v.addEventListener("loadedmetadata", onLoaded, { once: true });
      return () => v.removeEventListener("loadedmetadata", onLoaded);
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(videoUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => setReady(true));
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          setError(`HLS error: ${data.type} / ${data.details}`);
        }
      });
      return () => {
        hls.destroy();
      };
    }
    setError("HLS not supported in this browser");
  }, [videoType, videoUrl]);

  // ── Direct video (mp4/webm/ogg/file) ──
  useEffect(() => {
    if (!["mp4", "webm", "ogg", "file"].includes(videoType)) return;
    const v = videoRef.current;
    if (!v || !videoUrl) return;
    setError(null);
    setReady(false);
    v.src = videoUrl;
    v.load();
    const onLoaded = () => {
      setReady(true);
      setDuration(v.duration || 0);
    };
    v.addEventListener("loadedmetadata", onLoaded, { once: true });
    v.addEventListener("canplay", onLoaded, { once: true });
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("canplay", onLoaded);
    };
  }, [videoType, videoUrl]);

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
    if (v) {
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      v.muted = !v.muted;
      setMuted(v.muted);
    }
  }, []);

  const onVolumeChange = useCallback((val: number[]) => {
    const v = videoRef.current;
    const next = val[0] ?? 1;
    setVolume(next);
    if (v) {
      v.volume = next;
      v.muted = next === 0;
      setMuted(next === 0);
    }
  }, []);

  const onSeek = useCallback(
    (val: number[]) => {
      const v = videoRef.current;
      const target = val[0] ?? 0;
      setLocalTime(target);
      if (v) {
        v.currentTime = target;
      }
      onIntent({ currentTime: target });
    },
    [onIntent],
  );

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const bumpControls = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (playback?.isPlaying) setShowControls(false);
    }, 2800);
  }, [playback?.isPlaying]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && onLoadLocalFile) {
      const url = URL.createObjectURL(f);
      onLoadLocalFile(url, f.name);
    }
  };

  // ── Render: Empty / File Prompt state ──
  if (!playback?.videoUrl && videoType !== "file") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Play className="h-8 w-8 fill-current translate-x-0.5" />
        </div>
        <h3 className="mt-4 text-base font-semibold">No video loaded</h3>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Paste a YouTube, HLS (.m3u8), MP4 link above, or choose a local file to sync with the room.
        </p>
      </div>
    );
  }

  // ── Render: Local file mode prompt when file is not yet loaded on this client ──
  if (videoType === "file" && !localFile?.url) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center bg-zinc-950">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
          <Upload className="h-8 w-8" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-white">Local Movie Sync</h3>
        <p className="mt-1 max-w-md text-xs text-zinc-400">
          The host is playing <span className="font-semibold text-amber-400">&ldquo;{playback?.fileName || "a local movie"}&rdquo;</span>.
          Select your local copy of this file to sync playback perfectly without uploading.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          className="mt-4 gap-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-semibold"
        >
          <Upload className="h-4 w-4" /> Load Local File
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      onMouseMove={bumpControls}
      onClick={bumpControls}
      className="group relative flex h-full w-full items-center justify-center bg-black overflow-hidden select-none"
    >
      {/* ── Strict 16:9 widescreen stage container ── */}
      <div className="relative w-full h-full max-w-[calc(100vh*16/9)] max-h-[calc(100vw*9/16)] aspect-video flex items-center justify-center bg-black">
        {videoType === "youtube" && ytid ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${ytid}?autoplay=${
              playback?.isPlaying ? 1 : 0
            }&start=${Math.floor(playback?.currentTime || 0)}&enablejsapi=1&controls=1`}
            title="YouTube Player"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full border-0 pointer-events-auto"
          />
        ) : isNativeVideo ? (
          <video
            ref={videoRef}
            playsInline
            className="h-full w-full object-contain pointer-events-auto cursor-pointer"
            onClick={togglePlay}
          />
        ) : (
          <iframe
            src={`/api/proxy?url=${encodeURIComponent(videoUrl)}`}
            title="Embedded Player"
            sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
            allow="autoplay; fullscreen; encrypted-media"
            className="h-full w-full border-0"
          />
        )}

        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 p-4 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="mt-2 text-xs font-medium text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 text-xs"
              onClick={() => window.open(videoUrl, "_blank")}
            >
              <ExternalLink className="mr-1.5 h-3 w-3" /> Open directly
            </Button>
          </div>
        )}
      </div>

      {/* ── Floating Controls Bar (Native Video) ── */}
      {isNativeVideo && (
        <div
          className={`absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 transition-opacity duration-300 ${
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          {/* Timeline scrubber */}
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-mono text-zinc-300">
              {fmtTime(localTime)}
            </span>
            <Slider
              value={[localTime]}
              max={duration > 0 ? duration : 100}
              step={0.5}
              onValueChange={onSeek}
              className="flex-1 cursor-pointer"
            />
            <span className="text-[11px] font-mono text-zinc-400">
              {fmtTime(duration)}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white hover:bg-white/20"
                onClick={togglePlay}
              >
                {playback?.isPlaying ? (
                  <Pause className="h-4 w-4 fill-current" />
                ) : (
                  <Play className="h-4 w-4 fill-current" />
                )}
              </Button>

              {hasNext && onNext && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={onNext}
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
              )}

              <div className="flex items-center gap-1.5 pl-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={toggleMute}
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </Button>
                <div className="w-20">
                  <Slider
                    value={[muted ? 0 : volume]}
                    max={1}
                    step={0.05}
                    onValueChange={onVolumeChange}
                    className="cursor-pointer"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white hover:bg-white/20"
                onClick={toggleFullscreen}
              >
                {fullscreen ? (
                  <Minimize className="h-4 w-4" />
                ) : (
                  <Maximize className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
