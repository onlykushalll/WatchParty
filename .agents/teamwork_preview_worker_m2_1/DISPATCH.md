## 2026-08-09T18:56:15Z
You are a Worker subagent (ID: teamwork_preview_worker_m2_1).
Working directory: c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_worker_m2_1

Mandatory Input Files:
- Original Request: c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/ORIGINAL_REQUEST.md
- Project Scope: c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/PROJECT.md
- Technical Specification: c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/orchestrator_1/TECHNICAL_SPECIFICATION.md
- Explorer M2 Blueprint: c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_explorer_m2_1/analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Exclusive File Ownership:
- `src/lib/sync/clock-sync.ts`
- `src/lib/sync/pi-controller.ts`
- `src/lib/sync/use-sync-engine.ts`
- `src/components/watchparty/universal-player.tsx`
- `mini-services/sync-service/index.ts`
- `src/__tests__/sync-engine.test.ts` (or `src/lib/sync/__tests__/sync.test.ts`)

Task:
Implement Milestone 2 / Requirement R2 (Authoritative State Synchronization Engine):
1. **ClockSyncEstimator (`src/lib/sync/clock-sync.ts`)**:
   - Implement Cristian's NTP probes (8 initial probes on socket connection, 10s periodic probes).
   - RTT calculation: $\delta = (t_3 - t_0) - (t_2 - t_1)$. Reject probes with RTT > 500ms.
   - Sliding-window min-RTT filter over recent 8 probes.
   - Exponential Moving Average (EMA) smoothing for offset: $\theta_k = \alpha \cdot \bar{\theta}_{min} + (1-\alpha) \cdot \theta_{k-1}$ with $\alpha = 0.2$.
2. **PISlewingController (`src/lib/sync/pi-controller.ts`)**:
   - Compute expected target room playhead position: $t_{expected} = t_{room\_base} + (\text{now} + \theta - t_{sync}) \cdot \text{rate}$.
   - Error: $e_k = t_{expected} - t_{actual}$.
   - Deadband ($|e_k| \le 0.1\text{s}$): $u_k = 1.0$, reset integral $I_k = 0$.
   - Hard Seek ($|e_k| > 1.0\text{s}$): return direct seek action, reset $I_k = 0$.
   - Rate Slewing ($0.1\text{s} < |e_k| \le 1.0\text{s}$): $u_k = 1.0 + K_p e_k + K_i I_k$ with $K_p = 0.05, K_i = 0.005$. Clamp $u_k \in [0.95, 1.05]$. Freeze $I_k$ when clamped (anti-windup).
3. **Player Adapters & Universal Player Component (`src/components/watchparty/universal-player.tsx`)**:
   - Hook up playback rate slewing to YouTube API (`player.setPlaybackRate`), HLS.js (`video.playbackRate`), and native HTML5 MP4 (`video.playbackRate`).
   - Frame-exact initial join synchronization for late joiners (instant seek to calculated expected room playhead without manual seeking).
4. **Backend Sync Service (`mini-services/sync-service/index.ts`)**:
   - Update server time responder for NTP ping (`ntp_ping` -> `ntp_pong` with high-precision timestamp).
5. **Unit Test Suite (`src/__tests__/sync-engine.test.ts`)**:
   - Add unit tests for NTP probe RTT math, outlier rejection, EMA offset calculations, PI controller rate clamping [0.95, 1.05], anti-windup, deadband, and hard seek thresholds.
6. **Build & Test Verification**:
   - Run `bun test` or `npm test` (or `npx vitest`/`jest`) to verify tests pass.
   - Run `bun run build` (or `npm run build`) to ensure 0 TypeScript / ESLint errors.

Output:
Write your implementation summary to `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_worker_m2_1/changes.md` and deliver your handoff report to `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_worker_m2_1/handoff.md`. Include exact build and test command outputs in your handoff report. Communicate back to parent when complete.
