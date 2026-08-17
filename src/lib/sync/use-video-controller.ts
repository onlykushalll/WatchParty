"use client";

import { useEffect, useRef, RefObject } from "react";
import { PlaybackState } from "./types";
import { PISlewingController, computeExpectedPlayhead } from "./pi-controller";

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
  const rafIdRef = useRef<number>(0);
  const clockOffsetRef = useRef(clockOffset);
  clockOffsetRef.current = clockOffset;
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const piControllerRef = useRef<PISlewingController>(new PISlewingController());
  const lastTickTimeRef = useRef<number>(performance.now());

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
    const expectedTime = computeExpectedPlayhead(
      playback.currentTime,
      playback.lastChangedAt,
      Date.now(),
      clockOffset,
      desiredRate,
      playback.isPlaying,
    );

    const actualTime = videoEl.currentTime;
    const delta = Math.abs(actualTime - expectedTime);

    // Hard seek if desync exceeds 1.0s or if paused or initial sync
    if (delta > 1.0 || !playback.isPlaying || lastAppliedSeq.current === 1) {
      videoEl.currentTime = expectedTime;
      piControllerRef.current.reset();
      videoEl.playbackRate = desiredRate;
    }

    if (playback.isPlaying && videoEl.paused) {
      videoEl.play().catch(() => {});
    } else if (!playback.isPlaying && !videoEl.paused) {
      videoEl.pause();
    }

    lastTickTimeRef.current = performance.now();

    queueMicrotask(() => {
      guardRef.current = false;
    });
  }, [videoRef, playback, clockOffset]);

  // ── tsMap heartbeat broadcast ──
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

  // ── Unified PI Slewing Rate Controller (Continuous Drift Correction) ──
  useEffect(() => {
    const videoEl = videoRef.current;
    if (
      !videoEl ||
      !playback ||
      !playback.isPlaying ||
      playback.videoType === "youtube" ||
      playback.videoType === "iframe"
    ) {
      piControllerRef.current.reset();
      return;
    }

    lastTickTimeRef.current = performance.now();

    const runCorrection = (mediaTimeSec?: number) => {
      if (guardRef.current) return;
      const v = videoRef.current;
      const pb = playbackRef.current;
      if (!v || !pb || !pb.isPlaying) return;

      const now = performance.now();
      const dtSec = Math.max(0.01, Math.min(1.0, (now - lastTickTimeRef.current) / 1000));
      lastTickTimeRef.current = now;

      const desiredRate = pb.playbackRate || 1;
      const expectedSec = computeExpectedPlayhead(
        pb.currentTime,
        pb.lastChangedAt,
        Date.now(),
        clockOffsetRef.current,
        desiredRate,
        pb.isPlaying,
      );
      const actualSec = typeof mediaTimeSec === "number" ? mediaTimeSec : v.currentTime;

      const output = piControllerRef.current.compute(expectedSec, actualSec, dtSec, desiredRate);

      if (output.action === "SEEK") {
        guardRef.current = true;
        v.currentTime = expectedSec;
        v.playbackRate = desiredRate;
        queueMicrotask(() => {
          guardRef.current = false;
        });
      } else if (output.action === "SLEW") {
        if (Math.abs(v.playbackRate - output.slewRate) > 0.001) {
          v.playbackRate = output.slewRate;
          (v as any).preservesPitch = true;
        }
      } else {
        // action === "NONE" (within deadband <= 100ms)
        if (Math.abs(v.playbackRate - desiredRate) > 0.001) {
          v.playbackRate = desiredRate;
        }
      }
    };

    if ("requestVideoFrameCallback" in videoEl) {
      const onFrame = (_now: number, metadata: any) => {
        runCorrection(metadata?.mediaTime);
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
        runCorrection();
      }, 250);
      return () => clearInterval(id);
    }
  }, [videoRef, playback?.isPlaying, playback?.seq]);
}
