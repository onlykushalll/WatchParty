# Milestone 2 Implementation Blueprint: Authoritative State Synchronization Engine

## Executive Summary

This report delivers the technical architecture and explicit file modification specifications for **Milestone 2 / Requirement R2 (Authoritative State Synchronization Engine)** of WatchParty. 

The goal of Requirement R2 is to guarantee sub-100ms playhead synchronization across distributed clients watching YouTube, HLS (.m3u8), and native HTML5 MP4 videos. This is achieved through:
1. **Cristian's Algorithm NTP Clock Sync**: 8 initial probe bursts on WebSocket connection, periodic 10s re-sync, sliding window ($N=8$) minimum RTT selection, and hard outlier rejection ($\delta > 500\text{ms}$).
2. **Exponential Moving Average (EMA) Offset Estimation**: Low-pass filtering of candidate clock offsets ($\theta_k = \alpha \cdot \bar{\theta}_{\min} + (1-\alpha) \cdot \theta_{k-1}$ with $\alpha = 0.2$).
3. **Proportional-Integral (PI) Playhead Slewing Controller**: Continuous rate modulation ($u_k = 1.0 + K_p e_k + K_i I_k$, $K_p=0.05, K_i=0.005$) bounded strictly to $[0.95, 1.05]$, featuring 100ms deadband zone, integral anti-windup, and direct seek for $|e_k| > 1.0\text{s}$.
4. **Frame-Exact Initial Join Synchronization**: Instant seek for late-joining room participants calculated via $t_{\text{expected}} = t_{\text{room\_base}} + (\text{now} + \theta - t_{\text{sync\_received}}) \cdot \text{rate}$.
5. **Multi-Provider Video Adapters**: Unified playback rate slewing and seeking across HTML5 `<video>`, HLS.js, and YouTube IFrame API.
6. **Unit Test Suite**: Full coverage of clock estimation, outlier filtering, EMA math, PI controller bounds, anti-windup, and expected playhead math.

---

## 1. Codebase Audit & Gap Analysis

| Component / File Path | Current Observed Code | Gap vs Requirement R2 Specification | Required Remediation |
|---|---|---|---|
| `src/lib/sync/use-sync-engine.ts:198-208` | Emits single `clock:req` on connect and every 30s. Ignores server processing delay ($t_2 - t_1$). Overwrites `clockOffset` directly on every response. | No initial 8-probe burst. Interval is 30s instead of 10s. Lacks min-RTT filtering in $N=8$ window, outlier rejection for RTT $>500$ms, and EMA smoothing ($\alpha=0.2$). | Create `ClockSyncEstimator` (`src/lib/sync/clock-sync.ts`). Refactor `use-sync-engine.ts` to trigger 8 rapid probes on connect and periodic probes every 10s. |
| `src/lib/sync/use-video-controller.ts:114-131` | Step-based speed toggling: sets rate to discrete `1.05` or `0.95` when $|e_k| > 0.1\text{s}$. Hard seek threshold set to $1.5\text{s}$. | Lacks continuous PI feedback control ($K_p=0.05, K_i=0.005$). Hard seek threshold is $1.5\text{s}$ instead of $1.0\text{s}$. No integral anti-windup guard. | Create `PISlewingController` (`src/lib/sync/pi-controller.ts`). Integrate into `use-video-controller.ts` with 100ms deadband and 1.0s hard seek limit. |
| `src/components/watchparty/universal-player.tsx:462-484` | YouTube player performs initial seek on ready, but periodic drift check uses hard seek at $1.5\text{s}$ and lacks PI rate slewing. | YouTube player adapter does not apply PI rate slewing via `setPlaybackRate(u_k)` for small drifts ($0.1\text{s} < |e_k| \le 1.0\text{s}$). | Update `YouTubePlayer` component to use `PISlewingController` for continuous rate adjustment via `setPlaybackRate(u_k)`. |
| `mini-services/sync-service/index.ts:179-184` | Server receives `t1` from client payload, captures server `t2` and `t3` synchronously, responds with `{ t1, t2, t3 }`. | Non-standard 4-timestamp naming causing client/server timestamp confusion ($t_1$ in payload was client send time). | Standardize timestamp payload: Client sends `{ t0: Date.now() }`, server captures $t_1$ (receive) and $t_2$ (transmit) and responds with `{ t0, t1, t2 }`. |
| `package.json` & Unit Tests | No test files present in `src/` or `tests/`. | Requirement R2 requires unit test verification of NTP math, EMA, PI rate clamping, and playhead calculations. | Add `"test": "bun test"` to `package.json`. Create `src/lib/sync/__tests__/sync.test.ts`. |

---

## 2. Mathematical Models & Controller Specifications

### 2.1 Cristian's NTP Probe & Clock Offset Estimation
- **4-Timestamp Model**:
  - $t_0$: Client local timestamp when probe request is dispatched.
  - $t_1$: Server local timestamp when probe request is received.
  - $t_2$: Server local timestamp when probe response is transmitted.
  - $t_3$: Client local timestamp when probe response is received.
- **Round-Trip Time (RTT)**:
  $$\delta = (t_3 - t_0) - (t_2 - t_1)$$
- **Raw Clock Offset**:
  $$\bar{\theta} = \frac{(t_1 - t_0) + (t_2 - t_3)}{2}$$
- **Sliding-Window Min-RTT Filtering**:
  Maintain sliding window $W$ of size $N=8$.
  Outlier Gate: Reject any probe sample with $\delta > 500\text{ms}$.
  Select candidate offset with minimal RTT:
  $$i^* = \arg\min_{i \in W} \delta_i \implies \bar{\theta}_{\min} = \bar{\theta}_{i^*}$$
- **EMA Offset Smoothing**:
  $$\theta_k = \alpha \cdot \bar{\theta}_{\min} + (1 - \alpha) \cdot \theta_{k-1}, \quad \alpha = 0.2$$
  *Initialization*: $\theta_0 = \bar{\theta}_{\min}$ on the first valid probe response.

### 2.2 Proportional-Integral (PI) Playhead Slewing Controller
- **Target Expected Playhead**:
  $$t_{\text{expected}}(t_{\text{client}}) = t_{\text{room\_base}} + \left(\frac{(t_{\text{client}} + \theta_k) - t_{\text{sync\_received}}}{1000}\right) \cdot \text{rate}$$
- **Playhead Error**:
  $$e_k = t_{\text{expected}} - t_{\text{actual}}$$
- **Control Algorithm**:
  1. **Tier 1: Deadband Zone ($|e_k| \le 0.1\text{s}$ / 100ms)**
     - $u_k = 1.0$, $I_k = 0$, Action: `NONE`.
  2. **Tier 2: PI Slewing Zone ($0.1\text{s} < |e_k| \le 1.0\text{s}$)**
     - $I_k = I_{k-1} + e_k \cdot \Delta t$
     - Unconstrained rate: $u_{\text{raw}} = 1.0 + K_p \cdot e_k + K_i \cdot I_k$ where $K_p = 0.05, K_i = 0.005$.
     - Clamped rate: $u_k = \text{clamp}(u_{\text{raw}}, 0.95, 1.05)$.
     - **Anti-Windup Guard**: If $u_{\text{raw}} \neq u_k$, freeze integral ($I_k = I_{k-1}$).
     - Action: `SLEW`.
  3. **Tier 3: Direct Seek Zone ($|e_k| > 1.0\text{s}$ or Initial Join)**
     - $I_k = 0$, Action: `SEEK` to $t_{\text{expected}}$.

---

## 3. Worker Implementation Blueprint (File-by-File)

### File 1 (New): `src/lib/sync/clock-sync.ts`

**Purpose**: Implements Cristian's algorithm with RTT calculation, outlier rejection, min-RTT window filtering, and EMA offset estimation.

```typescript
export interface ClockProbeSample {
  t0: number; // Client send ms
  t1: number; // Server receive ms
  t2: number; // Server transmit ms
  t3: number; // Client receive ms
  rtt: number; // Network RTT ms
  offset: number; // Raw offset ms
}

export interface ClockSyncOptions {
  windowSize?: number; // default 8
  maxRttThresholdMs?: number; // default 500ms
  alpha?: number; // default 0.2
}

export class ClockSyncEstimator {
  private window: ClockProbeSample[] = [];
  private windowSize: number;
  private maxRttThresholdMs: number;
  private alpha: number;
  private currentOffset: number = 0;
  private isInitialized: boolean = false;

  constructor(options?: ClockSyncOptions) {
    this.windowSize = options?.windowSize ?? 8;
    this.maxRttThresholdMs = options?.maxRttThresholdMs ?? 500;
    this.alpha = options?.alpha ?? 0.2;
  }

  public processProbe(t0: number, t1: number, t2: number, t3: number): {
    offset: number;
    rtt: number;
    accepted: boolean;
  } {
    const serverProcessing = Math.max(0, t2 - t1);
    const rtt = Math.max(0, (t3 - t0) - serverProcessing);
    const rawOffset = ((t1 - t0) + (t2 - t3)) / 2;

    // Outlier rejection (> 500ms)
    if (rtt > this.maxRttThresholdMs) {
      return { offset: this.currentOffset, rtt, accepted: false };
    }

    // Add to sliding window
    this.window.push({ t0, t1, t2, t3, rtt, offset: rawOffset });
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }

    // Select probe with minimum RTT in window
    const bestProbe = this.window.reduce(
      (min, p) => (p.rtt < min.rtt ? p : min),
      this.window[0]
    );

    // Exponential Moving Average (EMA) smoothing
    if (!this.isInitialized) {
      this.currentOffset = bestProbe.offset;
      this.isInitialized = true;
    } else {
      this.currentOffset =
        this.alpha * bestProbe.offset + (1 - this.alpha) * this.currentOffset;
    }

    return { offset: this.currentOffset, rtt: bestProbe.rtt, accepted: true };
  }

  public getOffset(): number {
    return this.currentOffset;
  }

  public reset(): void {
    this.window = [];
    this.currentOffset = 0;
    this.isInitialized = false;
  }
}
```

---

### File 2 (New): `src/lib/sync/pi-controller.ts`

**Purpose**: Implements the Proportional-Integral (PI) Playhead Slewing Controller with deadband, rate clamping, anti-windup, and direct seek triggers.

```typescript
export interface PIControllerConfig {
  kp: number; // default 0.05
  ki: number; // default 0.005
  minRate: number; // default 0.95
  maxRate: number; // default 1.05
  deadbandSec: number; // default 0.1 (100ms)
  hardSeekSec: number; // default 1.0 (1000ms)
}

export interface PIControllerOutput {
  slewRate: number;
  action: 'NONE' | 'SLEW' | 'SEEK';
  errorSec: number;
}

export class PISlewingController {
  private integralAccumulator: number = 0;
  private config: PIControllerConfig;

  constructor(config?: Partial<PIControllerConfig>) {
    this.config = {
      kp: 0.05,
      ki: 0.005,
      minRate: 0.95,
      maxRate: 1.05,
      deadbandSec: 0.1,
      hardSeekSec: 1.0,
      ...config,
    };
  }

  public compute(
    expectedTimeSec: number,
    actualTimeSec: number,
    dtSec: number,
    baseRate: number = 1.0
  ): PIControllerOutput {
    const errorSec = expectedTimeSec - actualTimeSec;
    const absErrorSec = Math.abs(errorSec);

    // Tier 3: Hard Seek threshold (> 1.0s)
    if (absErrorSec > this.config.hardSeekSec) {
      this.reset();
      return { slewRate: baseRate, action: 'SEEK', errorSec };
    }

    // Tier 1: Deadband zone (<= 100ms)
    if (absErrorSec <= this.config.deadbandSec) {
      this.integralAccumulator = 0;
      return { slewRate: baseRate, action: 'NONE', errorSec };
    }

    // Tier 2: PI Slewing zone (0.1s < |e| <= 1.0s)
    const dt = Math.max(0.01, dtSec);
    const potentialIntegral = this.integralAccumulator + errorSec * dt;
    const unconstrainedRate =
      baseRate + this.config.kp * errorSec + this.config.ki * potentialIntegral;

    const clampedRate = Math.min(
      Math.max(unconstrainedRate, this.config.minRate),
      this.config.maxRate
    );

    // Anti-Windup: Only update integral if unconstrained rate is within bounds
    if (unconstrainedRate === clampedRate) {
      this.integralAccumulator = potentialIntegral;
    }

    return { slewRate: clampedRate, action: 'SLEW', errorSec };
  }

  public reset(): void {
    this.integralAccumulator = 0;
  }
}
```

---

### File 3 (Modify): `src/lib/sync/use-sync-engine.ts`

**Changes**:
1. Import `ClockSyncEstimator` from `@/lib/sync/clock-sync`.
2. Maintain persistent instance via `const estimatorRef = useRef(new ClockSyncEstimator())`.
3. In `connect` handler, run 8 initial probes in rapid succession (50ms spacing).
4. Lower periodic re-sync interval from 30,000ms to 10,000ms.
5. In `clock:res` handler, pass timestamps to `estimatorRef.current.processProbe(t0, t1, t2, t3)` and update `stats` state with the smoothed offset and min-RTT.

```typescript
// Replace lines 136-141 with:
const estimatorRef = useRef(new ClockSyncEstimator());

const runClockProbe = useCallback((sock: Socket) => {
  sock.emit("clock:req", { t0: Date.now() });
}, []);

const runInitialProbeBurst = useCallback((sock: Socket) => {
  estimatorRef.current.reset();
  let count = 0;
  const burst = () => {
    if (count < 8 && sock.connected) {
      sock.emit("clock:req", { t0: Date.now() });
      count++;
      setTimeout(burst, 50);
    }
  };
  burst();
}, []);

// Update socket.on("connect") in useEffect:
sock.on("connect", () => {
  setStats((s) => ({ ...s, connected: true }));
  sock!.emit("room:join", { roomId, userId, name: userName });
  runInitialProbeBurst(sock!);
});

// Update socket.on("clock:res") in useEffect:
sock.on("clock:res", (p: { t0: number; t1: number; t2: number }) => {
  const t3 = Date.now();
  const res = estimatorRef.current.processProbe(p.t0, p.t1, p.t2, t3);
  setStats((s) => ({
    ...s,
    clockOffset: res.offset,
    rtt: res.rtt,
    lastDriftMs: Math.abs(res.offset),
  }));
});

// Update periodic clock interval from 30000ms to 10000ms:
const clockInterval = setInterval(() => {
  if (socketRef.current) runClockProbe(socketRef.current);
}, 10000);
```

---

### File 4 (Modify): `src/lib/sync/use-video-controller.ts`

**Changes**:
1. Import `PISlewingController` from `@/lib/sync/pi-controller`.
2. Instantiate controller via `const piControllerRef = useRef(new PISlewingController())`.
3. In incoming state `useEffect`:
   Calculate expected playhead:
   $$t_{\text{expected}} = \text{playback.currentTime} + \frac{(\text{Date.now()} + \text{clockOffset} - \text{playback.lastChangedAt})}{1000} \cdot \text{desiredRate}$$
   If `playback.seq !== lastAppliedSeq.current`: check if $|e_k| > 1.0\text{s}$ or initial join $\implies$ instant hard seek to $t_{\text{expected}}$.
4. In periodic ticker loop (500ms interval):
   Execute `piControllerRef.current.compute(expectedTime, videoEl.currentTime, dt, desiredRate)`.
   If action is `'SEEK'`, set `videoEl.currentTime = expectedTime`.
   If action is `'SLEW'`, set `videoEl.playbackRate = output.slewRate`.
   If action is `'NONE'`, set `videoEl.playbackRate = desiredRate`.

```typescript
// Add imports:
import { PISlewingController } from "./pi-controller";

// Inside hook:
const piControllerRef = useRef(new PISlewingController());
const lastTickTimeRef = useRef<number>(Date.now());

// In periodic drift check effect (500ms ticker):
useEffect(() => {
  const videoEl = videoRef.current;
  if (!videoEl || !playback || !playback.isPlaying || playback.videoType === "youtube" || playback.videoType === "iframe") return;

  const id = setInterval(() => {
    if (guardRef.current) return;
    const now = Date.now();
    const dt = (now - lastTickTimeRef.current) / 1000;
    lastTickTimeRef.current = now;

    const serverNow = now + clockOffset;
    const elapsed = (serverNow - playback.lastChangedAt) / 1000;
    const baseRate = playback.playbackRate || 1.0;
    const expected = playback.currentTime + elapsed * baseRate;
    const actual = videoEl.currentTime;

    const res = piControllerRef.current.compute(expected, actual, dt, baseRate);

    if (res.action === 'SEEK') {
      guardRef.current = true;
      videoEl.currentTime = expected;
      videoEl.playbackRate = baseRate;
      queueMicrotask(() => { guardRef.current = false; });
    } else if (res.action === 'SLEW') {
      videoEl.playbackRate = res.slewRate;
    } else {
      if (Math.abs(videoEl.playbackRate - baseRate) > 0.001) {
        videoEl.playbackRate = baseRate;
      }
    }
  }, 500);

  return () => clearInterval(id);
}, [videoRef, playback, clockOffset]);
```

---

### File 5 (Modify): `src/components/watchparty/universal-player.tsx`

**Changes**:
1. In `YouTubePlayer` component, instantiate `PISlewingController`.
2. On initial ready callback, perform frame-exact seek to expected room playhead:
   $$t_{\text{expected}} = \text{playback.currentTime} + \frac{(\text{Date.now()} + \text{clockOffset} - \text{playback.lastChangedAt})}{1000} \cdot \text{rate}$$
3. In `YouTubePlayer` periodic 500ms ticker, run PI controller. Apply rate via `playerRef.current.setPlaybackRate(res.slewRate)`. If action is `'SEEK'`, call `p.seekTo(expected, true)`.

---

### File 6 (Modify): `mini-services/sync-service/index.ts`

**Changes**:
Standardize timestamp handling for `clock:req`:
```typescript
socket.on("clock:req", (payload: { t0: number }) => {
  const t1 = Date.now();
  const t2 = Date.now();
  socket.emit("clock:res", { t0: payload?.t0 || 0, t1, t2 });
});
```

---

### File 7 (Modify): `package.json`

**Changes**:
Add `"test": "bun test"` script under `"scripts"`.

---

### File 8 (New): `src/lib/sync/__tests__/sync.test.ts`

**Purpose**: Comprehensive unit test suite verifying NTP math, min-RTT window filtering, outlier rejection, EMA offset smoothing, PI rate clamping, anti-windup, and expected playhead calculations.

```typescript
import { describe, expect, test, beforeEach } from "bun:test";
import { ClockSyncEstimator } from "../clock-sync";
import { PISlewingController } from "../pi-controller";

describe("Requirement R2: ClockSyncEstimator (Cristian's NTP & EMA)", () => {
  let sync: ClockSyncEstimator;

  beforeEach(() => {
    sync = new ClockSyncEstimator({ windowSize: 8, maxRttThresholdMs: 500, alpha: 0.2 });
  });

  test("calculates raw offset and RTT correctly for symmetrical network delay", () => {
    // Client send t0=1000, Server recv t1=1020, Server send t2=1020, Client recv t3=1040
    // RTT = (1040-1000) - (1020-1020) = 40ms. Offset = ((1020-1000) + (1020-1040))/2 = (20 + -20)/2 = 0
    const res = sync.processProbe(1000, 1020, 1020, 1040);
    expect(res.rtt).toBe(40);
    expect(res.offset).toBe(0);
    expect(res.accepted).toBe(true);
  });

  test("rejects outlier probes with RTT > 500ms", () => {
    // Probe 1: RTT = 60ms, Offset = +100ms
    sync.processProbe(1000, 1130, 1130, 1060);
    expect(sync.getOffset()).toBe(100);

    // Probe 2: Outlier with RTT = 600ms
    const outlierRes = sync.processProbe(1000, 1400, 1400, 1600);
    expect(outlierRes.accepted).toBe(false);
    expect(sync.getOffset()).toBe(100); // Offset unchanged
  });

  test("selects minimum RTT probe from sliding window and applies EMA smoothing", () => {
    // Initial probe: Offset = +100ms, RTT = 100ms -> initializes offset to 100
    sync.processProbe(1000, 1150, 1150, 1100);
    expect(sync.getOffset()).toBe(100);

    // Probe 2: High RTT sample (Offset = +200ms, RTT = 200ms)
    // Probe 3: Min RTT sample (Offset = +50ms, RTT = 20ms)
    sync.processProbe(2000, 2300, 2300, 2200); // offset +200
    sync.processProbe(3000, 3060, 3060, 3020); // offset +50, min RTT=20ms

    // EMA calculation: alpha * candidate + (1 - alpha) * prev
    // 0.2 * 50 + 0.8 * 100 = 10 + 80 = 90ms
    expect(sync.getOffset()).toBeCloseTo(90, 1);
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

  test("returns NONE action within deadband (|error| <= 100ms)", () => {
    const res = pi.compute(10.05, 10.0, 0.5, 1.0); // error = 0.05s (50ms)
    expect(res.action).toBe("NONE");
    expect(res.slewRate).toBe(1.0);
  });

  test("returns SEEK action when desync exceeds hard seek threshold (|error| > 1.0s)", () => {
    const res = pi.compute(12.5, 10.0, 0.5, 1.0); // error = 2.5s
    expect(res.action).toBe("SEEK");
    expect(res.slewRate).toBe(1.0);
  });

  test("computes PI slewing rate correctly for moderate lag", () => {
    // expected = 10.4s, actual = 10.0s, error = +0.4s (400ms lag)
    // dt = 0.5s
    // Integral = 0 + 0.4 * 0.5 = 0.2
    // Raw rate = 1.0 + 0.05 * 0.4 + 0.005 * 0.2 = 1.0 + 0.02 + 0.001 = 1.021
    const res = pi.compute(10.4, 10.0, 0.5, 1.0);
    expect(res.action).toBe("SLEW");
    expect(res.slewRate).toBeCloseTo(1.021, 3);
  });

  test("strictly clamps rate to [0.95, 1.05] and freezes integral on saturation", () => {
    // Large error within slewing range: error = +0.9s (900ms lag)
    // Raw rate = 1.0 + 0.05 * 0.9 + 0.005 * 0.45 = 1.04725
    const res1 = pi.compute(10.9, 10.0, 0.5, 1.0);
    expect(res1.slewRate).toBeLessThanOrEqual(1.05);

    // Extreme error: error = 0.99s, multiple steps to force saturation > 1.05
    for (let i = 0; i < 20; i++) {
      const res = pi.compute(10.99, 10.0, 0.5, 1.0);
      expect(res.slewRate).toBeLessThanOrEqual(1.05);
      expect(res.slewRate).toBeGreaterThanOrEqual(0.95);
    }
  });
});

describe("Requirement R2: Frame-Exact Expected Playhead Calculation", () => {
  test("calculates frame-exact room playhead for late joiners", () => {
    const roomBaseTime = 120.0; // 2 minutes in video timeline
    const lastChangedAt = 10000; // server ms timestamp when room state changed
    const clockOffset = 50; // client is 50ms behind server
    const clientNow = 15000; // client ms timestamp on join
    const playbackRate = 1.0;

    const serverNow = clientNow + clockOffset; // 15050 ms
    const elapsedSec = (serverNow - lastChangedAt) / 1000; // (15050 - 10000)/1000 = 5.05s
    const expectedPlayhead = roomBaseTime + elapsedSec * playbackRate; // 120.0 + 5.05 = 125.05s

    expect(expectedPlayhead).toBeCloseTo(125.05, 2);
  });
});
```

---

## 4. Summary of Verification Method

The Worker can independently verify the implementation by running:
1. `bun test` — Executes all unit tests in `src/lib/sync/__tests__/sync.test.ts`. All test cases for NTP math, EMA, PI rate bounds, anti-windup, and playhead calculations must pass cleanly with 0 failures.
2. `bun run build` — Validates TypeScript compilation and Next.js static build to ensure 0 TS/ESLint errors across all sync components.
