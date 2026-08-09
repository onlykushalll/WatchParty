# Handoff Report: Milestone 2 (Authoritative State Synchronization Engine)

**Agent ID**: `teamwork_preview_explorer_m2_1`  
**Role**: Explorer  
**Target Milestone**: Milestone 2 / Requirement R2 (Authoritative State Synchronization Engine)  

---

## 1. Observation

Direct observations from codebase inspection across `src/lib/sync/`, `src/components/watchparty/`, `mini-services/sync-service/`, and `package.json`:

1. **Existing Clock Synchronization Protocol**:
   - `src/lib/sync/use-sync-engine.ts:198-208`:
     ```typescript
     sock.on("clock:res", (p: { t1: number; t2: number; t3: number }) => {
       const t4 = Date.now();
       const rtt = t4 - p.t1;
       const serverNow = p.t3 + rtt / 2;
       const offset = serverNow - t4;
       setStats((s) => ({ ...s, clockOffset: offset, rtt, lastDriftMs: Math.abs(offset) }));
     });
     ```
     - Emits single `clock:req` on connect and every 30s.
     - Calculates RTT as `t4 - p.t1`, ignoring server processing delay $(t_2 - t_1)$.
     - Lacks 8-probe initial burst, 10s interval, sliding window min-RTT filtering ($N=8$), outlier rejection ($\delta > 500\text{ms}$), and EMA offset estimation ($\alpha=0.2$).

2. **Existing Playhead Control Logic**:
   - `src/lib/sync/use-video-controller.ts:114-130`:
     ```typescript
     if (delta > 1.5) {
       videoEl.currentTime = expectedTime;
       softRateRef.current = 1;
     } else if (delta > 0.1) {
       if (actualTime < expectedTime) {
         videoEl.playbackRate = Math.max(desiredRate * 1.05, 0.1);
       } else {
         videoEl.playbackRate = Math.max(desiredRate * 0.95, 0.1);
       }
     }
     ```
     - Employs binary step adjustment ($1.05\times$ or $0.95\times$) rather than continuous Proportional-Integral feedback control ($K_p=0.05, K_i=0.005$).
     - Hard seek threshold is set to $1.5\text{s}$ instead of $1.0\text{s}$.
     - Lacks integral anti-windup guard.

3. **Existing YouTube Player Integration**:
   - `src/components/watchparty/universal-player.tsx:532-550`:
     - Checks desync every 2000ms and performs hard seeks when desync $>1.5\text{s}$.
     - Lacks continuous PI rate slewing via YouTube API `setPlaybackRate(u_k)`.

4. **Existing Backend Sync Handshake**:
   - `mini-services/sync-service/index.ts:179-184`:
     ```typescript
     socket.on("clock:req", (payload: { t1: number }) => {
       const t2 = Date.now();
       const t3 = Date.now();
       socket.emit("clock:res", { t1: payload.t1, t2, t3 });
     });
     ```
     - Non-standard timestamp payload names (`t1` in payload was client send timestamp).

5. **Test Runner & Existing Tests**:
   - `package.json`: No test script configured. No existing test files in `src/` or `tests/`.

---

## 2. Logic Chain

1. **Observation**: Client offset is overwritten directly by raw response data without RTT filtering or low-pass smoothing.
   **Inference**: Transient network jitter or latency spikes cause immediate jumps in estimated server clock, resulting in artificial desync.
   **Deduction**: Implementing Cristian's algorithm with min-RTT window filtering ($N=8$), outlier rejection ($\delta > 500\text{ms}$), and EMA smoothing ($\theta_k = \alpha \cdot \bar{\theta}_{\min} + (1-\alpha) \cdot \theta_{k-1}$) in `ClockSyncEstimator` isolates true server time and eliminates jitter.

2. **Observation**: The current playhead controller toggles speed between discrete $1.05\times$ and $0.95\times$ steps with a 1.5s seek threshold.
   **Inference**: Step adjustments create rate chatter around the 100ms boundary and audio pitch artifacts, while the 1.5s threshold allows noticeable desync before triggering hard seeks.
   **Deduction**: A continuous PI controller ($u_k = 1.0 + K_p e_k + K_i I_k$, $K_p=0.05, K_i=0.005$) clamped to $[0.95, 1.05]$ with anti-windup, 100ms deadband, and 1.0s hard seek threshold eliminates drift smoothly without audio pops.

3. **Observation**: Late joiners and multi-provider players require uniform expected playhead calculation.
   **Inference**: Without uniform expected time computation ($t_{\text{expected}} = t_{\text{room\_base}} + (\text{now} + \theta - t_{\text{sync}}) \cdot \text{rate}$), late joiners or YouTube users desynchronize from HTML5/HLS users.
   **Deduction**: Universal player adapters must call `setPlaybackRate` / `playbackRate` and perform instant seeks on join using the exact frame-exact playhead formula.

---

## 3. Caveats

- **YouTube API Rate Slewing Granularity**: The YouTube IFrame API supports `setPlaybackRate()`. Some browser engines or embedded players round suggested playback rates to standard values ($0.25, 0.5, 0.75, 1, 1.25, 1.5, 2.0$). For YouTube, small slewing rate adjustments ($0.95\times\text{--}1.05\times$) work when supported; if the YouTube player ignores fine rate modulation, periodic drift checks will trigger a micro-seek to align playhead when drift exceeds 1.0s.
- **Audio Pitch Correction**: Standard HTML5 `<video>` elements preserve audio pitch by default (`preservesPitch = true`). Slewing between $0.95\times$ and $1.05\times$ falls within standard human perceptual pitch compensation.

---

## 4. Conclusion

Milestone 2 requires implementing two core engine modules (`ClockSyncEstimator` in `src/lib/sync/clock-sync.ts` and `PISlewingController` in `src/lib/sync/pi-controller.ts`), refactoring `use-sync-engine.ts`, `use-video-controller.ts`, `universal-player.tsx`, and `mini-services/sync-service/index.ts`, and creating a comprehensive unit test suite in `src/lib/sync/__tests__/sync.test.ts`.

All design details, code blueprints, mathematical models, and exact file modification instructions are documented in `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_explorer_m2_1/analysis.md`.

---

## 5. Verification Method

### 5.1 Command Line Verification

1. **Unit Test Execution**:
   Run:
   ```powershell
   bun test
   ```
   **Expected Result**: All tests in `src/lib/sync/__tests__/sync.test.ts` pass cleanly (0 failures), validating:
   - Cristian's RTT calculation & 4-timestamp formula
   - Outlier rejection for $\delta > 500\text{ms}$
   - Sliding window min-RTT selection & EMA offset estimation ($\alpha=0.2$)
   - PI controller deadband (100ms), slewing math ($K_p=0.05, K_i=0.005$), rate clamping $[0.95, 1.05]$, anti-windup, and hard seek ($>1.0\text{s}$)
   - Late-joiner frame-exact playhead calculation

2. **TypeScript & Build Verification**:
   Run:
   ```powershell
   bun run build
   ```
   **Expected Result**: Next.js production build succeeds with 0 TypeScript and 0 ESLint errors.

### 5.2 Files to Inspect
- `src/lib/sync/clock-sync.ts`
- `src/lib/sync/pi-controller.ts`
- `src/lib/sync/use-sync-engine.ts`
- `src/lib/sync/use-video-controller.ts`
- `src/components/watchparty/universal-player.tsx`
- `mini-services/sync-service/index.ts`
- `src/lib/sync/__tests__/sync.test.ts`
- `package.json`

### 5.3 Invalidation Conditions
- Any unit test failure in `bun test`.
- Rate clamping breaking out of $[0.95, 1.05]$.
- Hard seeks occurring for minor drifts $< 1.0\text{s}$.
- Integral accumulation continuing while rate is saturated (anti-windup violation).
