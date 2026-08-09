"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { PlaybackState, detectVideoType, youtubeId } from "@/lib/sync/types";
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
}: UniversalPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
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
  const videoUrl = playback?.videoUrl || "";
  const ytid = videoType === "youtube" ? youtubeId(videoUrl) : null;
  const isNativeVideo = ["mp4", "webm", "hls", "ogg"].includes(videoType);

  // Use the controller for <video>-based sources only.
  useVideoController({
    videoRef,
    playback: isNativeVideo ? playback : null,
    clockOffset,
    onIntent,
  });

  // ── HLS setup ──
  useEffect(() => {
    if (videoType !== "hls") return;
    const v = videoRef.current;
    if (!v || !videoUrl) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setReady(false);

    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS (Safari).
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
  }, [videoType, videoUrl, videoRef]);

  // ── Direct video (mp4/webm/ogg) ──
  useEffect(() => {
    if (!["mp4", "webm", "ogg"].includes(videoType)) return;
    const v = videoRef.current;
    if (!v || !videoUrl) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setReady(false);
    v.src = videoUrl;
    v.load();
    const onLoaded = () => {
      setReady(true);
      setDuration(v.duration || 0);
    };
    v.addEventListener("loadedmetadata", onLoaded, { once: true });
    return () => v.removeEventListener("loadedmetadata", onLoaded);
  }, [videoType, videoUrl, videoRef]);

  // ── Track local time for the progress slider ──
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
  }, [videoRef]);

  // ── Fullscreen tracking ──
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
    } else {
      // YouTube / iframe: send intent only.
      onIntent({ isPlaying: !playback?.isPlaying });
    }
  }, [videoRef, onIntent, playback]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      v.muted = !v.muted;
      setMuted(v.muted);
    }
  }, [videoRef]);

  const onVolumeChange = useCallback((vol: number) => {
    setVolume(vol);
    const v = videoRef.current;
    if (v) {
      v.volume = vol;
      v.muted = vol === 0;
      setMuted(vol === 0);
    }
  }, [videoRef]);

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

  // ── Auto-hide controls ──
  const pokeControls = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (playback?.isPlaying) setShowControls(false);
    }, 3000);
  }, [playback?.isPlaying]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    pokeControls();
  }, [pokeControls, playback?.isPlaying]);

  // ── Empty state ──
  if (!playback || !videoUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
            <Play className="h-7 w-7 text-white/30" />
          </div>
          <p className="text-sm text-white/40">No video loaded yet</p>
          <p className="mt-1 text-xs text-white/30">
            Paste a URL above to start watching together
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="group relative h-full w-full overflow-hidden bg-black"
      onMouseMove={pokeControls}
      onMouseLeave={() => playback.isPlaying && setShowControls(false)}
    >
      {/* ── YouTube ── */}
      {videoType === "youtube" && ytid && (
        <YouTubePlayer
          videoId={ytid}
          playback={playback}
          clockOffset={clockOffset}
          onIntent={onIntent}
        />
      )}

      {/* ── HLS / MP4 / WebM ── */}
      {["hls", "mp4", "webm", "ogg"].includes(videoType) && (
        <>
          <video
            ref={videoRef}
            className="h-full w-full bg-black"
            playsInline
            onClick={togglePlay}
            onDoubleClick={toggleFullscreen}
          />
          {!ready && !error && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="h-8 w-8 animate-spin text-white/70" />
            </div>
          )}
        </>
      )}

      {/* ── Iframe portal (any other URL via proxy) ── */}
      {videoType === "iframe" && (
        <IframePortal
          url={videoUrl}
          onError={setError}
        />
      )}

      {/* ── Error overlay ── */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6">
          <div className="max-w-md text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-rose-400" />
            <p className="text-sm font-medium text-white">Playback error</p>
            <p className="mt-1 text-xs text-white/60">{error}</p>
          </div>
        </div>
      )}

      {/* ── Custom controls (only for native video) ── */}
      {["hls", "mp4", "webm", "ogg"].includes(videoType) && (
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200 ${
            showControls ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* Progress bar */}
          <Slider
            value={[localTime]}
            max={duration || 0}
            min={0}
            step={0.1}
            onValueChange={onSeek}
            className="mb-2 cursor-pointer"
          />
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-white hover:bg-white/10"
              onClick={togglePlay}
            >
              {playback.isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
            {hasNext && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-white hover:bg-white/10"
                onClick={onNext}
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            )}
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-white hover:bg-white/10"
                onClick={toggleMute}
              >
                {muted || volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </Button>
              <Slider
                value={[muted ? 0 : volume * 100]}
                max={100}
                step={1}
                onValueChange={(v) => onVolumeChange(v[0] / 100)}
                className="w-20"
              />
            </div>
            <span className="ml-1 font-mono text-[11px] text-white/70">
              {fmtTime(localTime)} / {fmtTime(duration)}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                ● SYNC
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-white hover:bg-white/10"
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

      {/* ── Iframe controls (minimal — we can't control inside iframe) ── */}
      {videoType === "iframe" && (
        <div className="absolute right-2 top-2 flex items-center gap-1.5">
          <a
            href={videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/80 backdrop-blur hover:bg-black/80"
          >
            <ExternalLink className="h-3 w-3" /> open
          </a>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── YouTube ─────────────────────────── */

function YouTubePlayer({
  videoId,
  playback,
  clockOffset,
  onIntent,
}: {
  videoId: string;
  playback: PlaybackState;
  clockOffset: number;
  onIntent: (patch: Partial<{
    isPlaying: boolean;
    currentTime: number;
    playbackRate: number;
  }>) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const containerId = useRef(`yt-${Math.random().toString(36).slice(2, 8)}`).current;
  const playerRef = useRef<YT.Player | null>(null);
  const guardRef = useRef(false);
  const lastSeq = useRef(-1);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep latest playback + clockOffset in refs so onReady can access them
  // without being stale (the effect only re-runs on videoId change).
  const latestPlayback = useRef(playback);
  const latestClockOffset = useRef(clockOffset);
  latestPlayback.current = playback;
  latestClockOffset.current = clockOffset;

  // Load YouTube IFrame API once.
  useEffect(() => {
    if (window.YT && window.YT.Player) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReady(true);
      return;
    }
    // Defer script loading to avoid React 19 "script tag during render" error
    queueMicrotask(() => {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.async = true;
      document.body.appendChild(tag);
      (window as any).onYouTubeIframeAPIReady = () => setReady(true);
    });
    return () => {
      // leave the global callback; other components might need it
    };
  }, []);

  // Create / refresh player when videoId changes.
  useEffect(() => {
    if (!ready || !containerRef.current) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    guardRef.current = true;

    const el = document.createElement("div");
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(el);

    playerRef.current = new window.YT.Player(el, {
      videoId,
      width: "100%",
      height: "100%",
      playerVars: {
        autoplay: 0,
        controls: 1,
        disablekb: 0,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          try {
            const pb = latestPlayback.current;
            const co = latestClockOffset.current;
            playerRef.current?.setPlaybackRate(pb.playbackRate || 1);
            // CRITICAL: immediately sync to current room state so late
            // joiners land on the same position as everyone else.
            const serverNow = Date.now() + co;
            const elapsed = pb.isPlaying
              ? (serverNow - pb.lastChangedAt) / 1000
              : 0;
            const expectedTime = pb.currentTime + elapsed;
            playerRef.current?.seekTo(expectedTime, true);
            if (pb.isPlaying) {
              playerRef.current?.playVideo();
            } else {
              playerRef.current?.pauseVideo();
            }
            lastSeq.current = pb.seq;
          } catch {}
          queueMicrotask(() => { guardRef.current = false; });
        },
        onStateChange: (e: YT.OnStateChangeEvent) => {
          if (guardRef.current) return;
          const p = playerRef.current;
          if (!p) return;
          if (e.data === window.YT.PlayerState.PLAYING) {
            onIntent({ isPlaying: true, currentTime: p.getCurrentTime() });
          } else if (e.data === window.YT.PlayerState.PAUSED) {
            onIntent({ isPlaying: false, currentTime: p.getCurrentTime() });
          }
        },
        onError: () => setError("YouTube video could not be loaded"),
      },
    });

    return () => {
      try { playerRef.current?.destroy(); } catch {}
      playerRef.current = null;
    };
  }, [ready, videoId]);

  // Apply authoritative state.
  useEffect(() => {
    if (!playerRef.current || !ready) return;
    if (playback.seq === lastSeq.current) return;
    lastSeq.current = playback.seq;

    guardRef.current = true;
    const p = playerRef.current;
    const serverNow = Date.now() + clockOffset;
    const elapsed = playback.isPlaying ? (serverNow - playback.lastChangedAt) / 1000 : 0;
    const expected = playback.currentTime + elapsed;

    try {
      const actual = p.getCurrentTime();
      if (Math.abs(actual - expected) > 1.0) {
        p.seekTo(expected, true);
      }
      p.setPlaybackRate(playback.playbackRate || 1);
      if (playback.isPlaying) p.playVideo();
      else p.pauseVideo();
    } catch {}
    queueMicrotask(() => { guardRef.current = false; });
  }, [playback, clockOffset, ready]);

  // Periodic drift check.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p || guardRef.current || !playback.isPlaying) return;
      try {
        const serverNow = Date.now() + clockOffset;
        const elapsed = (serverNow - playback.lastChangedAt) / 1000;
        const expected = playback.currentTime + elapsed * (playback.playbackRate || 1);
        const actual = p.getCurrentTime();
        if (Math.abs(actual - expected) > 1.5) {
          guardRef.current = true;
          p.seekTo(expected, true);
          queueMicrotask(() => { guardRef.current = false; });
        }
      } catch {}
    }, 2000);
    return () => clearInterval(id);
  }, [ready, playback, clockOffset]);

  return (
    <div className="h-full w-full bg-black">
      <style>{`#${containerId} iframe { width: 100% !important; height: 100% !important; position: absolute !important; top: 0 !important; left: 0 !important; }`}</style>
      <div id={containerId} ref={containerRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-rose-400" />
            <p className="text-sm text-white">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────��───────────────── Iframe portal ─────────────────────────── */

function IframePortal({ url, onError }: { url: string; onError: (e: string) => void }) {
  // Route through our /api/proxy to strip X-Frame-Options + follow redirects.
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
  return (
    <iframe
      src={proxyUrl}
      className="h-full w-full border-0 bg-white"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowFullScreen
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
      onError={() => onError("Failed to load in iframe")}
      title="Embedded content"
    />
  );
}

/* ─────────────────────────── YT types ─────────────────────────── */

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}
