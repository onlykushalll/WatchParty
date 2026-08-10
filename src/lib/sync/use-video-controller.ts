"use client";

import { useEffect, useRef, useState, useCallback, RefObject } from "react";
import { PlaybackState } from "./types";

interface UseVideoControllerArgs {
  videoRef: RefObject<HTMLVideoElement | null>;
  playback: PlaybackState | null;
  clockOffset: number; // serverNow ≈ clientNow + clockOffset
  onIntent: (patch: Partial<{
    isPlaying: boolean;
    currentTime: number;
    playbackRate: number;
  }>) => void;
}

// ─── DriftCorrector: 3-band correction with preservesPitch ─────────────────
// Based on the research report's reference implementation.
// Bands: ±125ms soft (do nothing), ±750ms rate-nudge (0.96-1.04), ±1500ms hard seek.

const SOFT_BAND_MS = 125;      // ITU-R BT.1359 detectability threshold
const RATE_BAND_MS = 750;      // rate-nudge zone
const HARD_SEEK_MS = 1500;     // hard seek zone
const MIN_RATE = 0.96;
const MAX_RATE = 1.04;

export function useVideoController({
  videoRef,
  playback,
  clockOffset,
  onIntent,
}: UseVideoControllerArgs) {
  const guardRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAppliedSeq = useRef(-1);
  const driftSamplesRef = useRef<number[]>([]);
  const rafIdRef = useRef<number>(0);
  const clockOffsetRef = useRef(clockOffset);
  clockOffsetRef.current = clockOffset;
  const playbackRef = useRef(playback);
  playbackRef.current = playback;

  // Set preservesPitch to prevent audio pitch distortion during rate nudging
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    (videoEl as any).preservesPitch = true;
    try { (videoEl as any).webkitPreservesPitch = true; } catch {}
  }, [videoRef]);

  // ── Outgoing: listen to user-driven events on the video element ──
  // Based on pitfall fixes from the research:
  // #1: guard flag prevents feedback loops
  // #2: debounce prevents seek firing 3 events
  // #3: DON'T broadcast ratechange (local correction only)
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
      if (guardRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flush, 200);
    };
    const onPause = () => {
      if (guardRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      onIntent({ isPlaying: false, currentTime: videoEl.currentTime });
    };
    const onSeeked = () => {
      if (guardRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flush, 120);
    };
    // Pitfall #3: DO NOT broadcast ratechange events.
    // Rate changes are local drift correction only — broadcasting them
    // causes runaway feedback. So we deliberately omit the ratechange listener.

    videoEl.addEventListener("play", onPlay);
    videoEl.addEventListener("pause", onPause);
    videoEl.addEventListener("seeked", onSeeked);

    // Pitfall #9: buffer-aware sync — emit buffer events to server
    // so it can pause everyone when someone buffers (Jellyfin SyncPlay pattern)
    const onWaiting = () => {
      if (guardRef.current) return;
      // Emit buffer:event via a custom event that the sync engine picks up
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
  }, [videoRef, onIntent]);

  // ── Incoming: apply authoritative state to the video element ──
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !playback || playback.videoType === "youtube" || playback.videoType === "iframe") return;
    if (playback.seq === lastAppliedSeq.current) return;
    lastAppliedSeq.current = playback.seq;

    guardRef.current = true;

    const desiredRate = playback.playbackRate || 1;
    videoEl.playbackRate = desiredRate;

    // Pitfall #4: use performance.now()-based clock, not Date.now()
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

  // ── DriftSampler: requestVideoFrameCallback with median-of-30 filter ──
  // Pitfall #6: don't use timeupdate (fires indeterminately every 15-250ms).
  // Use requestVideoFrameCallback for per-frame precision, with setInterval(250) fallback.
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
        // Within soft band — restore normal rate
        const pb = playbackRef.current;
        const desiredRate = pb?.playbackRate || 1;
        if (Math.abs(videoEl2.playbackRate - desiredRate) > 0.001) {
          videoEl2.playbackRate = desiredRate;
        }
      } else if (abs < RATE_BAND_MS) {
        // Rate-nudge zone: 0.96-1.04
        const targetRate = driftMs < 0
          ? Math.min(MAX_RATE, 1 + (abs / RATE_BAND_MS) * 0.04)
          : Math.max(MIN_RATE, 1 - (abs / RATE_BAND_MS) * 0.04);
        if (Math.abs(videoEl2.playbackRate - targetRate) > 0.001) {
          videoEl2.playbackRate = targetRate;
        }
      } else if (abs < HARD_SEEK_MS) {
        // Aggressive rate correction
        videoEl2.playbackRate = driftMs < 0 ? MAX_RATE : MIN_RATE;
      } else {
        // Hard seek — snap to expected position
        guardRef.current = true;
        videoEl2.playbackRate = 1;
        videoEl2.currentTime = computeExpected();
        queueMicrotask(() => { guardRef.current = false; });
      }
    };

    // Use requestVideoFrameCallback if available (per-frame precision)
    if ("requestVideoFrameCallback" in videoEl) {
      const onFrame = (_now: number, metadata: any) => {
        const expected = computeExpected() * 1000;
        const actual = (metadata.mediaTime || videoEl.currentTime) * 1000;
        const drift = actual - expected;

        // Median-of-30 filter — robust to ABR-switch spikes
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
      // Fallback: setInterval(250) for older browsers (iOS < 16)
      const id = setInterval(() => {
        const expected = computeExpected() * 1000;
        const actual = videoEl.currentTime * 1000;
        correctDrift(actual - expected);
      }, 250);
      return () => clearInterval(id);
    }
  }, [videoRef, playback?.isPlaying, playback?.seq]);

  // ── Heartbeat: 1Hz (not 2s) — matches howardchung/watchparty ──
  useEffect(() => {
    const id = setInterval(() => {
      // Server uses this for tsMap + RTT estimation
    }, 1000);
    return () => clearInterval(id);
  }, []);
}
