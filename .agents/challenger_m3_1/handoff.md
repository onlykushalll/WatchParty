# Challenge Report — Milestone 3 (Interactive Virtual Desktop Co-Browsing)

## 1. Observation

### Test Execution (`bun test`)
- Executed `bun test` across the repository.
- Total existing tests: 62 tests across 4 test files. Result: **62 passed, 0 failed**.
- Executed custom empirical stress harness `.agents/challenger_m3_1/adversarial_m3_challenge.test.ts`. Result: **9 passed, 0 failed**.

### Inspection & Specific Challenge Findings

#### Requirement 1: Coordinate Bounds Clamping, NaN, and Infinity Edge Cases
- **File**: `vm-service/index.ts` lines 145-161 (`sanitizeUnit` & `normalizeCoordinates`).
- **Observation**: 
  ```ts
  export function sanitizeUnit(v: number): number {
    if (typeof v !== "number" || Number.isNaN(v)) return 0;
    return Math.min(1, Math.max(0, v));
  }
  ```
  - Inputs `NaN`, non-numbers (`null`, `undefined`, `"0.5"`), `-Infinity`, and negative out-of-bounds coordinates evaluate safely to `0.0`.
  - Inputs `Infinity` and positive out-of-bounds coordinates (e.g. `2.5`) clamp to `1.0`.
  - Scaled pixel coordinates strictly clamp to `[0, width - 1]` (e.g., `1919`) and `[0, height - 1]` (e.g., `1079`).
  - Tested in `adversarial_m3_challenge.test.ts` (Requirement R3 Challenge 1) — **VERIFIED SOLID**.

#### Requirement 2: Floor Control Security & Authorization Invariants
- **File**: `vm-service/index.ts` lines 406-461 & `FloorControlManager.releaseControl` lines 100-124.
- **Observation**:
  - **Single-Writer Input Invariant**: In `vm-service/index.ts` lines 456-461:
    ```ts
    if ([2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(type)) {
      if (!floorManager.isController(ws)) {
        return; // Rejected
      }
    }
    ```
    This strictly rejects remote mouse/keyboard input from any socket that is NOT the active controller. **VERIFIED PASS**.
  - **SECURITY DEFECT - Floor Control Release Authorization Flaw**:
    In `vm-service/index.ts` lines 419-435:
    ```ts
    else if (type === 17) {
      // release-control
      const { userId } = payload;
      const res = floorManager.releaseControl(userId);
      ...
    }
    ```
    And in `FloorControlManager.releaseControl(userId: string)` lines 100-124:
    `releaseControl` relies purely on `payload.userId` matching `this.activeControllerId` without verifying whether `ws` (the sending socket) is actually `this.activeControllerSocket`!
  - **Impact**: Any connected WebSocket client can send a binary message of type 17 with `{ "userId": "<active_controller_id>" }` and forcibly kick the active controller off the floor, stealing control or causing premature promotion.
  - Empirically reproduced in `.agents/challenger_m3_1/adversarial_m3_challenge.test.ts` (Requirement R3 Challenge 2).

#### Requirement 3: Address Bar Navigation URL Sanitization
- **File**: `vm-service/index.ts` lines 163-191 (`sanitizeUrl`).
- **Observation**:
  - Forbidden schemes (`file:`, `chrome:`, `chrome-extension:`, `javascript:`, `data:`, `about:`) are rejected with explicit errors regardless of casing or whitespace.
  - Schemes missing `http://` or `https://` are automatically prefixed with `https://`.
  - Empty or whitespace strings are rejected.
  - Tested in `adversarial_m3_challenge.test.ts` (Requirement R3 Challenge 3) — **VERIFIED SOLID**.

---

## 2. Logic Chain

1. **Test Execution**: `bun test` passed all 62 original unit and integration tests, confirming existing functionality is baseline operational.
2. **Coordinate & Bounds Clamping**: `sanitizeUnit` explicitly filters non-numeric types and `NaN` to `0`, while using `Math.min(1, Math.max(0, v))` to clamp numeric values into `[0, 1]`. `normalizeCoordinates` multiplies by resolution and floors to integer pixel values bounded by `width - 1` and `height - 1`. This handles NaN, Infinity, and out-of-bounds inputs without crashing or producing out-of-bounds pixel coordinates.
3. **URL Sanitization**: `sanitizeUrl` checks lowercased trimmed inputs against forbidden scheme prefixes (`file:`, `chrome:`, `javascript:`, `data:`, `about:`) before parsing through `new URL()`. Invalid protocols trigger exceptions before Puppeteeer navigates.
4. **Floor Control Security Analysis**:
   - `floorManager.isController(ws)` correctly checks socket identity for mouse/keyboard inputs (types 2-11).
   - However, for `release-control` (type 17), the WebSocket handler extracts `payload.userId` and calls `floorManager.releaseControl(userId)`.
   - `releaseControl(userId)` only checks `if (this.activeControllerId === userId)`; it does not verify `this.activeControllerSocket === ws` or `this.isController(ws)`.
   - Consequently, an unauthorized participant socket `ws_unauthorized` can construct a payload `{ userId: "active_user_id" }` and send message type 17. The server will execute `releaseControl("active_user_id")` and promote the next queued user (or reset to IDLE), violating floor control authorization.

---

## 3. Caveats

- Revoke control (type 18) is intended for admin/host use. If room admin authentication is added in future iterations, socket authorization for type 18 should also be bound to admin socket session state.
- WebRTC streaming transport integration with SFU/MCU is stubbed/prepared via WebSocket screenshot streaming; full RTC peer connection state machines should maintain identical message handler authorization checks.

---

## 4. Conclusion

- **Verdict**: `REQUEST_CHANGES`
- **Rationale**: While coordinate bounds clamping, NaN/Infinity safety, URL sanitization, and basic single-writer input rejection (types 2-11) are well-implemented and fully verified by test suites, there is a **High Risk Floor Control Security Flaw** where any user socket can spoof a `release-control` message (type 17) for the active controller's `userId` and strip them of control.

### Required Fix for Implementer
In `vm-service/index.ts` (type 17 handler):
Verify that the sending socket `ws` is either the active controller socket (`floorManager.isController(ws)`) or that `releaseControl` verifies socket identity before releasing the active controller floor.

---

## 5. Verification Method

To verify the challenge findings:
1. Run standard test suite:
   ```bash
   bun test
   ```
2. Run empirical challenge test suite:
   ```bash
   bun test ./.agents/challenger_m3_1/adversarial_m3_challenge.test.ts
   ```
3. Inspect `Requirement R3 Challenge 2: SECURITY FINDING: Unauthorized socket spoofing floor release for active controller` in `.agents/challenger_m3_1/adversarial_m3_challenge.test.ts`.
