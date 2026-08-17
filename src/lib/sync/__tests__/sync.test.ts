// @ts-ignore
import { describe, expect, test, beforeEach } from "bun:test";
import { ClockSyncEstimator, ClockProbeSample } from "../clock-sync";
import { PISlewingController, computeExpectedPlayhead } from "../pi-controller";

describe("Requirement R2: ClockSyncEstimator (Cristian's NTP & EMA)", () => {
  let sync: ClockSyncEstimator;

  beforeEach(() => {
    sync = new ClockSyncEstimator({ windowSize: 8, maxRttThresholdMs: 500, alpha: 0.2 });
  });

  test("calculates raw offset and RTT correctly for symmetrical network delay", () => {
    // Client send t0=1000, Server recv t1=1020, Server transmit t2=1020, Client recv t3=1040
    // RTT = (1040-1000) - (1020-1020) = 40ms
    // Raw Offset = ((1020-1000) + (1020-1040)) / 2 = (20 + -20) / 2 = 0ms
    const res = sync.processProbe(1000, 1020, 1020, 1040);
    expect(res.rtt).toBe(40);
    expect(res.rawOffset).toBe(0);
    expect(res.offset).toBe(0);
    expect(res.accepted).toBe(true);
  });

  test("calculates correct offset when server is ahead by +100ms", () => {
    // Client send t0=1000, Server recv t1=1110, Server transmit t2=1110, Client recv t3=1020
    // RTT = (1020-1000) - (1110-1110) = 20ms
    // Raw Offset = ((1110-1000) + (1110-1020)) / 2 = (110 + 90) / 2 = +100ms
    const res = sync.processProbe(1000, 1110, 1110, 1020);
    expect(res.rtt).toBe(20);
    expect(res.offset).toBe(100);
    expect(res.accepted).toBe(true);
  });

  test("calculates correct offset when client is ahead by +50ms (server behind)", () => {
    // Client send t0=1050, Server recv t1=1010, Server transmit t2=1010, Client recv t3=1070
    // RTT = (1070-1050) = 20ms
    // Raw Offset = ((1010-1050) + (1010-1070)) / 2 = (-40 + -60) / 2 = -50ms
    const res = sync.processProbe(1050, 1010, 1010, 1070);
    expect(res.rtt).toBe(20);
    expect(res.offset).toBe(-50);
    expect(res.accepted).toBe(true);
  });

  test("accounts for server processing delay (t2 - t1)", () => {
    // Client send t0=1000, Server recv t1=1020, Server processing 30ms -> t2=1050, Client recv t3=1070
    // Total elapsed = 1070 - 1000 = 70ms. Processing = 30ms. Network RTT = 40ms.
    // Raw Offset = ((1020-1000) + (1050-1070)) / 2 = (20 - 20) / 2 = 0ms.
    const res = sync.processProbe(1000, 1020, 1050, 1070);
    expect(res.rtt).toBe(40);
    expect(res.rawOffset).toBe(0);
    expect(res.accepted).toBe(true);
  });

  test("rejects outlier probes with RTT > 500ms", () => {
    // Valid initial probe: RTT = 60ms, Offset = +100ms
    sync.processProbe(1000, 1130, 1130, 1060);
    expect(sync.getOffset()).toBe(100);

    // Outlier probe: RTT = 600ms (> 500ms threshold)
    const outlierRes = sync.processProbe(1000, 1400, 1400, 1600);
    expect(outlierRes.accepted).toBe(false);
    expect(outlierRes.rtt).toBe(600);
    expect(sync.getOffset()).toBe(100); // Current offset unchanged
  });

  test("selects minimum RTT probe from sliding window and applies EMA smoothing (alpha=0.2)", () => {
    // Initial probe: Offset = +100ms, RTT = 100ms -> initializes offset to 100
    sync.processProbe(1000, 1150, 1150, 1100);
    expect(sync.getOffset()).toBe(100);

    // Probe 2: High RTT sample (Offset = +200ms, RTT = 200ms)
    // Probe 3: Min RTT sample (Offset = +50ms, RTT = 20ms)
    sync.processProbe(2000, 2300, 2300, 2200); // offset +200, RTT 200
    sync.processProbe(3000, 3060, 3060, 3020); // offset +50, min RTT=20ms

    // Candidate offset from min-RTT probe = +50ms
    // EMA calculation: alpha * candidate + (1 - alpha) * prev
    // 0.2 * 50 + 0.8 * 100 = 10 + 80 = 90ms
    expect(sync.getOffset()).toBeCloseTo(90, 1);
  });

  test("sliding window evicts oldest probe once capacity (windowSize=8) is exceeded", () => {
    // Fill window with 8 probes having RTT = 50ms, Offset = +100ms
    for (let i = 0; i < 8; i++) {
      sync.processProbe(i * 1000, i * 1000 + 125, i * 1000 + 125, i * 1000 + 50);
    }
    expect(sync.getWindowSize()).toBe(8);
    expect(sync.getMinRtt()).toBe(50);

    // Add a 9th probe with lower RTT (10ms) and Offset = +50ms
    sync.processProbe(10000, 10055, 10055, 10010);
    expect(sync.getWindowSize()).toBe(8); // Window stays at max 8
    expect(sync.getMinRtt()).toBe(10);
  });

  test("resets state completely on reset()", () => {
    sync.processProbe(1000, 1110, 1110, 1020);
    expect(sync.isReady()).toBe(true);
    expect(sync.getOffset()).toBe(100);
    expect(sync.getWindowSize()).toBe(1);

    sync.reset();
    expect(sync.isReady()).toBe(false);
    expect(sync.getOffset()).toBe(0);
    expect(sync.getWindowSize()).toBe(0);
    expect(sync.getMinRtt()).toBe(0);
  });

  test("STRESS: extreme latency jitter (20ms -> 800ms -> 1200ms -> 501ms) strictly rejects >500ms outliers without corrupting offset", () => {
    // Establish baseline offset with 20ms RTT probes (offset = +50ms)
    for (let i = 0; i < 5; i++) {
      const res = sync.processProbe(1000 + i * 1000, 1060 + i * 1000, 1060 + i * 1000, 1020 + i * 1000);
      expect(res.accepted).toBe(true);
      expect(res.rtt).toBe(20);
    }
    expect(sync.getOffset()).toBe(50);

    // Extreme latency spike 1: RTT = 800ms (> 500ms threshold)
    const spike1 = sync.processProbe(10000, 1400, 1400, 10800);
    expect(spike1.accepted).toBe(false);
    expect(sync.getOffset()).toBe(50);

    // Extreme latency spike 2: RTT = 1200ms
    const spike2 = sync.processProbe(20000, 2600, 2600, 21200);
    expect(spike2.accepted).toBe(false);
    expect(sync.getOffset()).toBe(50);

    // Boundary check: RTT = 501ms (just above 500ms threshold)
    const spike3 = sync.processProbe(30000, 3251, 3251, 30502);
    expect(spike3.accepted).toBe(false);
    expect(sync.getOffset()).toBe(50);

    // Boundary check: RTT = 500ms (exact threshold)
    const boundary = sync.processProbe(40000, 4250, 4250, 40500);
    expect(boundary.accepted).toBe(true);
  });

  test("STRESS: asymmetric network delay bounds error within RTT/2", () => {
    // Asymmetric network: Uplink = 10ms, Downlink = 90ms (Total RTT = 100ms)
    // Server true clock offset = +0ms.
    // Client t0=1000 -> Server receives t1=1010 -> Server transmits t2=1010 -> Client receives t3=1100
    // Measured raw offset = ((1010-1000) + (1010-1100)) / 2 = (10 - 90)/2 = -40ms.
    // Error = |-40 - 0| = 40ms <= RTT/2 (50ms).
    const res = sync.processProbe(1000, 1010, 1010, 1100);
    expect(res.accepted).toBe(true);
    expect(res.rtt).toBe(100);
    expect(Math.abs(res.rawOffset)).toBeLessThanOrEqual(res.rtt / 2);
  });
});

describe("Requirement R2: PISlewingController (PI Playhead Rate Control)", () => {
  let pi: PISlewingController;

  beforeEach(() => {
    pi = new PISlewingController({
      kp: 0.05,
      ki: 0.005,
      minRate: 0.95,
      maxRate: 1.05,
      deadbandSec: 0.1,
      hardSeekSec: 1.0,
    });
  });

  test("returns NONE action within deadband zone (|error| <= 100ms)", () => {
    const res = pi.compute(10.05, 10.0, 0.5, 1.0); // error = +0.05s (50ms)
    expect(res.action).toBe("NONE");
    expect(res.slewRate).toBe(1.0);
    expect(pi.getIntegral()).toBe(0);
  });

  test("returns SEEK action when desync exceeds hard seek threshold (|error| > 1.0s)", () => {
    const res = pi.compute(12.5, 10.0, 0.5, 1.0); // error = +2.5s
    expect(res.action).toBe("SEEK");
    expect(res.slewRate).toBe(1.0);
    expect(pi.getIntegral()).toBe(0);
  });

  test("computes PI slewing rate correctly for moderate lag (0.1s < |error| <= 1.0s)", () => {
    // expected = 10.4s, actual = 10.0s, error = +0.4s (400ms lag)
    // dt = 0.5s
    // Integral = 0 + 0.4 * 0.5 = 0.2
    // Raw rate = 1.0 + 0.05 * 0.4 + 0.005 * 0.2 = 1.0 + 0.02 + 0.001 = 1.021
    const res = pi.compute(10.4, 10.0, 0.5, 1.0);
    expect(res.action).toBe("SLEW");
    expect(res.slewRate).toBeCloseTo(1.021, 4);
    expect(pi.getIntegral()).toBeCloseTo(0.2, 4);
  });

  test("strictly clamps slew rate to [0.95, 1.05] and freezes integral on saturation (anti-windup)", () => {
    for (let i = 0; i < 20; i++) {
      const res = pi.compute(10.95, 10.0, 0.5, 1.0);
      expect(res.slewRate).toBeLessThanOrEqual(1.05);
      expect(res.slewRate).toBeGreaterThanOrEqual(0.95);
    }
  });

  test("STRESS: large positive accumulative error (+800ms) freezes integral and recovers instantly without windup explosion", () => {
    let lastRes;
    for (let i = 0; i < 100; i++) {
      lastRes = pi.compute(10.8, 10.0, 0.5, 1.0);
      expect(lastRes.action).toBe("SLEW");
      expect(lastRes.slewRate).toBeLessThanOrEqual(1.05);
    }
    expect(lastRes?.slewRate).toBe(1.05); // Saturated at maxRate

    // Integral must be frozen once unconstrained rate > 1.05
    const saturatedIntegral = pi.getIntegral();
    expect(saturatedIntegral).toBeLessThan(5.0); // Would be 40+ without anti-windup

    // Drop error down to moderate +0.2s (200ms lag)
    const recoveryRes = pi.compute(10.2, 10.0, 0.5, 1.0);
    expect(recoveryRes.action).toBe("SLEW");
    expect(recoveryRes.slewRate).toBeLessThan(1.05);
    expect(recoveryRes.slewRate).toBeGreaterThan(1.0);
  });

  test("STRESS: large negative accumulative error (-800ms) freezes integral at lower bound 0.95", () => {
    let lastRes;
    for (let i = 0; i < 100; i++) {
      lastRes = pi.compute(9.2, 10.0, 0.5, 1.0);
      expect(lastRes.action).toBe("SLEW");
      expect(lastRes.slewRate).toBeGreaterThanOrEqual(0.95);
    }
    expect(lastRes?.slewRate).toBe(0.95); // Saturated at minRate

    const recoveryRes = pi.compute(9.8, 10.0, 0.5, 1.0);
    expect(recoveryRes.action).toBe("SLEW");
    expect(recoveryRes.slewRate).toBeGreaterThan(0.95);
    expect(recoveryRes.slewRate).toBeLessThan(1.0);
  });

  test("STRESS: deadband boundary (|e_k| <= 100ms) precision and anti-oscillation", () => {
    // Exact 99ms error -> inside deadband
    const r99 = pi.compute(10.099, 10.0, 0.5, 1.0);
    expect(r99.action).toBe("NONE");
    expect(r99.slewRate).toBe(1.0);
    expect(pi.getIntegral()).toBe(0);

    // Exact 100ms error -> deadband limit
    const r100 = pi.compute(10.100, 10.0, 0.5, 1.0);
    expect(r100.action).toBe("NONE");
    expect(r100.slewRate).toBe(1.0);
    expect(pi.getIntegral()).toBe(0);

    // Exact 101ms error -> outside deadband
    const r101 = pi.compute(10.101, 10.0, 0.5, 1.0);
    expect(r101.action).toBe("SLEW");
    expect(r101.slewRate).toBeGreaterThan(1.0);

    // Exact negative boundaries
    const rNeg100 = pi.compute(9.900, 10.0, 0.5, 1.0);
    expect(rNeg100.action).toBe("NONE");
    expect(rNeg100.slewRate).toBe(1.0);

    const rNeg101 = pi.compute(9.899, 10.0, 0.5, 1.0);
    expect(rNeg101.action).toBe("SLEW");
    expect(rNeg101.slewRate).toBeLessThan(1.0);
  });

  test("STRESS: hard seek boundary (|e_k| > 1.0s) precision", () => {
    // Exact 1.000s error -> slewing (upper limit of slewing)
    const r1000 = pi.compute(11.000, 10.0, 0.5, 1.0);
    expect(r1000.action).toBe("SLEW");

    // Exact 1.001s error -> hard seek
    const r1001 = pi.compute(11.001, 10.0, 0.5, 1.0);
    expect(r1001.action).toBe("SEEK");
    expect(pi.getIntegral()).toBe(0);

    // Negative hard seek boundary
    const rNeg1000 = pi.compute(9.000, 10.0, 0.5, 1.0);
    expect(rNeg1000.action).toBe("SLEW");

    const rNeg1001 = pi.compute(8.999, 10.0, 0.5, 1.0);
    expect(rNeg1001.action).toBe("SEEK");
    expect(pi.getIntegral()).toBe(0);
  });

  test("STRESS: rapid deadband toggling resets integral cleanly to prevent accumulation across boundary crossings", () => {
    for (let i = 0; i < 20; i++) {
      pi.compute(10.15, 10.0, 0.5, 1.0);
      expect(pi.getIntegral()).toBeGreaterThan(0);

      const dbRes = pi.compute(10.05, 10.0, 0.5, 1.0);
      expect(dbRes.action).toBe("NONE");
      expect(dbRes.slewRate).toBe(1.0);
      expect(pi.getIntegral()).toBe(0);
    }
  });

  test("resets integral accumulator on reset()", () => {
    pi.compute(10.5, 10.0, 0.5, 1.0);
    expect(pi.getIntegral()).toBeGreaterThan(0);
    pi.reset();
    expect(pi.getIntegral()).toBe(0);
  });
});

describe("Requirement R2: Frame-Exact Expected Playhead Calculation", () => {
  test("calculates frame-exact room playhead for late joiners", () => {
    const expectedPlayhead = computeExpectedPlayhead(120.0, 10000, 15000, 50, 1.0, true);
    expect(expectedPlayhead).toBeCloseTo(125.05, 3);
  });

  test("returns room base time when video is paused", () => {
    const expectedPlayhead = computeExpectedPlayhead(45.0, 10000, 20000, 100, 1.0, false);
    expect(expectedPlayhead).toBe(45.0);
  });

  test("handles arbitrary playback rates (0.5x, 1.5x, 2.0x)", () => {
    // 10s elapsed on server * 1.5x rate = +15s playhead advancement
    const h1 = computeExpectedPlayhead(100.0, 10000, 20000, 0, 1.5, true);
    expect(h1).toBeCloseTo(115.0, 3);

    // 10s elapsed on server * 0.5x rate = +5s playhead advancement
    const h2 = computeExpectedPlayhead(100.0, 10000, 20000, 0, 0.5, true);
    expect(h2).toBeCloseTo(105.0, 3);

    // 10s elapsed on server * 2.0x rate = +20s playhead advancement
    const h3 = computeExpectedPlayhead(100.0, 10000, 20000, 0, 2.0, true);
    expect(h3).toBeCloseTo(120.0, 3);
  });

  test("handles negative elapsed time (e.g. clock desync before lastChangedAt) gracefully by clamping to 0", () => {
    // If serverNow < lastChangedAt (e.g. future timestamp due to buffer resumption padding), elapsed is clamped to 0
    const res = computeExpectedPlayhead(50.0, 20000, 10000, 0, 1.0, true);
    expect(res).toBe(50.0);
  });
});
