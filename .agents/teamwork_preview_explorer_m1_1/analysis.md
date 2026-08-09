# Comprehensive Technical Analysis & Architecture Specification
**Milestone 1 / Requirement R1: Authoritative NTP Clock Sync & PI Playhead Slewing Controller**

---

## Executive Summary

This report establishes the complete technical specification for **Milestone 1 / Requirement R1** of WatchParty: a production-grade, sub-100ms real-time video synchronization system. It details the mathematical model for Cristian's NTP clock synchronization algorithm, sliding-window RTT filtering with outlier rejection, Exponential Moving Average (EMA) offset smoothing, and a Proportional-Integral (PI) playhead slewing controller. Furthermore, it audits the existing codebase (`src/lib/sync` and `mini-services/sync-service`), identifying current capabilities, architectural gaps, and providing an actionable refactoring blueprint for Milestone 2 implementation.

---

## Section 1: NTP Clock Sync & Cristian's Algorithm Specification

### 1.1 Network Probing Protocol & Timestamps
Synchronization between client and server relies on periodic 4-timestamp probes over WebSocket/Socket.IO connections.

```
Client                                  Server
  |                                       |
  |--- t_0: Probe Request (clock:req) --->|
  |                                       |--- t_1: Server Receive
  |                                       |--- t_2: Server Transmit (clock:res)
  |<-- t_3: Probe Response ---------------|
  |
```

- $t_0$: Client local timestamp when `clock:req` is transmitted (ms).
- $t_1$: Server local timestamp when `clock:req` is received (ms).
- $t_2$: Server local timestamp when `clock:res` is dispatched (ms).
- $t_3$: Client local timestamp when `clock:res` is received (ms).

### 1.2 Mathematical Formulas

#### Round-Trip Time (RTT) $\delta$
The network round-trip time excludes internal server processing latency:
$$\delta = (t_3 - t_0) - (t_2 - t_1)$$

#### Raw Clock Offset $\bar{\theta}$
The difference between server time and client time measured during probe $k$:
$$\bar{\theta}_k = \frac{(t_1 - t_0) + (t_2 - t_3)}{2}$$

By convention:
$$\text{ServerTime} \approx \text{ClientTime} + \bar{\theta}$$

---

### 1.3 RTT Filtering & Outlier Rejection
Network latency over WebSockets is subject to packet jitter, bufferbloat, and garbage collection pauses. Raw offset measurements from delayed probes introduce artificial clock drift.

#### Filtering Strategy:
1. **Sliding Window Buffer**: Maintain a FIFO buffer $W = \{(\delta_i, \bar{\theta}_i)\}_{i=1}^N$ of size $N = 8$ probe samples.
2. **Absolute Threshold Gate**: Discard any sample where $\delta_i > \delta_{\text{max}}$ (e.g., $\delta_{\text{max}} = 500\,\text{ms}$).
3. **Minimum RTT Selection**: Select candidate offset $\bar{\theta}_{\text{best}}$ from probe $j$ that minimizes RTT:
   $$j = \arg\min_{i \in W} \delta_i, \quad \bar{\theta}_{\text{candidate}} = \bar{\theta}_j$$
   *Rationale*: Minimal RTT corresponds to symmetrical path delay with negligible queuing delay, yielding the maximum precision clock offset.

---

### 1.4 Exponential Moving Average (EMA) Offset Smoothing
To prevent step changes and high-frequency noise from destabilizing the estimated server time, candidate offsets are filtered using an EMA controller.

#### Mathematical Model:
$$\theta_k = \alpha \cdot \bar{\theta}_{\text{candidate}} + (1 - \alpha) \cdot \theta_{k-1}$$

- $\theta_k$: Smoothed clock offset at step $k$.
- $\alpha$: Smoothing factor ($0 < \alpha \le 1$). Recommended default $\alpha = 0.2$.
- **Initialization**: $\theta_0 = \bar{\theta}_0$ on the first valid probe response.

---

### 1.5 Proportional-Integral (PI) Playhead Slewing Controller

Instead of hard-seeking video position during minor drift, a PI continuous controller dynamically modulates the HTML5 `<video>` playback rate to converge $t_{\text{actual}}$ onto $t_{\text{expected}}$.

#### 1.5.1 Drift Error Signal Calculation
At any time $t$:
$$t_{\text{expected}}(t) = t_{\text{auth\_start}} + \left((t_{\text{client\_now}} + \theta_k) - t_{\text{last\_changed\_at}}\right) \cdot r_{\text{authoritative}}$$
$$t_{\text{actual}}(t) = \text{video.currentTime}$$
$$e(t) = t_{\text{expected}}(t) - t_{\text{actual}}(t)$$

Where $e(t) > 0$ implies the local video is lagging behind the authoritative room playhead.

#### 1.5.2 Continuous Control Law
$$\text{slew rate}(t) = 1.0 + K_p \cdot e(t) + K_i \int_{0}^{t} e(\tau) \, d\tau$$

#### 1.5.3 Discrete-Time Implementation & Anti-Windup Guard
Executed on player ticker loop (interval $\Delta t \approx 250\,\text{ms}$ or $500\,\text{ms}$):

1. **Error Calculation**:
   $$e_k = t_{\text{expected}}(t_k) - t_{\text{actual}}(t_k)$$

2. **Discrete Integration**:
   $$I_k = I_{k-1} + e_k \cdot \Delta t$$

3. **Unconstrained Control Signal**:
   $$u_k = 1.0 + K_p \cdot e_k + K_i \cdot I_k$$

4. **Strict Clamping**:
   $$\text{slew rate}_k = \text{clamp}(u_k, 0.95, 1.05)$$

5. **Clamped Anti-Windup Guard**:
   $$\text{If } u_k \neq \text{slew rate}_k, \quad \text{freeze integral: } I_k = I_{k-1}$$

#### 1.5.4 Multi-Tier Drift Threshold Protocol
- **Tier 1: Deadband Zone ($|e_k| \le 100\,\text{ms}$)**
  - Action: No adjustment required. Set $\text{slew rate} = 1.0$, reset integral accumulator $I_k = 0$.
  - Rationale: Human perception cannot distinguish $<100\,\text{ms}$ desync. Prevents continuous rate hunting.
- **Tier 2: Slewing Zone ($100\,\text{ms} < |e_k| \le 1000\,\text{ms}$)**
  - Action: Active PI rate control strictly clamped to $[0.95, 1.05]$.
  - Rationale: Smoothly eliminates drift over $2\text{--}5$ seconds without audio pitch artifacts or video stutter.
- **Tier 3: Hard Seek Zone ($|e_k| > 1000\,\text{ms}$)**
  - Action: Instant seek `video.currentTime = t_expected`, reset $I_k = 0$, restore rate to 1.0.
  - Rationale: Large gaps (e.g. initial join, seek, network drop) cannot be caught up within reasonable time via slewing.

---

## Section 2: Codebase Audit & Current State Analysis

### 2.1 Summary of Existing Sync Codebase

| File Path | Description | Current Capabilities |
|---|---|---|
| `src/lib/sync/types.ts` | Type definitions & video type detector | `PlaybackState` includes `isPlaying`, `currentTime`, `playbackRate`, `lastChangedAt`, `seq`. |
| `src/lib/sync/use-sync-engine.ts` | Client WebSocket connection & state engine | Emits `clock:req`, listens to `clock:res`, maintains room state & presence. |
| `src/lib/sync/use-video-controller.ts` | Client video controller hook | Echo-loop guard, 200ms seek debounce, basic 3-tier drift check. |
| `src/components/watchparty/universal-player.tsx` | Player UI wrapper component | Integrates HTML5, HLS.js, YouTube API, and iframe fallback. |
| `mini-services/sync-service/index.ts` | Standalone Socket.IO backend service (Port 3003) | Handles `clock:req`, authoritative state sequencing (`seq++`), presence, queue, chat. |

---

### 2.2 Detailed Gap Analysis

#### Gap 1: Incomplete Cristian's Algorithm Math Formula
- **Location**: `src/lib/sync/use-sync-engine.ts:198-208`
- **Observed Implementation**:
  ```typescript
  sock.on("clock:res", (p: { t1: number; t2: number; t3: number }) => {
    const t4 = Date.now();
    const rtt = t4 - p.t1;
    const serverNow = p.t3 + rtt / 2;
    const offset = serverNow - t4;
    ...
  });
  ```
- **Deficiency**: The client receives payload `p` containing `{ t1, t2, t3 }`, but calculates `rtt = t4 - t1`, ignoring server processing time $(t2 - t1)$. Furthermore, in `mini-services/sync-service/index.ts:179-184`, the server captures `t2 = Date.now()` and `t3 = Date.now()` synchronously back-to-back.
- **Correction**: The full Cristian formula $\delta = (t_3 - t_0) - (t_2 - t_1)$ and $\bar{\theta} = \frac{(t_1 - t_0) + (t_2 - t_3)}{2}$ must be explicitly calculated using all four distinct timestamps $(t_0, t_1, t_2, t_3)$.

#### Gap 2: Absence of RTT Filtering & Outlier Rejection
- **Location**: `src/lib/sync/use-sync-engine.ts:198-208`
- **Observed Implementation**: Every single response directly updates state: `clockOffset: offset`.
- **Deficiency**: Single latency spikes immediately distort the client clock estimate. No sliding window or minimum RTT selection exists.

#### Gap 3: Absence of EMA Clock Offset Smoothing
- **Location**: `src/lib/sync/use-sync-engine.ts:203`
- **Observed Implementation**: No exponential moving average filter $\theta_k = \alpha \bar{\theta}_k + (1-\alpha)\theta_{k-1}$ is present. Offset jumps discretely on every probe update.

#### Gap 4: Naive Rate Adjustments vs. PI Controller
- **Location**: `src/lib/sync/use-video-controller.ts:117-129` & `160-166`
- **Observed Implementation**:
  ```typescript
  if (actualTime < expectedTime) {
    videoEl.playbackRate = Math.max(desiredRate * 1.05, 0.1);
  } else {
    videoEl.playbackRate = Math.max(desiredRate * 0.95, 0.1);
  }
  ```
- **Deficiency**: The existing controller switches binary playback rates (1.05x or 0.95x) as discrete steps. It lacks Proportional feedback proportional to error magnitude $e(t)$ and Integral accumulation $I_k$. This produces rate chatter and overshoot around the $100\,\text{ms}$ threshold.

---

## Section 3: Proposed Implementation Blueprint (Milestone 2)

### 3.1 Refactored Clock Synchronization Helper (`src/lib/sync/clock-sync.ts`)

```typescript
export interface ClockProbe {
  t0: number; // Client send
  t1: number; // Server receive
  t2: number; // Server transmit
  t3: number; // Client receive
  rtt: number;
  offset: number;
}

export class ClockSyncEstimator {
  private window: ClockProbe[] = [];
  private windowSize: number = 8;
  private maxRttThreshold: number = 500; // ms
  private alpha: number = 0.2; // EMA smoothing factor
  private currentOffset: number = 0;
  private initialized: boolean = false;

  public processResponse(t0: number, t1: number, t2: number, t3: number): { offset: number; rtt: number } {
    // 1. Full Cristian's RTT calculation excluding server delay (t2 - t1)
    const serverProcessing = Math.max(0, t2 - t1);
    const rtt = (t3 - t0) - serverProcessing;

    // 2. Exact Cristian's Clock Offset
    const rawOffset = ((t1 - t0) + (t2 - t3)) / 2;

    // 3. Outlier rejection gate
    if (rtt <= this.maxRttThreshold) {
      this.window.push({ t0, t1, t2, t3, rtt, offset: rawOffset });
      if (this.window.length > this.windowSize) {
        this.window.shift();
      }
    }

    // 4. Select candidate with minimum RTT from window
    if (this.window.length > 0) {
      const bestProbe = this.window.reduce((min, p) => (p.rtt < min.rtt ? p : min), this.window[0]);
      
      // 5. Exponential Moving Average (EMA) smoothing
      if (!this.initialized) {
        this.currentOffset = bestProbe.offset;
        this.initialized = true;
      } else {
        this.currentOffset = this.alpha * bestProbe.offset + (1 - this.alpha) * this.currentOffset;
      }
    }

    return { offset: this.currentOffset, rtt };
  }
}
```

### 3.2 Proportional-Integral (PI) Slewing Controller (`src/lib/sync/pi-controller.ts`)

```typescript
export interface PIControllerConfig {
  kp: number; // e.g. 0.05
  ki: number; // e.g. 0.01
  minRate: number; // 0.95
  maxRate: number; // 1.05
  deadbandMs: number; // 100 ms
  hardSeekMs: number; // 1000 ms
}

export class PISlewingController {
  private integralAccumulator: number = 0;
  private config: PIControllerConfig;

  constructor(config?: Partial<PIControllerConfig>) {
    this.config = {
      kp: 0.08,
      ki: 0.01,
      minRate: 0.95,
      maxRate: 1.05,
      deadbandMs: 100,
      hardSeekMs: 1000,
      ...config,
    };
  }

  public compute(errorSeconds: number, dtSeconds: number, baseRate: number = 1.0): {
    slewRate: number;
    action: 'NONE' | 'SLEW' | 'SEEK';
  } {
    const errorMs = errorSeconds * 1000;
    const absErrorMs = Math.abs(errorMs);

    // Tier 3: Hard Seek
    if (absErrorMs > this.config.hardSeekMs) {
      this.reset();
      return { slewRate: baseRate, action: 'SEEK' };
    }

    // Tier 1: Deadband
    if (absErrorMs <= this.config.deadbandMs) {
      this.integralAccumulator = 0;
      return { slewRate: baseRate, action: 'NONE' };
    }

    // Tier 2: PI Slewing
    const e = errorSeconds;
    const nextIntegral = this.integralAccumulator + e * dtSeconds;
    const unconstrainedRate = baseRate + this.config.kp * e + this.config.ki * nextIntegral;

    // Strict Clamping [0.95, 1.05]
    const clampedRate = Math.min(Math.max(unconstrainedRate, this.config.minRate), this.config.maxRate);

    // Anti-windup: Freeze integral if saturated
    if (unconstrainedRate === clampedRate) {
      this.integralAccumulator = nextIntegral;
    }

    return { slewRate: clampedRate, action: 'SLEW' };
  }

  public reset(): void {
    this.integralAccumulator = 0;
  }
}
```

---

## Conclusion
This specification establishes a robust mathematical foundation for NTP clock synchronization and video playhead slewing. The gap analysis highlights exact line locations in the existing codebase that require enhancement during Milestone 2.
