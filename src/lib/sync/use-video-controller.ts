"use client";

import { useEffect, useRef, RefObject } from "react";
import { PlaybackState } from "./types";

interface UseVideoControllerArgs {
  videoRef: RefObject<HTMLVideoElement | null>;
  playback: PlaybackState | null;
  clockOffset: number;
  onIntent: (patch: Partial<{
    isPlaying: boolean;
    currentTime: number;
    playbackRate: number;
  }>) => void;
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

const SOFT_BAND_MS = 125;
const RATE_BAND_MS = 750;
const HARD_SEEK_MS = 1500;
const MIN_RATE = 0.96;
const MAX_RATE = 1.04;

export function useVideoController({
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
}: UseVideoControllerArgs) {
  const guardRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAppliedSeq = useRef(-1);
  const lastAppliedPlay = useRef<string | null>(null);
  const lastAppliedPause = useRef<string | null>(null);
  const lastAppliedSeek = useRef<string | null>(null);
  const driftSamplesRef = useRef<number[]>([]);
  const rafIdRef = useRef<number>(0);
  const clockOffsetRef = useRef(clockOffset);
  clockOffsetRef.current = clockOffset;
  const playbackRef = useRef(playback);
  playbackRef.current = playback;

  // Set preservesPitch
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    (videoEl as any).preservesPitch = true;
    try { (videoEl as any).webkitPreservesPitch = true; } catch {}
  }, [videoRef]);

  // ── Apply remote commands (REC:play/pause/seek) ──
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !remoteCmd) return;

    if (remoteCmd.play) {
      const key = remoteCmd.play.by + ":" + remoteCmd.play.ts;
      if (lastAppliedPlay.current !== key) {
        lastAppliedPlay.current = key;
        if (videoEl.paused) {
          videoEl.play().catch(() => {
            videoEl.muted = true;
            videoEl.play().catch(() => {});
          });
        }
      }
    }
    if (remoteCmd.pause) {
      const key = remoteCmd.pause.by + ":" + remoteCmd.pause.ts;
      if (lastAppliedPause.current !== key) {
        lastAppliedPause.current = key;
        if (!videoEl.paused) videoEl.pause();
      }
    }
    if (remoteCmd.seek) {
      const key = remoteCmd.seek.by + ":" + remoteCmd.seek.time;
      if (lastAppliedSeek.current !== key) {
        lastAppliedSeek.current = key;
        try { videoEl.currentTime = remoteCmd.seek.time; } catch {}
        if (remoteCmd.seek.playing && videoEl.paused) {
          videoEl.play().catch(() => {
            videoEl.muted = true;
            videoEl.play().catch(() => {});
          });
        } else if (!remoteCmd.seek.playing && !videoEl.paused) {
          videoEl.pause();
        }
      }
    }
  }, [videoRef, remoteCmd]);

  // ── Outgoing events ──
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const flush = () => {
      const patch: Record<string, unknown> = {
        currentTime: videoEl.currentTime,
      };
      if (!videoEl.paused) patch.isPlaying = true;
      onIntent(patch);
    };

    const onPlay = () => {
      if (cmdPlay) cmdPlay();
      if (guardRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flush, 200);
    };

    const onPause = () => {
      if (cmdPause) cmdPause();
      if (guardRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      onIntent({ isPlaying: false, currentTime: videoEl.currentTime });
    };

    const onSeeked = () => {
      if (cmdSeek) cmdSeek(videoEl.currentTime, !videoEl.paused);
      if (guardRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flush, 120);
    };

    const onWaiting = () => {
      if (guardRef.current) return;
      window.dispatchEvent(new CustomEvent("wp:buffer", {
        detail: { type: "waiting", position: videoEl.currentTime }
      }));
    };

    const onPlaying = () => {
      if (guardRef.current) return;
      window.dispatchEvent(new CustomEvent("wp:buffer", {
        detail: { type: "playing", position: videoEl.currentTime }
      }));
    };

    videoEl.addEventListener("play", onPlay);
    videoEl.addEventListener("pause", onPause);
    videoEl.addEventListener("seeked", onSeeked);
    videoEl.addEventListener("waiting", onWaiting);
    videoEl.addEventListener("playing", onPlaying);

    return () => {
      videoEl.removeEventListener("play", onPlay);
      videoEl.removeEventListener("pause", onPause);
      videoEl.removeEventListener("seeked", onSeeked);
      videoEl.removeEventListener("waiting", onWaiting);
      videoEl.removeEventListener("playing", onPlaying);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [videoRef, onIntent, cmdPlay, cmdPause, cmdSeek]);

  // ── Apply authoritative playback state ──
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !playback || playback.videoType === "youtube" || playback.videoType === "iframe") return;
    if (playback.seq === lastAppliedSeq.current) return;
    lastAppliedSeq.current = playback.seq;

    guardRef.current = true;

    const desiredRate = playback.playbackRate || 1;
    videoEl.playbackRate = desiredRate;

    const serverNow = Date.now() + clockOffset;
    const elapsedSinceChange = playback.isPlaying
      ? (serverNow - playback.lastChangedAt) / 1000
      : 0;
    const expectedTime = playback.currentTime + elapsedSinceChange;

    const actualTime = videoEl.currentTime;
    const delta = Math.abs(actualTime - expectedTime);

    if (delta > 1.5) {
      videoEl.currentTime = expectedTime;
    } else if (delta > 0.1) {
      if (actualTime < expectedTime) {
        videoEl.playbackRate = Math.max(desiredRate * 1.05, 0.1);
      } else {
        videoEl.playbackRate = Math.max(desiredRate * 0.95, 0.1);
      }
    } else {
      if (Math.abs(videoEl.playbackRate - desiredRate) > 0.01) {
        videoEl.playbackRate = desiredRate;
      }
    }

    if (playback.isPlaying && videoEl.paused) {
      videoEl.play().catch(() => {});
    } else if (!playback.isPlaying && !videoEl.paused) {
      videoEl.pause();
    }

    queueMicrotask(() => {
      guardRef.current = false;
    });
  }, [videoRef, playback, clockOffset]);

  // ── tsMap heartbeat ──
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !cmdTs) return;
    const id = setInterval(() => {
      if (videoEl.readyState >= 1) {
        cmdTs(videoEl.currentTime);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [videoRef, cmdTs]);

  // ── tsMap median drift corrector fallback ──
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !tsMap || !userId || !playback) return;
    const id = setInterval(() => {
      if (!videoEl || videoEl.paused || videoEl.readyState < 2) return;
      const others = Object.entries(tsMap)
        .filter(([uid]) => uid !== userId)
        .map(([, ts]) => ts)
        .filter((ts) => isFinite(ts) && ts > 0);
      if (others.length === 0) return;
      others.sort((a, b) => a - b);
      const median = others[Math.floor(others.length / 2)];
      const myTs = videoEl.currentTime;
      const drift = median - myTs;
      const driftMs = Math.abs(drift) * 1000;

      if (driftMs > 3000) {
        try { videoEl.currentTime = median; } catch {}
      } else if (driftMs > RATE_BAND_MS) {
        const targetRate = drift > 0 ? MAX_RATE : MIN_RATE;
        if (Math.abs(videoEl.playbackRate - targetRate) > 0.01) {
          videoEl.playbackRate = targetRate;
          (videoEl as any).preservesPitch = true;
        }
      } else {
        const desired = playback.playbackRate || 1;
        if (Math.abs(videoEl.playbackRate - desired) > 0.01) {
          videoEl.playbackRate = desired;
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [videoRef, tsMap, userId, playback]);

  // ── Precision frame drift sampler (requestVideoFrameCallback) ──
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !playback || !playback.isPlaying || playback.videoType === "youtube" || playback.videoType === "iframe") return;

    const computeExpected = (): number => {
      const pb = playbackRef.current;
      if (!pb) return 0;
      const co = clockOffsetRef.current;
      const serverNow = Date.now() + co;
      const elapsed = pb.isPlaying ? (serverNow - pb.lastChangedAt) / 1000 : 0;
      return pb.currentTime + elapsed * (pb.playbackRate || 1);
    };

    const correctDrift = (driftMs: number) => {
      if (guardRef.current) return;
      const videoEl2 = videoRef.current;
      if (!videoEl2) return;
      const abs = Math.abs(driftMs);

      if (abs < SOFT_BAND_MS) {
        const pb = playbackRef.current;
        const desiredRate = pb?.playbackRate || 1;
        if (Math.abs(videoEl2.playbackRate - desiredRate) > 0.001) {
          videoEl2.playbackRate = desiredRate;
        }
      } else if (abs < RATE_BAND_MS) {
        const targetRate = driftMs < 0
          ? Math.min(MAX_RATE, 1 + (abs / RATE_BAND_MS) * 0.04)
          : Math.max(MIN_RATE, 1 - (abs / RATE_BAND_MS) * 0.04);
        if (Math.abs(videoEl2.playbackRate - targetRate) > 0.001) {
          videoEl2.playbackRate = targetRate;
        }
      } else if (abs < HARD_SEEK_MS) {
        videoEl2.playbackRate = driftMs < 0 ? MAX_RATE : MIN_RATE;
      } else {
        guardRef.current = true;
        videoEl2.playbackRate = 1;
        videoEl2.currentTime = computeExpected();
        queueMicrotask(() => { guardRef.current = false; });
      }
    };

    if ("requestVideoFrameCallback" in videoEl) {
      const onFrame = (_now: number, metadata: any) => {
        const expected = computeExpected() * 1000;
        const actual = (metadata.mediaTime || videoEl.currentTime) * 1000;
        const drift = actual - expected;

        driftSamplesRef.current.push(drift);
        if (driftSamplesRef.current.length > 30) driftSamplesRef.current.shift();
        const sorted = driftSamplesRef.current.slice().sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        correctDrift(median);
        rafIdRef.current = (videoEl as any).requestVideoFrameCallback(onFrame);
      };
      rafIdRef.current = (videoEl as any).requestVideoFrameCallback(onFrame);

      return () => {
        if ("cancelVideoFrameCallback" in videoEl) {
          (videoEl as any).cancelVideoFrameCallback(rafIdRef.current);
        }
      };
    } else {
      const id = setInterval(() => {
        const v = videoRef.current;
        if (!v) return;
        const expected = computeExpected() * 1000;
        const actual = v.currentTime * 1000;
        correctDrift(actual - expected);
      }, 250);
      return () => clearInterval(id);
    }
  }, [videoRef, playback?.isPlaying, playback?.seq]);
}
