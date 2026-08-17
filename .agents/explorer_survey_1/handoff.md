# Handoff Report — State Synchronization Engine Investigation

**Agent**: Explorer Survey Agent 1  
**Target File**: `c:\Users\Default.L-HCG-9FVVGS3\OneDrive\Desktop\WatchParty\.agents\explorer_survey_1\handoff.md`  
**Date**: 2026-08-17  
**Handoff Type**: Hard (Task Complete)

---

## 1. Observation

Direct code inspections and test executions revealed the following verified facts:

1. **Test Suite Baseline**:
   - Tool Command: `bun test`
   - Output Result: `74 pass, 0 fail, 1680 expect() calls` across 5 test files (`sync-engine.test.ts`, `sync.test.ts`, `empirical-verification.test.ts`, `m4-empirical-verification.test.ts`, `vm-service.test.ts`).
2. **Clock Sync Estimator Implementation**:
   - `src/lib/sync/clock-sync.ts` (lines 16-106): `ClockSyncEstimator` implements Cristian's NTP algorithm with sliding window (size 8), RTT outlier rejection (`maxRttThresholdMs = 500`), min-RTT probe selection, and EMA smoothing (`alpha = 0.2`).
   - `src/lib/sync/use-sync-engine.ts` (lines 201-221): `sock.on("clock:res", ...)` bypasses `ClockSyncEstimator` and calculates clock offset using a basic inline sort without EMA smoothing and without `> 500ms` outlier rejection.
3. **PI Slewing Controller & Video Controller Discrepancy**:
   - `src/lib/sync/pi-controller.ts` (lines 16-82): `PISlewingController` implements deadband (`<= 0.1s`), PI continuous slewing (`0.1s < |e| <= 1.0s`, `kp = 0.05`, `ki = 0.005`, rate limits `0.95x - 1.05x`) with anti-windup freezing, and hard seek (`> 1.0s`).
   - `src/lib/sync/use-video-controller.ts` (lines 174-217, 231-264, 266-340): `useVideoController` does **not** use `PISlewingController`. Instead, it runs three competing rate adjustment routines (monotonic sequence step-nudge `desiredRate * 1.05/0.95`, `tsMap` median drift corrector setting rate `0.96/1.04`, and `requestVideoFrameCallback` frame sampler scaling rate linearly `1 - (abs/750)*0.04`).
4. **Heartbeat RTT Skew**:
   - `mini-services/sync-service/index.ts` (line 484): `me.rtt = Math.abs(payload.clientNow - Date.now());`.
   - `payload.clientNow` is local client clock timestamp, while `Date.now()` is server timestamp.
5. **Group Buffer Disconnect Stalling**:
   - `mini-services/sync-service/index.ts` (lines 455-472 & 759-784): `buffer:event` pauses playback on `type === "waiting"`. The `disconnect` handler cleans up `r.participants`, but does not re-evaluate `allReady` when a buffering user disconnects.
6. **WebRTC Mesh Signaling Broadcast**:
   - `mini-services/sync-service/index.ts` (lines 687-698): `socket.on("rtc:signal", (payload: { to: string; msg: any }) => socket.to(currentRoomId).emit("rtc:signal", { from: me.userId, msg: payload.msg }));`.
   - `src/lib/webrtc/use-webrtc-stream.ts` (lines 168-200): Signals are received without checking `to === userId`, causing all peers in 3+ participant rooms to process and answer offers meant for a single target.
7. **Local File Sync State Propagation**:
   - `mini-services/sync-service/index.ts` (lines 312-315, 328-338): `blob:` URLs are stripped and normalized to `file://local` with type `file` and `fileName`.
   - `src/components/watchparty/universal-player.tsx` (lines 268-294): Prompts peers with "Local Movie Sync" to select their local file copy of `playback.fileName`, keeping time in sync without media uploads.

---

## 2. Logic Chain

1. **From Observation 2**: Because `use-sync-engine.ts` implements an ad-hoc sort instead of delegating to `ClockSyncEstimator`, client clock offset jumps erratically under jittery network conditions because it lacks EMA dampening and outlier rejection.
2. **From Observation 3**: Because `use-video-controller.ts` maintains three separate concurrent control loops (`seq` event step-nudge, `tsMap` interval, and `requestVideoFrameCallback`), each writing directly to `videoEl.playbackRate` with differing rate boundaries (`0.96-1.04` vs `0.95-1.05`), the playhead rate can oscillate or override proper convergence.
3. **From Observation 4**: Because `me.rtt = Math.abs(payload.clientNow - Date.now())` mixes two unsynchronized clocks, any system clock difference (e.g. +5 seconds) is recorded as a 5000ms RTT. In `buffer:event` line 463, `p.lastChangedAt = Date.now() + Math.max(highestRtt * 2, 500)` will calculate a 10-second resumption delay, freezing the room.
4. **From Observation 5**: Because `disconnect` does not check if the remaining participants are ready, a buffering peer closing their browser locks the entire room in a paused state until someone manually clicks play.
5. **From Observation 6**: Because `rtc:signal` is broadcast to the entire room and omits the destination target, every client in a multi-peer session responds to incoming SDP offers, generating colliding peer connections.

---

## 3. Caveats

1. **Running Sync Service in Integration Mode**: Unit tests in `bun test` mock network timers and math calculations; live Socket.IO client-server integration under network latency was verified via static code tracing rather than live browser multi-tab automation.
2. **WebTorrent Dynamic Loading**: WebTorrent is imported dynamically via `esm.sh` in browser runtime; Node.js/Bun CLI environments do not execute WebTorrent directly during `bun test`.
3. **CineVo Extension Context**: The MV3 extension operates inside Chrome's isolated world context. Verification of `content-cinevo.js` assumes standard Chrome Extension Storage API (`chrome.storage.session`).

---

## 4. Conclusion

The core synchronization algorithms (`ClockSyncEstimator` in `src/lib/sync/clock-sync.ts` and `PISlewingController` in `src/lib/sync/pi-controller.ts`) are well-designed, mathematically sound, and rigorously covered by 74 passing tests.

However, the state synchronization engine requires five key fixes to ensure rock-solid production stability:
1. **Wire `ClockSyncEstimator` into `use-sync-engine.ts`** to replace the inline sorting logic and activate EMA smoothing and outlier filtering.
2. **Unify playhead rate control in `use-video-controller.ts`** by driving rate changes through `PISlewingController` and eliminating overlapping rate adjustments.
3. **Fix the heartbeat RTT calculation in `sync-service/index.ts`** to avoid clock skew contaminating group buffer resumption.
4. **Target `rtc:signal` routing in `sync-service/index.ts` and `use-webrtc-stream.ts`** to prevent multi-peer WebRTC signaling broadcast collisions.
5. **Add buffering recovery on disconnect in `sync-service/index.ts`** so rooms unpause if a buffering participant leaves.

---

## 5. Verification Method

### How to Verify Observations and Fixes

1. **Run Unit and Stress Tests**:
   ```bash
   bun test
   ```
   Inspect test files:
   - `src/__tests__/sync-engine.test.ts`
   - `src/lib/sync/__tests__/sync.test.ts`
   - `src/lib/sync/__tests__/empirical-verification.test.ts`

2. **Verify Clock Sync & Estimator Integrity**:
   Inspect `src/lib/sync/clock-sync.ts` (lines 41-81) and compare with `src/lib/sync/use-sync-engine.ts` (lines 201-221).

3. **Verify Rate Controller & Video Controller**:
   Inspect `src/lib/sync/pi-controller.ts` (lines 32-73) and compare with `src/lib/sync/use-video-controller.ts` (lines 174-217, 231-264, 266-340).

4. **Verify WebRTC Mesh Signaling**:
   Inspect `mini-services/sync-service/index.ts` (lines 687-698) and `src/lib/webrtc/use-webrtc-stream.ts` (lines 168-200).

5. **Verify Buffer Group-Wait & Heartbeat**:
   Inspect `mini-services/sync-service/index.ts` (lines 433-474, 477-486, 759-784).

### Invalidation Conditions
- If `bun test` fails on any clock sync or PI slewing test, the corresponding controller logic is invalidated.
- If `ClockSyncEstimator` is modified such that `maxRttThresholdMs` rejects valid low-latency probes (<500ms), synchronization convergence will degrade.
