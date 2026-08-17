// @ts-ignore
import { describe, expect, test, beforeEach } from "bun:test";
import { ClockSyncEstimator } from "../clock-sync";
import { PISlewingController, computeExpectedPlayhead } from "../pi-controller";

describe("Empirical Challenge 1: Late-Joiner Playhead Calculation Formula", () => {
  test("calculates exact playhead across positive, negative, and zero clock offsets", () => {
    const testCases = [
      { base: 0, lastSync: 10000, clientNow: 20000, theta: 0, rate: 1.0, isPlaying: true, expected: 10.0 },
      { base: 120.5, lastSync: 50000, clientNow: 65000, theta: 250, rate: 1.0, isPlaying: true, expected: 135.75 },
      { base: 45.0, lastSync: 100000, clientNow: 110000, theta: -500, rate: 1.5, isPlaying: true, expected: 45.0 + 9.5 * 1.5 },
      { base: 300.0, lastSync: 1000000, clientNow: 1030000, theta: 100, rate: 0.5, isPlaying: true, expected: 300.0 + 30.1 * 0.5 },
      { base: 50.0, lastSync: 10000, clientNow: 20000, theta: 100, rate: 1.0, isPlaying: false, expected: 50.0 },
    ];

    for (const tc of testCases) {
      const result = computeExpectedPlayhead(
        tc.base,
        tc.lastSync,
        tc.clientNow,
        tc.theta,
        tc.rate,
        tc.isPlaying
      );
      expect(result).toBeCloseTo(tc.expected, 4);
    }
  });

  test("handles multi-hour timestamps without integer overflow or precision loss", () => {
    // 3 hours = 10,800 seconds in video timeline
    const base = 10800.0;
    const lastSync = 1700000000000;
    const clientNow = 1700000060000; // 60 seconds later
    const theta = -150;
    const result = computeExpectedPlayhead(base, lastSync, clientNow, theta, 1.0, true);
    // 60000 - 150 = 59850ms = 59.85s -> 10800 + 59.85 = 10859.85s
    expect(result).toBeCloseTo(10859.85, 3);
  });
});

describe("Empirical Challenge 2: Late-Joiner Direct Seek Behavior", () => {
  test("triggers instant SEEK without slewing on initial join or large desync > 1.0s", () => {
    const pi = new PISlewingController();

    // Simulated room state on join:
    const roomBaseSec = 600.0;
    const lastSyncMs = 50000;
    const clientNowMs = 70000;
    const clockOffsetMs = -200; // serverNow = 69800
    const playbackRate = 1.0;

    // Expected playhead = 600.0 + (69800 - 50000)/1000 * 1.0 = 600 + 19.8 = 619.8s
    const expectedPlayhead = computeExpectedPlayhead(
      roomBaseSec,
      lastSyncMs,
      clientNowMs,
      clockOffsetMs,
      playbackRate,
      true
    );
    expect(expectedPlayhead).toBeCloseTo(619.8, 3);

    // Initial actual playhead of late joiner is 0.0s before seek
    const initialActualPlayhead = 0.0;
    const output = pi.compute(expectedPlayhead, initialActualPlayhead, 0.5, playbackRate);

    expect(output.action).toBe("SEEK");
    expect(output.errorSec).toBeCloseTo(619.8, 3);
    // PI integral must remain clean (0) after direct seek
    expect(pi.getIntegral()).toBe(0);
  });

  test("recovers from SEEK to deadband tracking once seek lands within 100ms", () => {
    const pi = new PISlewingController();

    // 1. Desync of 5.0s -> SEEK
    const s1 = pi.compute(105.0, 100.0, 0.5, 1.0);
    expect(s1.action).toBe("SEEK");

    // 2. Video player executes seek, now actual is 104.95s (error = 50ms <= 100ms deadband)
    const s2 = pi.compute(105.0, 104.95, 0.1, 1.0);
    expect(s2.action).toBe("NONE");
    expect(s2.slewRate).toBe(1.0);
    expect(pi.getIntegral()).toBe(0);
  });
});

describe("Empirical Challenge 3: YouTube setPlaybackRate & Rate Bounds Compatibility", () => {
  test("strictly caps continuous slewing rate within [0.95, 1.05] for YouTube API", () => {
    const pi = new PISlewingController({
      minRate: 0.95,
      maxRate: 1.05,
    });

    const ratesTested: number[] = [];

    // Test extreme error inputs that attempt to overshoot bounds
    const testErrors = [-5.0, -2.0, -0.9, -0.5, -0.2, 0.0, 0.2, 0.5, 0.9, 2.0, 5.0];

    for (const err of testErrors) {
      const actual = 100.0;
      const expected = actual + err;
      const out = pi.compute(expected, actual, 0.5, 1.0);

      if (out.action === "SLEW") {
        ratesTested.push(out.slewRate);
        expect(out.slewRate).toBeGreaterThanOrEqual(0.95);
        expect(out.slewRate).toBeLessThanOrEqual(1.05);
      }
    }

    // Verify all slewed rates are YouTube API setPlaybackRate compatible [0.95, 1.05]
    expect(ratesTested.length).toBeGreaterThan(0);
    for (const r of ratesTested) {
      expect(r).toBeGreaterThanOrEqual(0.95);
      expect(r).toBeLessThanOrEqual(1.05);
    }
  });

  test("prevents integral windup under persistent boundary saturation", () => {
    const pi = new PISlewingController();

    // Push with maximum slewing error repeatedly
    for (let step = 0; step < 100; step++) {
      const out = pi.compute(10.9, 10.0, 0.5, 1.0); // error = +0.9s (slewing zone)
      expect(out.slewRate).toBeLessThanOrEqual(1.05);
    }

    // Integral should be capped / frozen by anti-windup guard
    const maxIntegral = pi.getIntegral();
    expect(maxIntegral).toBeLessThan(10.0); // Without anti-windup, 100 * 0.9 * 0.5 would be 45
  });
});

describe("Empirical Challenge 4: Clock Drift & Network Jitter Simulation", () => {
  test("tracks linear clock drift over 60 iterations with periodic NTP probes", () => {
    const sync = new ClockSyncEstimator({ windowSize: 8, maxRttThresholdMs: 500, alpha: 0.2 });

    // Simulate clock drift: client clock runs faster by +2ms every second
    // Initial true offset: +50ms
    let trueOffset = 50;
    const baseTime = 100000;

    for (let sec = 0; sec < 60; sec++) {
      trueOffset += 2; // +2ms per second drift
      const t0 = baseTime + sec * 1000;
      const oneWayDelay = 15; // 15ms one-way delay (30ms RTT)
      const t1 = t0 + trueOffset + oneWayDelay;
      const t2 = t1 + 2; // 2ms server processing
      const t3 = t0 + 2 * oneWayDelay + 2;

      sync.processProbe(t0, t1, t2, t3);
    }

    // After 60 seconds, true offset is 50 + 120 = 170ms
    // The EMA smoothed estimated offset (with alpha=0.2 and window=8) tracks the true offset with ~22ms mathematical lag (approx 148ms)
    expect(sync.getOffset()).toBeGreaterThan(140);
    expect(sync.getOffset()).toBeLessThan(175);
  });

  test("maintains stable offset estimate under 90% jitter and random 10% packet bursts", () => {
    const sync = new ClockSyncEstimator({ windowSize: 8, maxRttThresholdMs: 500, alpha: 0.2 });
    const trueOffset = 100; // True offset is +100ms

    // Seeded pseudo-random sequence
    let seed = 42;
    const pseudoRand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    for (let i = 0; i < 100; i++) {
      const t0 = i * 2000;
      const isSpike = pseudoRand() < 0.15; // 15% spikes
      const rtt = isSpike ? 600 + pseudoRand() * 500 : 20 + pseudoRand() * 60; // Spikes: 600-1100ms, Normal: 20-80ms
      const oneWay = rtt / 2;
      const t1 = t0 + trueOffset + oneWay;
      const t2 = t1;
      const t3 = t0 + rtt;

      sync.processProbe(t0, t1, t2, t3);
    }

    // Estimated offset must converge near +100ms and not be thrown off by spikes > 500ms
    expect(sync.getOffset()).toBeCloseTo(100, 0);
  });
});
