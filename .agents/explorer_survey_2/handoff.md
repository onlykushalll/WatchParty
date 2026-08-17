# 5-Component Handoff Report: Co-Browsing Virtual PC Subsystem Survey

**Author**: Explorer Survey Agent 2  
**Target Milestone**: Survey Investigation Complete  
**Date**: 2026-08-17  
**Artifact Report**: `c:\Users\Default.L-HCG-9FVVGS3\OneDrive\Desktop\WatchParty\.agents\explorer_survey_2\survey_report.md`  

---

## 1. Observation

### Codebase Forensics & File Locations
1. **`vm-service/index.ts`** (Lines 48–155):
   - Implements `FloorControlManager` with state machine transitions (`IDLE` $\leftrightarrow$ `OCCUPIED`), FIFO queueing (`controlQueue: QueuedUser[]`), voluntary release, host revocation (`revokeControl`), and disconnect promotion (`handleDisconnect`).
   - Enforces single-writer security invariant on lines 470–476:
     ```typescript
     if ([2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(type)) {
       if (!floorManager.isController(ws)) {
         return; // Drops unauthorized input frames
       }
     }
     ```
   - Normalizes input coordinates on lines 162–173 via `normalizeCoordinates(xNorm, yNorm, width, height)` using `sanitizeUnit` clamping ($[0, 1] \rightarrow \text{pixels}$).
   - Sanitizes address bar URLs on lines 175–203 via `sanitizeUrl(inputUrl)`, strictly blocking schemes `file:`, `chrome:`, `chrome-extension:`, `javascript:`, `data:`, and `about:`.
   - Listens to CDP `framenavigated` on lines 280–284 and broadcasts Opcode `12` (`broadcastUrl(page.url())`).

2. **`src/components/watchparty/virtual-browser.tsx`**:
   - Lines 57–63: Defines `isController = controllerId === userId` based solely on the `controllerId` prop passed from `page.tsx` (`engine.vmController`).
   - Lines 147–151: Auto-requests control by calling `onRequestControl()` (which triggers `engine.requestVmControl()` emitting `vm:control:request` over Socket.IO to `sync-service`).
   - Lines 155–163: `sendMsg(type, payload)` sends binary WebSocket frames to `vmUrl + "/ws"`.
   - Lines 177–197: When `isController` is true, sends Opcode `2` (mouse move), Opcode `3` (mouse click), Opcode `4` (wheel), Opcode `5`/`6` (keyboard), and Opcode `7` (navigate) to `vm-service`.
   - **Crucial Gap**: `virtual-browser.tsx` NEVER sends Opcode `16` (`request-control`) or Opcode `17` (`release-control`) to `vm-service` over WebSocket.
   - Lines 81–110: `ws.onmessage` ONLY checks `if (data[0] === 1)` (JPEG frames) and ignores Opcode `12` (CDP URL push).
   - Lines 127–134: Uses an HTTP `setInterval` polling `fetch(`${vmUrl}/url`)` every 3000ms.
   - Lines 166–174: `getNormalizedCoords` computes `(clientX - rect.left) / rect.width` without `Math.min(1, Math.max(0, ...))` clamping.

3. **`mini-services/sync-service/index.ts`**:
   - Lines 719–756: Handles Socket.IO events `vm:control:request` and `vm:control:release`, maintaining `r.vmController` and `r.vmControlQueue`.
   - Lines 759–785 (`socket.on("disconnect")`): Cleans up `tsMap`, `streamHost`, and host transfer, but DOES NOT clean up `r.vmController` or `r.vmControlQueue` when a controller or queued participant disconnects.

4. **`vm-service/dedicated-chrome.ts` & `vm-service/cdp-browser.ts`**:
   - `dedicated-chrome.ts:187, 321`: Invokes `page.goto(url)` without invoking `sanitizeUrl()`.
   - `cdp-browser.ts:197-282`: Lacks `FloorControlManager` entirely, processes inputs from any client, and executes unauthenticated code via `page.evaluate(payload.script)` on Opcode `11`.

5. **Test Suite Verification**:
   - Executed `bun test src/__tests__/vm-service.test.ts`:
     ```
     29 pass, 0 fail, 567 expect() calls [243.00ms]
     ```
   - Executed `bun test`:
     ```
     74 pass, 0 fail, 1680 expect() calls [206.00ms]
     ```

---

## 2. Logic Chain

1. **Premise 1 (Server Security Guard)**: `vm-service/index.ts` enforces `floorManager.isController(ws)` on all remote input opcodes (`2` through `11`). Any socket where `floorManager.isController(ws)` evaluates to `false` has its input frames discarded.
2. **Premise 2 (State Machine Activation)**: `floorManager.isController(ws)` returns `true` if and only if `floorManager.requestControl(userId, userName, ws)` was called with that specific socket instance (Opcode `16`).
3. **Premise 3 (Client Disconnect)**: `virtual-browser.tsx` handles floor control UI state exclusively via Socket.IO events to `sync-service`. It never sends Opcode `16` over its WebSocket connection to `vm-service`.
4. **Deduction 1 (Input Drop Defect)**: Because `virtual-browser.tsx` never sends Opcode `16` to `vm-service`, `floorManager.activeControllerSocket` remains `null`. Consequently, `floorManager.isController(ws)` returns `false` for every client connection, causing `vm-service` to drop 100% of user inputs from the React UI.
5. **Deduction 2 (Address Bar Lag)**: Because `virtual-browser.tsx` does not listen for Opcode `12` frames emitted by `vm-service` upon CDP `framenavigated` events, URL bar updates are delayed by up to 3000ms due to reliance on HTTP `/url` polling.
6. **Deduction 3 (Orphaned Controller State)**: Because `sync-service/index.ts` lacks disconnect cleanup for `r.vmController`, if an active controller closes their browser tab, the room retains their `userId` as `vmController`, preventing other users from taking control.

---

## 3. Caveats

- In headless containerized production environments (Linux Docker), Puppeteer requires system dependencies (Chromium, font packages, and `--no-sandbox` flags) specified in `vm-service/Dockerfile`.
- Fullscreen canvas rendering in `virtual-browser.tsx` stretches 1920x1080 frames to fit the element dimensions. Because normalized coordinates $(x, y) \in [0, 1]^2$ are used for both rendering and input capture, visual alignment remains pixel-perfect across varying aspect ratios.
- Local tests in `src/__tests__/vm-service.test.ts` verify the unit math and state machine in isolation; live end-to-end browser execution requires running the Chromium process.

---

## 4. Conclusion

The Co-Browsing Virtual PC subsystem contains mathematically sound core algorithms (coordinate normalization, URL scheme validation, and `FloorControlManager` state transitions) validated by 29 unit tests. However, there is a **critical protocol disconnect between the frontend component (`virtual-browser.tsx`) and the backend service (`vm-service/index.ts`)**: `virtual-browser.tsx` fails to transmit Opcode `16` (`request-control`) over WebSocket, triggering the server's single-writer security guard to drop all client input. Additionally, secondary files (`dedicated-chrome.ts`, `cdp-browser.ts`) harbor URL sanitization and unauthorized execution bypasses, and `sync-service` leaks orphaned controllers on disconnect.

### Recommended Action Items for Implementation:
1. In `virtual-browser.tsx`: When `isController` becomes true or upon connection, send Opcode `16` (`{ userId, userName }`) over WebSocket so `vm-service` registers `activeControllerSocket`. Send Opcode `17` on release.
2. In `virtual-browser.tsx`: Add Opcode `12` handling to `ws.onmessage` for instant address bar updates and remove 3000ms HTTP polling.
3. In `virtual-browser.tsx`: Add `Math.min(1, Math.max(0, ...))` clamping to `getNormalizedCoords`.
4. In `sync-service/index.ts`: In `socket.on("disconnect")`, add promotion logic: `if (r.vmController === me.userId) { r.vmController = r.vmControlQueue.shift() || null; io.to(currentRoomId).emit("vm:control:state", ...); }`.
5. In `dedicated-chrome.ts` & `cdp-browser.ts`: Enforce `sanitizeUrl()` and single-writer security checks.

---

## 5. Verification Method

To independently reproduce all observations and verify the state of the subsystem:

1. **Execute Unit and Stress Tests**:
   ```bash
   bun test src/__tests__/vm-service.test.ts
   ```
   *Expected Result*: 29 passing tests verifying `FloorControlManager`, coordinate normalization, and URL sanitization.

2. **Run Full Test Suite**:
   ```bash
   bun test
   ```
   *Expected Result*: 74 passing tests across all modules.

3. **Verify Production Build**:
   ```bash
   bun run build
   ```
   *Expected Result*: Next.js build succeeds with static generation and standalone bundle output.

4. **Code Inspection**:
   - View `src/components/watchparty/virtual-browser.tsx` lines 155–197 (check absence of Opcode `16` dispatch).
   - View `vm-service/index.ts` lines 470–476 (check `isController(ws)` single-writer guard).
   - View `mini-services/sync-service/index.ts` lines 759–785 (check absence of `vmController` cleanup on disconnect).
