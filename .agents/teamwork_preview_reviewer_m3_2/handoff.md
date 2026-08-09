# Milestone 3 Review & Handoff Report

**Reviewer Subagent ID**: `teamwork_preview_reviewer_m3_2`  
**Milestone**: Milestone 3 — VM Service Backend & Security Invariants  
**Verdict**: **REQUEST_CHANGES**  

---

## 1. Observation

### 1.1 Automated Test Execution Results (`bun test`)
Running `bun test` in `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty` results in **1 test failure out of 62 tests**:

```text
bun test v1.3.14 (0d9b296a)

src\__tests__\sync-engine.test.ts: 18 passed
src\lib\sync\__tests__\empirical-verification.test.ts: 4 passed
src\lib\sync\__tests__\sync.test.ts: 12 passed

src\__tests__\vm-service.test.ts:
378 |     expect(edgeMax.y).toBe(1079);
379 | 
380 |     // NaN input values
381 |     const nanCoords = normalizeCoordinates(NaN, NaN, 1920, 1080);
382 |     // Empirical test to check if NaN is strictly clamped to [0, 1]^2 bounds (0) or if it returns NaN
383 |     expect(Number.isNaN(nanCoords.x)).toBe(false);
                                            ^
error: expect(received).toBe(expected)

Expected: false
Received: true

      at <anonymous> (C:\Users\Default.L-HCG-9FVVGS3\OneDrive\Desktop\WatchParty\src\__tests__\vm-service.test.ts:383:39)
(fail) Milestone 3 EMPIRICAL STRESS TESTS: FloorControlManager Mutex & Coordinate Clamping > STRESS: Coordinate Normalization math with extreme out-of-bounds, Infinity, and NaN inputs [0.89ms]

1 tests failed:
(fail) Milestone 3 EMPIRICAL STRESS TESTS: FloorControlManager Mutex & Coordinate Clamping > STRESS: Coordinate Normalization math with extreme out-of-bounds, Infinity, and NaN inputs [0.89ms]

 61 pass
 1 fail
 1644 expect() calls
Ran 62 tests across 4 files. [261.00ms]
```

### 1.2 Discrepancy in Worker `changes.md` Test Report
In `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_worker_m3_1/changes.md` lines 24-35:
```text
bun test v1.3.14 (0d9b296a)

src\__tests__\sync-engine.test.ts: 18 passed
src\__tests__\vm-service.test.ts: 23 passed
src\lib\sync\__tests__\empirical-verification.test.ts: 4 passed
src\lib\sync\__tests__\sync.test.ts: 12 passed

 57 pass
 0 fail
```
Worker reported 57 passing tests across `vm-service.test.ts` (23 passed), but the test file actually contains 28 tests, and test #28 fails. The reported test output in `changes.md` did not reflect the test failure.

### 1.3 Analysis of `normalizeCoordinates` in `vm-service/index.ts`
In `vm-service/index.ts` lines 145-156:
```ts
export function normalizeCoordinates(
  xNorm: number,
  yNorm: number,
  width: number = WIDTH,
  height: number = HEIGHT
): { x: number; y: number } {
  const clampedX = Math.max(0, Math.min(1, xNorm));
  const clampedY = Math.max(0, Math.min(1, yNorm));
  const x = Math.min(width - 1, Math.max(0, Math.floor(clampedX * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(clampedY * height)));
  return { x, y };
}
```
When `xNorm` or `yNorm` is `NaN`:
`Math.min(1, NaN)` evaluates to `NaN`, so `clampedX` is `NaN`.
`Math.floor(NaN * width)` evaluates to `NaN`.
Therefore, `normalizeCoordinates` returns `{ x: NaN, y: NaN }`.

### 1.4 Security Audit of `vm-service/dedicated-chrome.ts`
In `vm-service/dedicated-chrome.ts` lines 190-230:
The WebSocket message handler processes incoming input frames (`type === 2` for mouse move, `type === 3` for mouse click, `type === 5` for keypress, `type === 6` for type text, `type === 7` for navigate) without importing or checking `FloorControlManager` or `isController(ws)`. Any connected WebSocket client to `dedicated-chrome.ts` can execute mouse and keyboard events regardless of who holds the floor control.

### 1.5 Verification of Single-Writer Invariant in `vm-service/index.ts`
In `vm-service/index.ts`:
- Lines 46-143: `FloorControlManager` state machine correctly handles `IDLE` <-> `OCCUPIED` transitions, FIFO `controlQueue`, duplicate request protection, queue head promotion on release, active controller and queued user revocation, and socket disconnect cleanup.
- Lines 451-456: Input event processing checks `if (!floorManager.isController(ws)) { return; }` for input message types `[2, 3, 4, 5, 6, 7, 8, 9, 10, 11]`. Unauthenticated and non-floor-holding clients are correctly rejected.

### 1.6 Dynamic Configuration & Cloud Flags
- `CHROME_PATH` dynamically falls back to `process.env.CHROME_PATH || DEFAULT_CHROME_PATH` (win32 default: `C:\Program Files\Google\Chrome\Application\chrome.exe`, Linux default: `/usr/bin/chromium`).
- `IS_HEADLESS` dynamically checks `process.env.HEADLESS !== "false"`.
- Container stealth and low-RAM flags (`--disable-dev-shm-usage`, `--js-flags="--max-old-space-size=512"`, `--renderer-process-limit=2`, `--no-sandbox`) are properly configured in browser launch parameters.

### 1.7 ESLint (`bun run lint`) & Production Build (`bun run build`)
- `bun run lint`: 0 errors, 6 warnings (Pass).
- `bun run build`: Next.js Turbopack build compiled successfully (Pass).

---

## 2. Logic Chain

1. **Test Failure**: `bun test` was executed on the workspace and reported 1 failing test (`STRESS: Coordinate Normalization math with extreme out-of-bounds, Infinity, and NaN inputs` at line 383 of `src/__tests__/vm-service.test.ts`).
2. **Root Cause**: `normalizeCoordinates(xNorm, yNorm)` does not check or sanitize `NaN` values before mathematical operations (`Math.min` and `Math.max`). In JavaScript standard semantics, `Math.min(1, NaN)` returns `NaN`, causing `NaN` to propagate into the resulting coordinates `{ x: NaN, y: NaN }`.
3. **Discrepancy in Worker Documentation**: The worker claimed in `changes.md` that 57 tests passed with 0 failures, missing the test failure present in `vm-service.test.ts`.
4. **Security Vulnerability in Alternative Server Entry Point**: While `vm-service/index.ts` correctly enforces the single-writer security invariant using `FloorControlManager`, `vm-service/dedicated-chrome.ts` lacks any floor control check. If `dedicated-chrome.ts` is executed, any connected client can send remote control events without authorization.
5. **Verdict Rationale**: Per protocol guidelines, a failing test suite (`bun test` exit code 1), unhandled `NaN` coordinate propagation, and un-guarded input handlers in `dedicated-chrome.ts` mandate a verdict of **REQUEST_CHANGES**.

---

## 3. Caveats

- `vm-service/index.ts` is the primary entry point for the VM service (`package.json` script `dev` invokes `index.ts`). However, `dedicated-chrome.ts` exists in the `vm-service` directory as a dedicated Chrome runner and should be maintained with consistent security checks.
- Next.js build (`bun run build`) and ESLint (`bun run lint`) passed with 0 errors.

---

## 4. Conclusion

**Verdict**: **REQUEST_CHANGES**

### Required Action Items for Worker Subagent (`teamwork_preview_worker_m3_1`):
1. **Fix `normalizeCoordinates` NaN Handling**:
   Update `normalizeCoordinates` in `vm-service/index.ts` to convert `NaN` inputs to `0` (e.g. `const safeXNorm = Number.isNaN(xNorm) ? 0 : xNorm;`).
2. **Ensure `bun test` Passes 100%**:
   Re-run `bun test` and verify that all 62 tests pass cleanly with 0 failures.
3. **Enforce Single-Writer Invariant in `vm-service/dedicated-chrome.ts`**:
   Import `FloorControlManager` into `vm-service/dedicated-chrome.ts` and apply `floorManager.isController(ws)` checks to input message types to prevent unauthorized remote input execution.
4. **Update `changes.md`**:
   Reflect the accurate output of `bun test` (all 62 tests passing).

---

## 5. Verification Method

To independently verify the fixes:

1. **Run Unit Test Suite**:
   ```bash
   bun test
   ```
   *Expected result*: 62 pass, 0 fail.

2. **Run ESLint Check**:
   ```bash
   bun run lint
   ```
   *Expected result*: 0 errors.

3. **Run Production Build**:
   ```bash
   bun run build
   ```
   *Expected result*: Compiled successfully with exit code 0.

4. **Code Inspection**:
   - Inspect `normalizeCoordinates` in `vm-service/index.ts` for `NaN` sanitization.
   - Inspect `vm-service/dedicated-chrome.ts` for `FloorControlManager` integration and single-writer input guard.
