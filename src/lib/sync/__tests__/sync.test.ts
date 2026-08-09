// @ts-ignore
import { describe, expect, test, beforeEach } from "bun:test";
import { ClockSyncEstimator } from "../clock-sync";
import { PISlewingController, computeExpectedPlayhead } from "../pi-controller";

describe("Requirement R2: ClockSyncEstimator (Cristian's NTP & EMA)", () => {
  let sync: ClockSyncEstimator;

  beforeEach(() => {
    sync = new ClockSyncEstimator({ windowSize: 8, maxRttThresholdMs: 500, alpha: 0.2 });
  });

  test("calculates raw offset and RTT correctly for symmetrical network delay", () => {
    const res = sync.processProbe(1000, 1020, 1020, 1040);
    expect(res.rtt).toBe(40);
    expect(res.rawOffset).toBe(0);
    expect(res.offset).toBe(0);
    expect(res.accepted).toBe(true);
  });

  test("calculates correct offset when server is ahead by +100ms", () => {
    const res = sync.processProbe(1000, 1110, 1110, 1020);
    expect(res.rtt).toBe(20);
    expect(res.offset).toBe(100);
    expect(res.accepted).toBe(true);
  });

  test("rejects outlier probes with RTT > 500ms", () => {
    sync.processProbe(1000, 1130, 1130, 1060);
    expect(sync.getOffset()).toBe(100);

    const outlierRes = sync.processProbe(1000, 1400, 1400, 1600);
    expect(outlierRes.accepted).toBe(false);
    expect(sync.getOffset()).toBe(100);
  });

  test("selects minimum RTT probe from sliding window and applies EMA smoothing (alpha=0.2)", () => {
    sync.processProbe(1000, 1150, 1150, 1100);
    expect(sync.getOffset()).toBe(100);

    sync.processProbe(2000, 2300, 2300, 2200);
    sync.processProbe(3000, 3060, 3060, 3020);
    expect(sync.getOffset()).toBeCloseTo(90, 1);
  });

  test("STRESS: extreme latency jitter (20ms -> 800ms -> 1200ms -> 501ms) strictly rejects >500ms outliers without corrupting offset", () => {
    for (let i = 0; i < 5; i++) {
      const res = sync.processProbe(1000 + i * 1000, 1060 + i * 1000, 1060 + i * 1000, 1020 + i * 1000);
      expect(res.accepted).toBe(true);
      expect(res.rtt).toBe(20);
    }
    expect(sync.getOffset()).toBe(50);

    const spike1 = sync.processProbe(10000, 1400, 1400, 10800);
    expect(spike1.accepted).toBe(false);
    expect(sync.getOffset()).toBe(50);

    const spike2 = sync.processProbe(20000, 2600, 2600, 21200);
    expect(spike2.accepted).toBe(false);
    expect(sync.getOffset()).toBe(50);

    const spike3 = sync.processProbe(30000, 3251, 3251, 30502);
    expect(spike3.accepted).toBe(false);
    expect(sync.getOffset()).toBe(50);

    const boundary = sync.processProbe(40000, 4250, 4250, 40500);
    expect(boundary.accepted).toBe(true);
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
    const res = pi.compute(10.05, 10.0, 0.5, 1.0);
    expect(res.action).toBe("NONE");
    expect(res.slewRate).toBe(1.0);
  });

  test("returns SEEK action when desync exceeds hard seek threshold (|error| > 1.0s)", () => {
    const res = pi.compute(12.5, 10.0, 0.5, 1.0);
    expect(res.action).toBe("SEEK");
    expect(res.slewRate).toBe(1.0);
  });

  test("computes PI slewing rate correctly for moderate lag (0.1s < |error| <= 1.0s)", () => {
    const res = pi.compute(10.4, 10.0, 0.5, 1.0);
    expect(res.action).toBe("SLEW");
    expect(res.slewRate).toBeCloseTo(1.021, 4);
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
    expect(lastRes?.slewRate).toBe(1.05); // Saturated to maxRate

    const saturatedIntegral = pi.getIntegral();
    expect(saturatedIntegral).toBeLessThan(5.0);

    const recoveryRes = pi.compute(10.2, 10.0, 0.5, 1.0);
    expect(recoveryRes.action).toBe("SLEW");
    expect(recoveryRes.slewRate).toBeLessThan(1.05);
    expect(recoveryRes.slewRate).toBeGreaterThan(1.0);
  });

  test("STRESS: deadband boundary (|e_k| <= 100ms) precision and anti-oscillation", () => {
    const r99 = pi.compute(10.099, 10.0, 0.5, 1.0);
    expect(r99.action).toBe("NONE");
    expect(r99.slewRate).toBe(1.0);
    expect(pi.getIntegral()).toBe(0);

    const r100 = pi.compute(10.100, 10.0, 0.5, 1.0);
    expect(r100.action).toBe("NONE");
    expect(r100.slewRate).toBe(1.0);
    expect(pi.getIntegral()).toBe(0);

    const r101 = pi.compute(10.101, 10.0, 0.5, 1.0);
    expect(r101.action).toBe("SLEW");
    expect(r101.slewRate).toBeGreaterThan(1.0);
  });
});

describe("Requirement R2: Frame-Exact Expected Playhead Calculation", () => {
  test("calculates frame-exact room playhead for late joiners", () => {
    const expectedPlayhead = computeExpectedPlayhead(120.0, 10000, 15000, 50, 1.0, true);
    expect(expectedPlayhead).toBeCloseTo(125.05, 3);
  });
});
