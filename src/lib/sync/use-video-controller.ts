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

import { PISlewingController } from "./pi-controller";

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
 *  3. Proportional-Integral (PI) slewing rate controller:
 *       |Δ| ≤ 100ms  → deadband (leave alone)
 *       100ms < |Δ| ≤ 1000ms → PI continuous rate slewing (0.95x to 1.05x with anti-windup)
 *       |Δ| > 1000ms → hard seek to expected playhead
 */
export function useVideoController({
  videoRef,
  playback,
  clockOffset,
  onIntent,
}: UseVideoControllerArgs) {
  const guardRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const piControllerRef = useRef(new PISlewingController());
  const lastAppliedSeq = useRef(-1);
  const lastTickTimeRef = useRef<number>(Date.now());

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

    const isInitialJoin = lastAppliedSeq.current === -1;
    if (playback.seq === lastAppliedSeq.current && !isInitialJoin) return;
    lastAppliedSeq.current = playback.seq;

    guardRef.current = true;

    const desiredRate = playback.playbackRate || 1;
    const serverNow = Date.now() + clockOffset;
    const elapsedSinceChange = playback.isPlaying
      ? (serverNow - playback.lastChangedAt) / 1000
      : 0;
    const expectedTime = playback.currentTime + elapsedSinceChange * desiredRate;
    const actualTime = videoEl.currentTime;
    const delta = Math.abs(actualTime - expectedTime);

    // Initial join or large desync (> 1.0s) -> Instant Seek
    if (isInitialJoin || delta > 1.0) {
      videoEl.currentTime = expectedTime;
      videoEl.playbackRate = desiredRate;
      piControllerRef.current.reset();
    } else {
      const res = piControllerRef.current.compute(expectedTime, actualTime, 0.5, desiredRate);
      if (res.action === "SEEK") {
        videoEl.currentTime = expectedTime;
        videoEl.playbackRate = desiredRate;
      } else if (res.action === "SLEW") {
        videoEl.playbackRate = res.slewRate;
      } else {
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

  // ── Periodic drift self-correction (500ms ticker with PI controller) ──
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !playback || !playback.isPlaying || playback.videoType === "youtube" || playback.videoType === "iframe") return;

    lastTickTimeRef.current = Date.now();

    const id = setInterval(() => {
      if (guardRef.current) return;
      const now = Date.now();
      const dt = (now - lastTickTimeRef.current) / 1000;
      lastTickTimeRef.current = now;

      const serverNow = now + clockOffset;
      const elapsed = (serverNow - playback.lastChangedAt) / 1000;
      const desiredRate = playback.playbackRate || 1;
      const expected = playback.currentTime + elapsed * desiredRate;
      const actual = videoEl.currentTime;

      const res = piControllerRef.current.compute(expected, actual, dt, desiredRate);

      if (res.action === "SEEK") {
        guardRef.current = true;
        videoEl.currentTime = expected;
        videoEl.playbackRate = desiredRate;
        queueMicrotask(() => { guardRef.current = false; });
      } else if (res.action === "SLEW") {
        videoEl.playbackRate = res.slewRate;
      } else {
        if (Math.abs(videoEl.playbackRate - desiredRate) > 0.001) {
          videoEl.playbackRate = desiredRate;
        }
      }
    }, 500);

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
