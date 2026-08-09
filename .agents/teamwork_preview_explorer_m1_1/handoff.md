# Handoff Report — Milestone 1 / Requirement R1 Technical Research & Specs

**Agent ID**: `teamwork_preview_explorer_m1_1`  
**Role**: Explorer Subagent  
**Working Directory**: `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_explorer_m1_1`  

---

## 1. Observation

Direct code examination was conducted on all relevant synchronization and video playback files across the workspace using `view_file` and `find_by_name`. The exact observations are detailed below:

1. **Client Clock Sync Implementation**:
   - File: `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/src/lib/sync/use-sync-engine.ts`
   - Lines 198–208:
     ```typescript
     sock.on("clock:res", (p: { t1: number; t2: number; t3: number }) => {
       const t4 = Date.now();
       const rtt = t4 - p.t1;
       const serverNow = p.t3 + rtt / 2;
       const offset = serverNow - t4;
       setStats((s) => ({
         ...s,
         clockOffset: offset,
         rtt,
         lastDriftMs: Math.abs(offset),
       }));
     });
     ```
   - Observed detail: RTT calculation `rtt = t4 - p.t1` uses $t_0$ (`p.t1`) and $t_3$ (`t4`), but omits server processing delay subtraction $(t_2 - t_1)$. Clock offset updating directly sets state without an RTT sliding window, min-RTT filter, or EMA smoothing ($\theta_k = \alpha \bar{\theta}_k + (1-\alpha)\theta_{k-1}$).

2. **Server Clock Sync Response**:
   - File: `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/mini-services/sync-service/index.ts`
   - Lines 179–184:
     ```typescript
     socket.on("clock:req", (payload: { t1: number }) => {
       const t2 = Date.now();
       const t3 = Date.now();
       socket.emit("clock:res", { t1: payload.t1, t2, t3 });
     });
     ```
   - Observed detail: The server transmits `t1` (client $t_0$), `t2` (server receive $t_1$), and `t3` (server transmit $t_2$).

3. **Video Playback & Slewing Rate Controller**:
   - File: `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/src/lib/sync/use-video-controller.ts`
   - Lines 114–129 (Incoming State Sync):
     ```typescript
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
     ```
   - Lines 156–166 (Periodic Drift Corrector Loop):
     ```typescript
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
     ```
   - Observed detail: Rate adjustment is implemented as binary discrete steps ($1.05\times$ or $0.95\times$) rather than a continuous Proportional-Integral (PI) controller with error-driven feedback $u(t) = 1.0 + K_p e(t) + K_i \int e(t) dt$.

4. **Universal Player Integration**:
   - File: `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/src/components/watchparty/universal-player.tsx`
   - Lines 69–74: `useVideoController` is currently wired to native HTML5/HLS/MP4 elements. YouTube drift handling (lines 532–549) uses discrete hard seek when drift exceeds 1.5 seconds.

---

## 2. Logic Chain

1. **Step 1 (NTP Probe Analysis)**: From Observation #1 and #2, the server sends timestamps $(t_0, t_1, t_2)$, and the client measures $t_3$. Currently, the client calculates $RTT = t_3 - t_0$ without subtracting server turnaround time $(t_2 - t_1)$. Subtracting $(t_2 - t_1)$ is mathematically required by Cristian's algorithm $\delta = (t_3 - t_0) - (t_2 - t_1)$ to eliminate server processing noise.
2. **Step 2 (Filtering & Smoothing)**: From Observation #1, every raw clock probe instantly updates `clockOffset`. Because network packets experience jitter, single-sample assignment causes client time jumps. Implementing a 8-sample sliding window, selecting the probe with minimum $\delta$, and applying an EMA filter ($\alpha = 0.2$) eliminates jitter spikes and stabilizes the offset.
3. **Step 3 (PI Controller Slewing)**: From Observation #3, the current rate adjustment applies step multipliers ($1.05\times$ / $0.95\times$) whenever desync exceeds $0.1\,\text{s}$ (100ms). This naive stepping causes rate chatter as playhead position oscillates around the boundary. Replacing step multipliers with a Proportional-Integral (PI) controller $u(t) = 1.0 + K_p e(t) + K_i \int e(t) dt$ clamped strictly to $[0.95, 1.05]$ with anti-windup ensures smooth, seamless drift correction without audio pops or micro-stutters.
4. **Step 4 (Technical Specification & Blueprint)**: Synthesizing Steps 1–3 into `analysis.md` provides an exact mathematical model and ready-to-implement TypeScript blueprints for Milestone 2 (`ClockSyncEstimator` and `PISlewingController`).

---

## 3. Caveats

1. **YouTube IFrame API Limitation**: YouTube IFrame API has limited support for arbitrary playback rate micro-adjustments (only standard steps like 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2 are officially supported). Slewing rate control is primarily effective for native HTML5 `<video>` / HLS (.m3u8) streams. YouTube playback relies on periodic hard seek when desync exceeds 1.0–1.5 seconds.
2. **Read-Only Scope**: In compliance with Explorer role rules, no source files in `src/` or `mini-services/` were modified. Code changes will be executed during Milestone 2 by the Implementer agent.

---

## 4. Conclusion

Milestone 1 / Requirement R1 technical research and architectural specification is complete:
- Mathematical models for Cristian's Algorithm, RTT filtering, EMA offset smoothing, and PI playhead slewing controller are fully documented in `analysis.md`.
- Gap analysis of current codebase (`src/lib/sync/use-sync-engine.ts` and `src/lib/sync/use-video-controller.ts`) is documented with exact line references.
- Concrete TypeScript design patterns (`ClockSyncEstimator` and `PISlewingController`) are authored in `analysis.md` for seamless implementation in Milestone 2.

---

## 5. Verification Method

To independently verify this investigation and handoff:
1. **Inspect Analysis Report**: View `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_explorer_m1_1/analysis.md`. Verify that Section 1 contains all mathematical formulas, Section 2 contains the gap analysis, and Section 3 contains the proposed code blueprints.
2. **Inspect Existing Files**:
   - View `src/lib/sync/use-sync-engine.ts` at line 198 to verify the current clock sync math.
   - View `src/lib/sync/use-video-controller.ts` at line 114 to verify the current naive step rate adjustment.
3. **Invalidation Conditions**: The conclusions would be invalidated if `src/lib/sync/use-sync-engine.ts` already contained EMA smoothing or if `src/lib/sync/use-video-controller.ts` already contained integral accumulation logic.
