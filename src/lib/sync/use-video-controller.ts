"use client";

import { useEffect, useRef, useCallback, RefObject } from "react";
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

/**
 * useVideoController
 *
 * Bridges the authoritative PlaybackState (from the server) and a local
 * HTML5 <video> element. Handles:
 *
 *  1. Echo-loop prevention — a guard flag set while we apply remote state
 *     so the resulting 'play'/'pause'/'seek' events are NOT re-broadcast.
 *  2. Seek debounce — HTML5 seek fires pause→seeking→seeked→play; we
 *     collect events in a 200ms window and send only the final state.
 *  3. 3-tier drift correction on incoming state:
 *       |Δ| ≤ 100ms  → leave alone
 *       100ms < |Δ| ≤ 1500ms → soft rate adjust (1.05x / 0.95x)
 *       |Δ| > 1500ms → hard seek
 *
 * Takes a RefObject (not the element itself) so we don't access the ref
 * during render and don't trip the immutability lint rule.
 */
export function useVideoController({
  videoRef,
  playback,
  clockOffset,
  onIntent,
}: UseVideoControllerArgs) {
  const guardRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const softRateRef = useRef(1);
  const lastAppliedSeq = useRef(-1);

  // ── Outgoing: listen to user-driven events on the video element ──
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
    const onRateChange = () => {
      if (guardRef.current) return;
      onIntent({ playbackRate: videoEl.playbackRate });
    };

    videoEl.addEventListener("play", onPlay);
    videoEl.addEventListener("pause", onPause);
    videoEl.addEventListener("seeked", onSeeked);
    videoEl.addEventListener("ratechange", onRateChange);

    return () => {
      videoEl.removeEventListener("play", onPlay);
      videoEl.removeEventListener("pause", onPause);
      videoEl.removeEventListener("seeked", onSeeked);
      videoEl.removeEventListener("ratechange", onRateChange);
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

    const serverNow = Date.now() + clockOffset;
    const elapsedSinceChange = playback.isPlaying
      ? (serverNow - playback.lastChangedAt) / 1000
      : 0;
    const expectedTime = playback.currentTime + elapsedSinceChange;

    const actualTime = videoEl.currentTime;
    const delta = Math.abs(actualTime - expectedTime);

    if (delta > 1.5) {
      videoEl.currentTime = expectedTime;
      softRateRef.current = 1;
    } else if (delta > 0.1) {
      if (actualTime < expectedTime) {
        videoEl.playbackRate = Math.max(desiredRate * 1.05, 0.1);
        softRateRef.current = desiredRate * 1.05;
      } else {
        videoEl.playbackRate = Math.max(desiredRate * 0.95, 0.1);
        softRateRef.current = desiredRate * 0.95;
      }
    } else {
      if (Math.abs(videoEl.playbackRate - desiredRate) > 0.01) {
        videoEl.playbackRate = desiredRate;
      }
      softRateRef.current = desiredRate;
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

  // ── Periodic drift self-correction ──
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !playback || !playback.isPlaying || playback.videoType === "youtube" || playback.videoType === "iframe") return;

    const id = setInterval(() => {
      if (guardRef.current) return;
      const serverNow = Date.now() + clockOffset;
      const elapsed = (serverNow - playback.lastChangedAt) / 1000;
      const expected = playback.currentTime + elapsed * (playback.playbackRate || 1);
      const actual = videoEl.currentTime;
      const delta = actual - expected;

      if (Math.abs(delta) > 1.5) {
        guardRef.current = true;
        videoEl.currentTime = expected;
        queueMicrotask(() => { guardRef.current = false; });
      } else if (delta < -0.1) {
        videoEl.playbackRate = Math.max((playback.playbackRate || 1) * 1.05, 0.1);
      } else if (delta > 0.1) {
        videoEl.playbackRate = Math.max((playback.playbackRate || 1) * 0.95, 0.1);
      } else {
        videoEl.playbackRate = playback.playbackRate || 1;
      }
    }, 2000);

    return () => clearInterval(id);
  }, [videoRef, playback, clockOffset]);

  // ── Heartbeat ──
  const heartbeat = useCallback(() => {
    // Server uses this for RTT telemetry; no-op here for now.
  }, []);

  useEffect(() => {
    const id = setInterval(heartbeat, 5000);
    return () => clearInterval(id);
  }, [heartbeat]);
}
