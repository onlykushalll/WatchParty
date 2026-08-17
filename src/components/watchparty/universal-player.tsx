"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Hls from "hls.js";
import { PlaybackState, youtubeId } from "@/lib/sync/types";
import { useVideoController } from "@/lib/sync/use-video-controller";
import {
  computeFastFileFingerprint,
  evaluateFileMatch,
  FileFingerprint,
  FileMatchStatus,
} from "@/lib/sync/file-fingerprint";
import {
  parseSRT,
  mountSubtitleTrack,
  applyLiveSubtitleOffset,
  SubtitleCue,
} from "@/lib/sync/subtitle-engine";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Upload,
  AlertCircle,
  ExternalLink,
  Subtitles,
  ShieldCheck,
  AlertTriangle,
  FileQuestion,
  Tv,
  Check,
  SlidersHorizontal,
} from "lucide-react";

interface UniversalPlayerProps {
  playback: PlaybackState | null;
  clockOffset: number;
  onIntent: (patch: Partial<{
    isPlaying: boolean;
    currentTime: number;
    playbackRate: number;
    videoUrl?: string;
    videoType?: string;
    fileName?: string;
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
  const srtInputRef = useRef<HTMLInputElement>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);
  const [localTime, setLocalTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [hudMessage, setHudMessage] = useState<string | null>(null);

  // File Fingerprinting & Match State
  const [localFingerprint, setLocalFingerprint] = useState<FileFingerprint | null>(null);
  const hostFingerprint = useMemo<FileFingerprint | null>(() => {
    if (playback?.fileName) {
      return {
        hash: "",
        size: 0,
        name: playback.fileName,
      };
    }
    return null;
  }, [playback?.fileName]);

  const [matchStatus, setMatchStatus] = useState<FileMatchStatus>("FILE_MISSING");

  // Subtitle Engine State
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [activeTextTrack, setActiveTextTrack] = useState<TextTrack | null>(null);
  const [subDelayMs, setSubDelayMs] = useState(0);
  const [subsVisible, setSubsVisible] = useState(true);
  const [showSubSettings, setShowSubSettings] = useState(false);

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoType = playback?.videoType || "";
  const effectiveVideoUrl =
    videoType === "file" ? localFile?.url || "" : playback?.videoUrl || "";
  const videoUrl = effectiveVideoUrl;
  const ytid = videoType === "youtube" ? youtubeId(videoUrl) : null;
  const isNativeVideo = ["mp4", "webm", "ogg", "file", "hls"].includes(videoType);

  // HUD Toast Trigger
  const triggerHud = useCallback((msg: string) => {
    setHudMessage(msg);
    if (hudTimer.current) clearTimeout(hudTimer.current);
    hudTimer.current = setTimeout(() => setHudMessage(null), 1300);
  }, []);

  // Syncplay Controller integration
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

  // ── Local File Verification ──
  useEffect(() => {
    if (videoType !== "file") {
      setMatchStatus("MATCHED");
      return;
    }
    if (!localFile?.url) {
      setMatchStatus("FILE_MISSING");
      return;
    }
    if (localFingerprint && playback?.fileName) {
      if (localFingerprint.name.toLowerCase() === playback.fileName.toLowerCase()) {
        setMatchStatus("MATCHED");
      } else {
        setMatchStatus("DIFFERENT_RELEASE");
      }
    } else {
      setMatchStatus("MATCHED");
    }
  }, [videoType, localFile, localFingerprint, playback?.fileName]);

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
      if (v.paused) {
        v.play().catch(() => {});
        onIntent({ isPlaying: true, currentTime: v.currentTime });
        triggerHud("Play");
      } else {
        v.pause();
        onIntent({ isPlaying: false, currentTime: v.currentTime });
        triggerHud("Pause");
      }
    }
  }, [onIntent, triggerHud]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      v.muted = !v.muted;
      setMuted(v.muted);
      triggerHud(v.muted ? "Muted" : "Unmuted");
    }
  }, [triggerHud]);

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
      triggerHud("Fullscreen");
    } else {
      document.exitFullscreen().catch(() => {});
      triggerHud("Exit Fullscreen");
    }
  }, [triggerHud]);

  const toggleTheater = useCallback(() => {
    setTheaterMode((prev) => {
      const next = !prev;
      triggerHud(next ? "Theater Mode" : "Standard View");
      return next;
    });
  }, [triggerHud]);

  const bumpControls = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (playback?.isPlaying && !showSubSettings) setShowControls(false);
    }, 2800);
  }, [playback?.isPlaying, showSubSettings]);

  // ── Handle Local Video File Select & Compute Fingerprint ──
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fp = await computeFastFileFingerprint(f);
    setLocalFingerprint(fp);
    const url = URL.createObjectURL(f);
    if (onLoadLocalFile) {
      onLoadLocalFile(url, f.name);
    }
    triggerHud(`Loaded: ${f.name}`);
  };

  // ── Handle Subtitle File Ingestion ──
  const handleSrtSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !videoRef.current) return;
    const text = await file.text();
    const cues = parseSRT(text);
    setSubtitleCues(cues);

    const track = mountSubtitleTrack(
      videoRef.current,
      cues,
      file.name,
      subDelayMs / 1000,
    );
    setActiveTextTrack(track);
    setSubsVisible(true);
    triggerHud(`Subtitles: ${file.name}`);
  };

  const modifySubDelay = useCallback(
    (deltaMs: number) => {
      setSubDelayMs((prev) => {
        const next = Math.max(-10000, Math.min(10000, prev + deltaMs));
        if (activeTextTrack && subtitleCues.length > 0) {
          applyLiveSubtitleOffset(activeTextTrack, subtitleCues, next / 1000);
        }
        triggerHud(`Sub Offset: ${next >= 0 ? "+" : ""}${next}ms`);
        return next;
      });
    },
    [activeTextTrack, subtitleCues, triggerHud],
  );

  const toggleSubtitles = useCallback(() => {
    if (!activeTextTrack) {
      srtInputRef.current?.click();
      return;
    }
    setSubsVisible((prev) => {
      const next = !prev;
      activeTextTrack.mode = next ? "showing" : "hidden";
      triggerHud(next ? "Captions ON" : "Captions OFF");
      return next;
    });
  }, [activeTextTrack, triggerHud]);

  // ── Keyboard Shortcuts Engine ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.closest("[role='dialog']"))
      ) {
        return;
      }

      const v = videoRef.current;
      if (!v) return;

      switch (e.code) {
        case "Space":
        case "KeyK":
          e.preventDefault();
          togglePlay();
          break;

        case "ArrowLeft":
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - 5);
          onIntent({ currentTime: v.currentTime });
          triggerHud("-5s");
          break;

        case "ArrowRight":
          e.preventDefault();
          v.currentTime = Math.min(v.duration || 10000, v.currentTime + 5);
          onIntent({ currentTime: v.currentTime });
          triggerHud("+5s");
          break;

        case "KeyJ":
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - 10);
          onIntent({ currentTime: v.currentTime });
          triggerHud("-10s");
          break;

        case "KeyL":
          e.preventDefault();
          v.currentTime = Math.min(v.duration || 10000, v.currentTime + 10);
          onIntent({ currentTime: v.currentTime });
          triggerHud("+10s");
          break;

        case "ArrowUp":
          e.preventDefault();
          v.volume = Math.min(1, v.volume + 0.05);
          v.muted = false;
          setVolume(v.volume);
          setMuted(false);
          triggerHud(`Volume ${Math.round(v.volume * 100)}%`);
          break;

        case "ArrowDown":
          e.preventDefault();
          v.volume = Math.max(0, v.volume - 0.05);
          setVolume(v.volume);
          triggerHud(`Volume ${Math.round(v.volume * 100)}%`);
          break;

        case "KeyM":
          e.preventDefault();
          toggleMute();
          break;

        case "KeyF":
          e.preventDefault();
          toggleFullscreen();
          break;

        case "KeyT":
          e.preventDefault();
          toggleTheater();
          break;

        case "KeyC":
          e.preventDefault();
          toggleSubtitles();
          break;

        case "BracketLeft":
          e.preventDefault();
          modifySubDelay(-50);
          break;

        case "BracketRight":
          e.preventDefault();
          modifySubDelay(50);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    togglePlay,
    toggleMute,
    toggleFullscreen,
    toggleTheater,
    toggleSubtitles,
    modifySubDelay,
    onIntent,
    triggerHud,
  ]);

  // ── Render: Empty state ──
  if (!playback?.videoUrl && videoType !== "file") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Play className="h-8 w-8 fill-current translate-x-0.5" />
        </div>
        <h3 className="mt-4 text-base font-semibold">No video loaded</h3>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Paste a YouTube, HLS (.m3u8), MP4 link, or select a local movie file to sync with your room.
        </p>
      </div>
    );
  }

  // ── Render: Local file mode prompt when file is not yet loaded on this client ──
  if (videoType === "file" && !localFile?.url) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center bg-zinc-950">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 animate-pulse">
          <Upload className="h-8 w-8" />
        </div>
        <h3 className="mt-4 text-base font-bold text-white">Local Movie Sync</h3>
        <p className="mt-1 max-w-md text-xs text-zinc-400">
          The host is playing{" "}
          <span className="font-semibold text-amber-300 font-mono">
            &ldquo;{playback?.fileName || "a local movie"}&rdquo;
          </span>
          . Select your local copy of this file to sync playback perfectly with zero uploading.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,.mkv,.mp4,.webm,.avi"
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          className="mt-4 gap-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold px-6 py-2 rounded-xl"
        >
          <Upload className="h-4 w-4" /> Load Local Copy
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      onMouseMove={bumpControls}
      onClick={bumpControls}
      className={`group relative flex h-full w-full items-center justify-center bg-black overflow-hidden select-none transition-all ${
        theaterMode ? "w-full h-full" : "w-full h-full"
      }`}
    >
      {/* ── Cinema HUD Feedback Overlay ── */}
      {hudMessage && (
        <div className="absolute top-12 z-50 pointer-events-none rounded-full bg-black/85 px-4 py-2 text-xs font-bold text-white backdrop-blur border border-white/10 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
          {hudMessage}
        </div>
      )}

      {/* ── Subtitle File Hidden Input ── */}
      <input
        ref={srtInputRef}
        type="file"
        accept=".srt,.vtt"
        className="hidden"
        onChange={handleSrtSelect}
      />

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

      {/* ── Top File Verification & Subtitle Badges (Native / Local File) ── */}
      {isNativeVideo && (
        <div className="absolute top-4 left-4 z-40 flex items-center gap-2 pointer-events-none">
          {videoType === "file" && (
            <Badge
              variant="secondary"
              className={`gap-1.5 backdrop-blur shadow-sm px-2.5 py-1 text-[11px] ${
                matchStatus === "MATCHED"
                  ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-400"
                  : matchStatus === "DIFFERENT_RELEASE"
                    ? "bg-amber-500/20 border border-amber-500/40 text-amber-300"
                    : "bg-rose-500/20 border border-rose-500/40 text-rose-300"
              }`}
            >
              {matchStatus === "MATCHED" ? (
                <>
                  <ShieldCheck className="h-3 w-3 text-emerald-400" />
                  <span>Exact File Sync</span>
                </>
              ) : matchStatus === "DIFFERENT_RELEASE" ? (
                <>
                  <AlertTriangle className="h-3 w-3 text-amber-400" />
                  <span>File Release Match</span>
                </>
              ) : (
                <>
                  <FileQuestion className="h-3 w-3 text-rose-400" />
                  <span>Different File</span>
                </>
              )}
            </Badge>
          )}

          {subtitleCues.length > 0 && (
            <Badge
              variant="outline"
              className="gap-1 bg-black/60 border-white/20 text-zinc-300 text-[10px]"
            >
              <Subtitles className="h-3 w-3 text-primary" />
              <span>
                Subs {subDelayMs !== 0 ? `(${subDelayMs > 0 ? "+" : ""}${subDelayMs}ms)` : "Active"}
              </span>
            </Badge>
          )}
        </div>
      )}

      {/* ── Subtitle Delay Slider Popover Panel ── */}
      {showSubSettings && isNativeVideo && (
        <div className="absolute right-4 bottom-20 z-50 w-72 rounded-2xl border border-zinc-800 bg-zinc-950/95 p-4 text-xs text-white backdrop-blur shadow-2xl">
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold flex items-center gap-1.5">
              <Subtitles className="h-4 w-4 text-primary" /> Subtitle Offset
            </span>
            <span className="font-mono text-zinc-400">
              {subDelayMs >= 0 ? `+${subDelayMs}` : subDelayMs}ms
            </span>
          </div>

          <Slider
            value={[subDelayMs]}
            min={-5000}
            max={5000}
            step={50}
            onValueChange={(val) => {
              const diff = val[0] - subDelayMs;
              modifySubDelay(diff);
            }}
            className="mb-3"
          />

          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-[10px] flex-1"
              onClick={() => modifySubDelay(-100)}
            >
              -100ms
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-[10px] flex-1"
              onClick={() => modifySubDelay(100)}
            >
              +100ms
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[10px]"
              onClick={() => modifySubDelay(-subDelayMs)}
            >
              Reset
            </Button>
          </div>
        </div>
      )}

      {/* ── Floating Controls Bar (Native Video) ── */}
      {isNativeVideo && (
        <div
          className={`absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 transition-opacity duration-300 ${
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          {/* Timeline scrubber */}
          <div className="mb-2 flex items-center gap-3">
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

              {hasNext && (
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

            <div className="flex items-center gap-1.5">
              {/* Load Subtitle Button */}
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 gap-1.5 px-2.5 text-xs text-white hover:bg-white/20 ${
                  subtitleCues.length > 0 ? "text-primary" : ""
                }`}
                onClick={toggleSubtitles}
              >
                <Subtitles className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {subtitleCues.length > 0
                    ? subsVisible
                      ? "CC On"
                      : "CC Off"
                    : "Add Subs"}
                </span>
              </Button>

              {subtitleCues.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={() => setShowSubSettings((p) => !p)}
                  title="Subtitle Sync Offset"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </Button>
              )}

              {/* Theater Mode Button */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white hover:bg-white/20"
                onClick={toggleTheater}
                title="Theater Mode (T)"
              >
                <Tv className="h-4 w-4" />
              </Button>

              {/* Fullscreen Button */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white hover:bg-white/20"
                onClick={toggleFullscreen}
                title="Fullscreen (F)"
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

function SkipForward({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M5.25 4.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-1.5 0V5.25a.75.75 0 0 1 .75-.75Zm13.5 0a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-1.5 0V5.25a.75.75 0 0 1 .75-.75Zm-6.75 6.44 5.303-3.314a.75.75 0 0 1 1.197.634v7.48a.75.75 0 0 1-1.197.634L12 12.94v2.81a.75.75 0 0 1-1.197.634L5.45 12.634a.75.75 0 0 1 0-1.268l5.353-3.75A.75.75 0 0 1 12 8.25v2.69Z" />
    </svg>
  );
}
