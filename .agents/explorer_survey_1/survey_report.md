# State Synchronization Engine — Comprehensive Survey Report

**Agent**: Explorer Survey Agent 1  
**Scope**: State Synchronization Engine (`mini-services/sync-service/index.ts`, `src/lib/sync/`, WebRTC signaling, CineVo extension interop, local file sync)  
**Date**: 2026-08-17  
**Status**: Investigation Complete

---

## 1. Executive Summary

WatchParty employs a hybrid server-authoritative and peer-coordinated synchronization architecture:
- **Server Component**: An event-driven Socket.IO microservice (`mini-services/sync-service/index.ts`, Port 3003) maintaining monotonic sequence-numbered playback states, Cristian's clock synchronization responder, group buffer-wait logic, command-relays, and WebRTC/VM floor signaling.
- **Client Synchronization Core**:
  - `src/lib/sync/clock-sync.ts`: `ClockSyncEstimator` implementing Cristian's NTP protocol with sliding-window minimum RTT selection, RTT outlier rejection (`> 500ms`), and Exponential Moving Average (EMA) smoothing (`alpha = 0.2`).
  - `src/lib/sync/pi-controller.ts`: `PISlewingController` providing 3-tier playhead synchronization: deadband (`|e| <= 100ms`), continuous PI rate slewing (`0.95x - 1.05x`) with anti-windup integral freezing, and hard seek (`|e| > 1.0s`), along with `computeExpectedPlayhead()`.
  - `src/lib/sync/use-sync-engine.ts`: Full-featured React hook managing real-time room communication, playback intents, remote command relays, chat, reactions, queue, and local file playback state.
  - `src/lib/sync/use-video-controller.ts`: Player controller managing native video DOM events, remote commands (`REC:play/pause/seek`), `tsMap` peer heartbeat, and frame-accurate drift correction via `requestVideoFrameCallback`.
  - `src/lib/webrtc/use-webrtc-stream.ts`: WebRTC P2P stream broadcaster (`captureStream`) and viewer manager.
  - `extension/`: Manifest V3 Chrome Extension (`content-bridge.js`, `content-cinevo.js`) implementing isolated-world synchronization for third-party websites (e.g. CineVo).

The test suite runs with **74 passing tests** across 5 test suites (`bun test`). However, deep static code analysis identified 6 architectural discrepancies, precision flaws, and potential edge-case failures.

---

## 2. Codebase & Component Inventory

| Component | File Path | Lines | Responsibilities |
|---|---|---|---|
| **Sync Service** | `mini-services/sync-service/index.ts` | 813 | Socket.IO server (port 3003). Rooms, sequence numbers, clock sync responder, CMD relays, buffer wait, WebRTC/VM signaling, presence, queue. |
| **Sync Types** | `src/lib/sync/types.ts` | 71 | Shared types (`PlaybackState`, `Participant`, `QueueItem`, `ChatMessage`, `Reaction`) and video type detection helper. |
| **Clock Sync Estimator** | `src/lib/sync/clock-sync.ts` | 107 | `ClockSyncEstimator` class (Cristian's algorithm, sliding window 8, max RTT 500ms, EMA alpha 0.2). |
| **PI Rate Controller** | `src/lib/sync/pi-controller.ts` | 100 | `PISlewingController` class (deadband 100ms, rate limits [0.95, 1.05], anti-windup, hard seek 1.0s, `computeExpectedPlayhead`). |
| **Sync Engine Hook** | `src/lib/sync/use-sync-engine.ts` | 478 | Client React hook connecting to Socket.IO, room state lifecycle, clock sync polling, event dispatchers. |
| **Video Controller Hook** | `src/lib/sync/use-video-controller.ts` | 342 | DOM `<video>` integration, remote command handler, `tsMap` broadcast, rVFC drift correction, pitch preservation. |
| **WebRTC Stream Hook** | `src/lib/webrtc/use-webrtc-stream.ts` | 248 | P2P video stream broadcaster and viewer management via `RTCPeerConnection`. |
| **Universal Player UI** | `src/components/watchparty/universal-player.tsx` | 445 | Universal player supporting YouTube, HLS, native MP4/WebM, and Local File Movie Sync. |
| **Stream Player UI** | `src/components/watchparty/stream-player.tsx` | 399 | UI for WebRTC live video streaming host & viewers. |
| **Torrent Player UI** | `src/components/watchparty/torrent-player.tsx` | 443 | WebTorrent dynamic P2P client streaming. |
| **CineVo Extension Bridge** | `extension/content-bridge.js` | 47 | Injected into WatchParty app; passes room context to `chrome.storage.session`. |
| **CineVo Content Agent** | `extension/content-cinevo.js` | 622 | Content script on CineVo; connects to sync service, manages `<video>` sync, ad detection, and floating overlay. |
| **Legacy Extension** | `browser-extension/content.js` | 211 | Legacy browser extension prototype with hardcoded URLs. |

---

## 3. Deep Architectural Analysis

### 3.1 Clock Synchronization Engine
- **Mathematical Specification**:
  - Raw Round Trip Time: $\text{RTT} = (t_3 - t_0) - \max(0, t_2 - t_1)$
  - Raw Clock Offset: $\theta_{\text{raw}} = \frac{(t_1 - t_0) + (t_2 - t_3)}{2}$
  - Outlier rejection: $\text{RTT} > 500\,\text{ms} \implies \text{reject}$
  - Sliding Window: $W = \{S_1, \dots, S_k\} \, (k \le 8)$, select $S_{\text{best}} = \arg\min_{S \in W} S.\text{RTT}$
  - EMA Smoothing: $\theta_k = \alpha \cdot \theta_{\text{best}} + (1 - \alpha) \cdot \theta_{k-1}$ with $\alpha = 0.2$
- **Verification Status**:
  - `src/lib/sync/clock-sync.ts` adheres to this model and passes unit tests in `src/lib/sync/__tests__/sync.test.ts` and `src/__tests__/sync-engine.test.ts`.

### 3.2 PI Slewing Playhead Rate Controller
- **Mathematical Specification**:
  - Error: $e(t) = \text{ExpectedPlayhead}(t) - \text{ActualPlayhead}(t)$
  - Tier 1 (Deadband): $|e(t)| \le 0.10\,\text{s} \implies \text{Rate} = 1.0\times, \, I(t) = 0$
  - Tier 2 (PI Slewing): $0.10\,\text{s} < |e(t)| \le 1.00\,\text{s}$
    - $I_{\text{cand}}(t) = I(t - \Delta t) + e(t) \cdot \Delta t$
    - $R_{\text{raw}} = 1.0 + K_p \cdot e(t) + K_i \cdot I_{\text{cand}}(t) \quad (K_p = 0.05, K_i = 0.005)$
    - $R_{\text{clamped}} = \text{clamp}(R_{\text{raw}}, 0.95, 1.05)$
    - Anti-Windup Guard: $I(t) = I_{\text{cand}}(t)$ if $R_{\text{raw}} = R_{\text{clamped}}$, else $I(t) = I(t - \Delta t)$
  - Tier 3 (Hard Seek): $|e(t)| > 1.00\,\text{s} \implies \text{Seek to ExpectedPlayhead}, \, I(t) = 0$
- **Expected Playhead Formula**:
  $$\text{Expected}(t) = \text{BaseTime} + \max\left(0, \frac{(t_{\text{client}} + \theta) - t_{\text{lastChanged}}}{1000}\right) \times \text{PlaybackRate}$$

### 3.3 Command-Relay & Group Buffering Architecture
- **Command Relays**:
  - `CMD:play`, `CMD:pause`, `CMD:seek`, `CMD:ts`.
  - Relayed as `REC:play`, `REC:pause`, `REC:seek`, `REC:tsMap`.
  - Server maintains `tsMap` (user playheads) and broadcasts every 1s, pruning inactive participants.
- **Buffer-Aware Group Wait**:
  - Client emits `buffer:event` with `{ type: "waiting" | "playing", position }`.
  - On `waiting`: room paused, `isBuffering = true` for sender, system chat broadcasted.
  - On `playing`: checks if all members ready (`every(!p.isBuffering)`). Resumes playback with latency padding:
    $$t_{\text{resume}} = \text{Date.now()} + \max(\max_{p}(p.\text{rtt}) \times 2, 500)$$

### 3.4 WebRTC Mesh Signaling Relay
- Host captures video stream via `captureStream(30)`.
- Signaling relayed via `rtc:signal` (SDP offer/answer, ICE candidates) and `stream:announce`.

### 3.5 CineVo Extension Interop & Local File Mode
- **CineVo Interop**: App sends `WP_START_SYNC` to `content-bridge.js`, stored in `chrome.storage.session`. `content-cinevo.js` connects to sync service, monitors video via MutationObserver, suppresses sync during ad breaks (`agent:ad`), and uses page-context scriptlet injection fallback.
- **Local File Sync**: Host loads file -> emits `state:intent` with `videoUrl: "file://local"`, `videoType: "file"`, `fileName: name`. Blobs are stripped. Viewers are prompted to select their local copy of `fileName`. Once loaded, time synchronization proceeds natively without video upload.

---

## 4. Identified Bugs, Precision Issues & Edge Cases

### ⚠️ Flaw 1: Disconnection between `use-sync-engine.ts` and `ClockSyncEstimator`
- **Location**: `src/lib/sync/use-sync-engine.ts` (lines 201-221)
- **Problem**: `useSyncEngine` does not use the `ClockSyncEstimator` class from `src/lib/sync/clock-sync.ts`. Instead, it maintains a raw array `clockSamplesRef.current` and sorts by `(t1 - t0)`. It lacks EMA smoothing ($\alpha = 0.2$) and lacks outlier rejection ($> 500\text{ms}$).
- **Fix**: Replace inline clock sample sorting in `useSyncEngine` with an instance of `ClockSyncEstimator`.

### ⚠️ Flaw 2: Heartbeat Server RTT Calculation Bug
- **Location**: `mini-services/sync-service/index.ts` (line 484)
- **Problem**: `me.rtt = Math.abs(payload.clientNow - Date.now());`.
- **Root Cause**: `clientNow` is based on the client's local system clock, whereas `Date.now()` is the server's system clock. Clock skew between client and server is erroneously recorded as network RTT.
- **Impact**: If a user's device clock is offset by 10 seconds, `me.rtt` is recorded as 10,000ms. When group buffering resumes in `buffer:event`, the resumption delay `Math.max(highestRtt * 2, 500)` will freeze playback for 20+ seconds!
- **Fix**: Calculate RTT from round-trip timestamps or use the clock sync estimator's verified RTT value.

### ⚠️ Flaw 3: Architecture Divergence & Competing Control Loops in `use-video-controller.ts`
- **Location**: `src/lib/sync/use-video-controller.ts` (lines 174-217, 231-264, 266-340)
- **Problem**:
  1. `useVideoController` does not instantiate or use `PISlewingController`.
  2. Three separate loops concurrently write to `videoEl.playbackRate`:
     - Monotonic `seq` update handler (lines 197-201: sets rate to `desired * 1.05` / `0.95`).
     - `tsMap` median fallback (lines 231-264: sets rate to `0.96` / `1.04` every 1000ms).
     - `requestVideoFrameCallback` frame sampler (lines 266-340: scales rate linearly using `1 - (abs/750)*0.04`).
  3. Rate bounds in `use-video-controller.ts` are `0.96x - 1.04x` instead of `0.95x - 1.05x`, and hard seek is `1500ms` instead of `1000ms`.
- **Fix**: Refactor `useVideoController` to unify playhead correction through `PISlewingController`.

### ⚠️ Flaw 4: WebRTC Signaling Mesh Collision (Broadcast instead of Point-to-Point)
- **Location**: `mini-services/sync-service/index.ts` (lines 687-698) & `src/lib/webrtc/use-webrtc-stream.ts` (lines 168-200)
- **Problem**: In `index.ts`:
  ```ts
  socket.on("rtc:signal", (payload: { to: string; msg: any }) => {
    socket.to(currentRoomId).emit("rtc:signal", { from: me.userId, msg: payload.msg });
  });
  ```
  The server broadcasts the signal to **all** room participants, stripping `to`. In `use-webrtc-stream.ts`, every viewer receiving an offer creates a peer connection and responds.
- **Impact**: Multi-viewer WebRTC streams fail due to signaling collisions.
- **Fix**: Direct `rtc:signal` to the specific recipient socket (`payload.to`), or include `to` in the broadcast and filter in `useWebRTCStream` (`if (data.to && data.to !== userId) return;`).

### ⚠️ Flaw 5: Group Buffer Deadlock on Participant Disconnect
- **Location**: `mini-services/sync-service/index.ts` (lines 759-784)
- **Problem**: If participant A is buffering (`isBuffering = true`) and disconnects before emitting `buffer:event` (`playing`), the room remains paused indefinitely because `disconnect` deletes participant A but does not re-evaluate `allReady = Array.from(r.participants.values()).every(p => !p.isBuffering)`.
- **Fix**: In the `disconnect` handler, check if all remaining participants have `isBuffering === false`, and resume playback if appropriate.

### ⚠️ Flaw 6: Duplicate/Stale Browser Extension Codebase
- **Location**: `browser-extension/content.js` vs `extension/content-cinevo.js`
- **Problem**: `browser-extension/` contains hardcoded legacy URLs (`https://sync.kushalneedsmcp.online`), whereas `extension/` is the active MV3 implementation.
- **Fix**: Standardize on `extension/` and deprecate or align `browser-extension/`.

---

## 5. Existing Tests & Recommended Test Additions

### Existing Test Suites (All 74 Tests Passing)
1. `src/__tests__/sync-engine.test.ts` (ClockSyncEstimator, PISlewingController, expected playhead, anti-windup, stress tests)
2. `src/lib/sync/__tests__/sync.test.ts` (Cristian's algorithm, EMA smoothing, PI controller deadband & seek actions)
3. `src/lib/sync/__tests__/empirical-verification.test.ts` (Late-joiner calculations, direct seek threshold, rate limits [0.95, 1.05])
4. `src/__tests__/m4-empirical-verification.test.ts` (16:9 widescreen ratio, chat formats, participant badges, media opt-in)
5. `src/__tests__/vm-service.test.ts` (Floor control state machine, coordinate normalization, URL sanitization)

### Recommended New Tests
1. **Sync Service Integration Tests**:
   - `CMD:play`, `CMD:pause`, `CMD:seek` sequence and broadcast propagation.
   - `tsMap` calculation and pruning on disconnect.
   - `buffer:event` group wait and recovery when a buffering user disconnects.
2. **WebRTC Targeted Signaling Tests**:
   - Point-to-point offer/answer routing test for 3+ participants to prevent broadcast collisions.
3. **End-to-End Clock & Video Controller Tests**:
   - Integration test feeding mock `requestVideoFrameCallback` timestamps into `PISlewingController` to verify smooth slewing convergence without oscillation.
