# Empirical Challenge & Verification Report: Milestone 2 State Synchronization Engine

**Subagent ID**: `teamwork_preview_challenger_m2_1`  
**Verdict**: **APPROVE**  
**Timestamp**: 2026-08-09T19:01:00Z  

---

## 1. Observation

Direct observations from codebase inspection and empirical command execution:

1. **Clock Sync Estimator (`src/lib/sync/clock-sync.ts`)**:
   - `maxRttThresholdMs = 500`: Probes with $\text{RTT} > 500\text{ms}$ return `{ accepted: false, offset: this.currentOffset }` (lines 46–53) and are excluded from the sliding window.
   - Minimum RTT probe selection: `this.window.reduce((min, p) => (p.rtt < min.rtt ? p : min), ...)` (lines 62–65).
   - EMA smoothing: `this.currentOffset = alpha * bestProbe.offset + (1 - alpha) * this.currentOffset` with $\alpha = 0.2$ (lines 72–74).

2. **PI Slewing Controller (`src/lib/sync/pi-controller.ts`)**:
   - Hard Seek (> 1.0s): `if (absErrorSec > 1.0) { this.reset(); return { slewRate: baseRate, action: "SEEK" }; }` (lines 41–45).
   - Deadband ($\le 100\text{ms}$): `if (absErrorSec <= 0.1) { this.integralAccumulator = 0; return { slewRate: baseRate, action: "NONE" }; }` (lines 47–51).
   - Rate Clamping & Anti-Windup: Rate $u_k$ is strictly clamped to $[0.95, 1.05]$ relative to base rate. Anti-windup guard `if (unconstrainedRate === clampedRate)` freezes `integralAccumulator` on saturation (lines 62–70).

3. **Empirical Command Results**:
   - Executed command `bun test`:
     ```text
     34 pass, 0 fail, 1091 expect() calls
     Ran 34 tests across 3 files. [86.00ms]
     ```
   - Executed command `bun run build`:
     ```text
     ✓ Compiled successfully in 1849ms
     ✓ Generating static pages using 7 workers (3/3) in 691ms
     Exit code: 0
     ```

---

## 2. Logic Chain

1. **Observation**: `ClockSyncEstimator` checks `if (rtt > this.maxRttThresholdMs)` before adding probes to `this.window`.
   - **Reasoning**: In extreme jitter scenarios (e.g., RTT spiking from 20ms to 800ms or 1200ms), probes with $\text{RTT} > 500\text{ms}$ are rejected outright (`accepted === false`).
   - **Empirical Proof**: Added test `STRESS: extreme latency jitter (20ms -> 800ms -> 1200ms -> 501ms)` and `STRESS: rapid high-jitter burst`. Probes with RTT 800ms, 1200ms, and 501ms were rejected while maintaining clock offset precision at 50ms / 100ms.

2. **Observation**: `PISlewingController` checks `if (unconstrainedRate === clampedRate)` before updating `integralAccumulator`.
   - **Reasoning**: Under sustained large errors (+800ms or -800ms lag/lead), `unconstrainedRate` exceeds 1.05 or falls below 0.95. The anti-windup guard freezes `integralAccumulator` at saturation ($\approx 2.0$), preventing exponential integral growth to infinity. When error returns to moderate levels (+200ms), slewing rate immediately recovers to normal range ($\approx 1.019x$) without lagging or remaining stuck at bounds.
   - **Empirical Proof**: Executed 100-step sustained error test (`STRESS: large positive accumulative error (+800ms)` and `STRESS: large negative accumulative error (-800ms)`). `slewRate` remained strictly clamped to $[0.95, 1.05]$ and recovered instantly upon error reduction.

3. **Observation**: `PISlewingController` returns `action: "NONE"`, `slewRate: 1.0`, and resets `integralAccumulator = 0` when $|e_k| \le 0.1\text{s}$.
   - **Reasoning**: Small jitter within the 100ms deadband does not trigger rate toggling or video element playback rate adjustments. Resetting integral accumulator upon deadband entry prevents accumulated bias from causing overshoot when exiting deadband.
   - **Empirical Proof**: Executed boundary precision tests at 99ms, 100ms, 101ms and rapid 20-cycle deadband toggling tests (`STRESS: deadband boundary precision and anti-oscillation`). Deadband strictly held at 1.0x rate with `NONE` action.

4. **Observation**: Executed `bun test` and `bun run build`.
   - **Reasoning**: All 34 tests passed cleanly with zero failures and the Next.js production build succeeded with exit code 0.

---

## 3. Caveats

- **Network Interface Failure / Disconnect**: The NTP estimator relies on periodic WebSocket pings (`clock:req`/`clock:res`). If connection drops entirely, `useSyncEngine` retains the last estimated offset until re-connected.
- **Player-Specific Playback Rate Precision**: HTML5 `<video>` elements support arbitrary float rates (e.g. 1.021x). YouTube iFrame API accepts fine-grained rate values via `setPlaybackRate()`, though browser audio pitch correction depends on browser WebAudio implementation.

---

## 4. Conclusion

### **Verdict**: **APPROVE**

Milestone 2 State Synchronization Engine satisfies all mathematical, architectural, and reliability requirements specified in `TECHNICAL_SPECIFICATION.md` and `ORIGINAL_REQUEST.md`. Specifically:
- **Outlier Rejection**: $>500\text{ms}$ RTT probes are strictly filtered out without corrupting the min-RTT sliding window or clock offset EMA.
- **PI Controller Bounds & Anti-Windup**: Continuous rate slewing is strictly bounded to $[0.95, 1.05]$ with functional anti-windup integral freezing.
- **Deadband Stability**: $|e_k| \le 100\text{ms}$ deadband prevents high-frequency playback rate toggling and clears integral bias.
- **Build & Test Quality**: 100% test pass rate across 34 tests and clean production build.

---

## 5. Verification Method

To independently verify this verdict:

1. **Run full stress and unit test suite**:
   ```bash
   bun test
   ```
   *Expected Output*: `34 pass, 0 fail` across `src/__tests__/sync-engine.test.ts`, `src/lib/sync/__tests__/sync.test.ts`, and `src/lib/sync/__tests__/empirical-verification.test.ts`.

2. **Run production build**:
   ```bash
   bun run build
   ```
   *Expected Output*: Exit code 0, `✓ Compiled successfully`.

3. **Inspect primary test file**:
   - `src/__tests__/sync-engine.test.ts`
