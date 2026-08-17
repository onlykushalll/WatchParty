# Challenger 2 Adversarial Verification & Handoff Report

## 1. Observation

### A. Full Test Suite Execution
- Command executed: `bun test` in `c:\Users\Default.L-HCG-9FVVGS3\OneDrive\Desktop\WatchParty`
- Output verbatim:
  ```text
  120 pass
  0 fail
  2136 expect() calls
  Ran 120 tests across 7 files. [347.00ms]
  ```
- Test suites covered:
  - `src/__tests__/adversarial-verification.test.ts` (Tiers 1-3 adversarial cases)
  - `src/__tests__/vm-service.test.ts` (Floor control state machine, binary opcodes, coordinate normalization math, SSRF url sanitizer)
  - `src/__tests__/m4-empirical-verification.test.ts` (16:9 ratio, chat, participant badges, camera opt-in)
  - `src/__tests__/ui-components.test.ts` (UniversalPlayer modalities, ChatPanel, QueuePanel, CallsPanel PTT, Light Theme)
  - `src/__tests__/sync-engine.test.ts` (Sync engine integration)
  - `src/lib/sync/__tests__/empirical-verification.test.ts` (Late-joiner playhead, direct seek, rate bounds, drift & jitter)
  - `src/lib/sync/__tests__/sync.test.ts` (Clock sync estimator, PI slewing controller, expected playhead)

### B. URL Sanitization & SSRF Protection
- Inspected `vm-service/index.ts` lines 178–206 (`sanitizeUrl`) and `src/app/api/proxy/route.ts` lines 9–39 (`isBlockedHost`).
- Verified forbidden schemes are rejected deterministically:
  - `file:///etc/passwd` -> Throws `Forbidden URL scheme: file:`
  - `file://C:/Windows/win.ini` -> Throws `Forbidden URL scheme: file:`
  - `FILE:///C:/secret.txt` -> Throws `Forbidden URL scheme: file:`
  - `javascript:alert(1)` -> Throws `Forbidden URL scheme: javascript:`
  - `JAVASCRIPT:alert(document.cookie)` -> Throws `Forbidden URL scheme: javascript:`
  - `data:text/html,<h1>Pwned</h1>` -> Throws `Forbidden URL scheme: data:`
  - `chrome://settings` -> Throws `Forbidden URL scheme: chrome:`
  - `chrome-extension://abcd/popup.html` -> Throws `Forbidden URL scheme: chrome-extension:`
  - `about:config` -> Throws `Forbidden URL scheme: about:`
  - `about:blank` -> Throws `Forbidden URL scheme: about:`
  - `""` and `"   "` -> Throws `URL string cannot be empty`
- In `src/app/api/proxy/route.ts`:
  - `127.0.0.1`, `localhost`, `10.0.0.1`, `192.168.1.1`, `172.16.0.1`, `169.254.169.254`, `0.0.0.0`, `::1`, `[::1]`, `*.local` are explicitly rejected with `Error("Blocked host")`.

### C. Floor Control Single-Writer Mutex & Queue Concurrency
- Inspected `vm-service/index.ts` lines 48–158 (`FloorControlManager`) and lines 491–497 (single-writer invariant on Opcodes 2–11).
- Executed 1,000-user concurrent stress harness:
  - User 0 requested control -> State transitioned `IDLE` -> `OCCUPIED`, active controller set to `u_0`.
  - Users 1 through 999 queued in strict FIFO order (`queue.length = 999`).
  - Duplicate requests from queued users preserved queue position without queue duplication.
  - Sockets not holding the active floor lock (`isController(ws) === false`) were strictly filtered out from dispatching input events.
  - Spoofed release requests from unauthorized sockets (`releaseControl("u_0", socketEve)`) were rejected with `{ status: "unauthorized" }`.
  - Chaos simulation: 500 queued sockets closed. Active controller release skipped all closed/dead sockets and promoted the first live socket `u_2`.
  - Full queue drainage step down to 0 promoted users returned state cleanly to `IDLE` with `activeControllerId: null`.

### D. Normalized Cursor Coordinate Mapping Math
- Inspected `vm-service/index.ts` lines 160–176 (`sanitizeUnit` and `normalizeCoordinates`) and `src/components/watchparty/virtual-browser.tsx` lines 260–273 (`getNormalizedCoords`).
- Verified behavior under extreme boundary values:
  - Center `(0.5, 0.5)` on 1920x1080 -> mapped to exact pixel `(960, 540)`.
  - Origin `(0.0, 0.0)` -> mapped to `(0, 0)`.
  - Max bound `(1.0, 1.0)` -> mapped to `(1919, 1079)`.
  - Negative out-of-bounds `(-0.1, -50.0)` -> clamped to `(0, 0)`.
  - Positive out-of-bounds `(1.1, 999.9)` -> clamped to `(1919, 1079)`.
  - `-Infinity` -> clamped to `(0, 0)`.
  - `+Infinity` -> clamped to `(1919, 1079)`.
  - `NaN`, non-numbers, `undefined`, `null` -> sanitized via `sanitizeUnit` to default `0.0`, resulting in valid pixel integer `(0, 0)` without runtime exceptions.

### E. Root HTML Default Light Theme Invariant
- Inspected `src/app/layout.tsx` lines 29–33:
  ```tsx
  <html lang="en" suppressHydrationWarning>
    <body
      className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
    >
  ```
  Confirmed: No hardcoded `className="dark"` is present on the root `<html>` element.
- Inspected `src/app/globals.css` lines 50–84:
  - `:root` declares the Porcelain Light Theme (`--background: oklch(0.985 0.005 290)`, `--foreground: oklch(0.18 0.01 280)`, `--primary: oklch(0.55 0.24 295)`).
  - `.dark` is strictly scoped to dark-mode overrides (`--background: oklch(0.13 0.005 280)`).

---

## 2. Logic Chain

1. **SSRF and Execution Scheme Containment**:
   - Observation: `sanitizeUrl()` enforces a strict blacklist of executable and internal schemes (`file:`, `javascript:`, `chrome:`, `chrome-extension:`, `data:`, `about:`) and parses inputs strictly with Node/V8 `URL` requiring `http:` or `https:`. The Next.js reverse proxy (`src/app/api/proxy/route.ts`) further enforces strict host blocking against RFC 1918, RFC 3927 (link-local cloud metadata `169.254.169.254`), loopbacks, and `.local` domains.
   - Deduction: Malicious participants cannot trigger local file reads or execute client-side scripts via the address bar navigation mechanism.

2. **Single-Writer Mutex and Concurrency Invariant**:
   - Observation: `FloorControlManager` gates input execution behind `floorManager.isController(ws)`. In the 1,000-user stress test and chaos disconnect simulations, non-controller sockets were rejected 100% of the time, and disconnects resulted in clean FIFO promotion without starvation or lock deadlock.
   - Deduction: Remote control of the browser canvas is strictly serialized; no race conditions or multi-user cross-talk input corruption can occur.

3. **Coordinate Normalization Robustness**:
   - Observation: `normalizeCoordinates()` uses `sanitizeUnit()`, which uses `Number.isNaN()` checks and `Math.min(1, Math.max(0, v))` before projecting to screen dimensions with `Math.floor()`.
   - Deduction: Extreme floats, infinities, and invalid payload types will never cause out-of-bounds pointer crashes, invalid CDP protocol payloads, or canvas overflow.

4. **UI Light Theme Default Guarantee**:
   - Observation: Root `<html>` tag has no dark class attached, and CSS `:root` defines the Porcelain light theme palette.
   - Deduction: Fresh visits to the application render in Porcelain light theme by default without flash of unstyled dark content.

---

## 3. Caveats

- In cloud deployments where the dedicated Chrome VM is deployed on AWS/GCP, network-level egress filtering (e.g. AWS Security Groups or iptables) should complement `isBlockedHost` for defense-in-depth against DNS rebinding attacks on the dedicated Chromium instance.
- No other caveats. All four core verification scopes were empirically validated.

---

## 4. Conclusion

**Verdict: APPROVE**

All VM Co-Browsing Security Invariants and UI Theme Invariants pass adversarial testing under high concurrency, extreme boundary inputs, and chaos fault injection:
- URL sanitization strictly rejects `file://`, `javascript:`, `chrome://`, and malformed payloads.
- Floor control single-writer mutex holds under 1,000 concurrent requesters with zero unauthorized input leakage.
- Normalized coordinate mapping safely bounds all inputs (including `NaN` and `Infinity`) to valid integer pixel ranges.
- Default light theme is active on root HTML and stylesheet `:root`.

---

## 5. Verification Method

To independently reproduce and verify this assessment:

1. Run the project test suite:
   ```bash
   bun test
   ```
   *Expected outcome*: 120 tests pass, 0 fail across 7 files.

2. Inspect security and state files:
   - `vm-service/index.ts` (lines 48–206)
   - `src/app/api/proxy/route.ts` (lines 9–39)
   - `src/app/layout.tsx` (lines 29–33)
   - `src/app/globals.css` (lines 50–84)

3. Invalidation condition:
   Any failure in `bun test` or any unauthorized socket being accepted as active controller would invalidate this verdict.
