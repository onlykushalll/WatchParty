# Forensic Architecture & Adversarial Survey Report: Co-Browsing Virtual PC Subsystem

**Subsystem Scope**: Co-Browsing Virtual PC (`vm-service/`, `src/components/watchparty/virtual-browser.tsx`, `mini-services/sync-service/index.ts`, `src/lib/sync/use-sync-engine.ts`)  
**Investigator**: Explorer Survey Agent 2  
**Date**: 2026-08-17  
**Status**: Comprehensive Survey Completed  

---

## 1. Executive Summary & Architecture Overview

The WatchParty Co-Browsing Virtual PC subsystem provides real-time, interactive, synchronized web browsing directly within a shared room canvas. It enables a designated room participant ("Floor Controller") to drive a headless/dedicated Chromium instance running on the backend while all other participants receive a synchronized 15–24 FPS JPEG stream with real-time remote cursor overlays, synchronized navigation events, and floor control queuing.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                 Client Viewport                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ Navigation Toolbar (URL bar, Back, Forward, Reload, Floor Control Lock)   │  │
│  ├───────────────────────────────────────────────────────────────────────────┤  │
│  │ <canvas> Stream Stage (1920x1080 stretched / responsive)                  │  │
│  │   ├── Remote Cursor SVG Badges (Normalized [0, 1]^2 CSS % positioning)    │  │
│  │   └── "YOU HAVE CONTROL" / "Someone is controlling" Status Banners        │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────┬───────────────────────────────┬─────────────────────────┘
                        │ Normalized Inputs (Op 2-11)   │ Room State & Signatures
                        │ Screencast Frames (Op 1)      │ (vm:control:request,
                        │ Navigation Push (Op 12)       │  vm:control:release,
                        │ Floor Control (Op 16, 128)    │  vm:cursor)
                        ▼                               ▼
    ┌────────────────────────────────────────┐ ┌─────────────────────────────────┐
    │       vm-service (Port 3004)           │ │   sync-service (Port 3001)      │
    │  - FloorControlManager (IDLE/OCCUPIED) │ │ - Room Participants & Presence  │
    │  - Single-Writer Security Guard        │ │ - Room VM Controller & Queue    │
    │  - URL Sanitizer (Scheme filter)       │ │ - Playback Sync & WebRTC Mesh   │
    │  - Headless Puppeteer Chromium         │ │ - Remote Command Relays         │
    │  - 15 FPS Capture Loop                 │ └─────────────────────────────────┘
    └────────────────────────────────────────┘
```

### Key Files in Scope
1. `vm-service/index.ts` (698 lines): Primary VM streaming server implementing `FloorControlManager`, single-writer security invariant, unit coordinate normalization, URL sanitization, and binary WebSocket opcode framing.
2. `vm-service/dedicated-chrome.ts` (442 lines): Isolated user-data-dir Chrome instance with local floor manager and JPEG streaming.
3. `vm-service/cdp-browser.ts` (394 lines): Experimental CDP `Page.startScreencast` service.
4. `vm-service/vnc-proxy.ts` (86 lines): Raw TCP-to-WebSocket bridge for RFB/noVNC.
5. `vm-service/video-extractor.ts` (241 lines): Dedicated headless service for intercepting m3u8/mp4 media streams.
6. `src/components/watchparty/virtual-browser.tsx` (375 lines): React client component with canvas renderer, remote cursor overlays, toolbar, normalized event listeners, and control buttons.
7. `mini-services/sync-service/index.ts` (813 lines): Central Socket.IO server managing room state (`r.vmController`, `r.vmControlQueue`, `vm:cursor`).
8. `src/lib/sync/use-sync-engine.ts` (478 lines): React hook managing client Socket.IO state, cursors, and intent dispatch.
9. `src/__tests__/vm-service.test.ts` (418 lines): 29 unit and empirical stress tests for floor control, coordinate math, and URL sanitization.

---

## 2. Mutex Floor Control Queue State Transitions (IDLE <-> OCCUPIED)

### 2.1 State Machine Specification (`vm-service/index.ts`)

The floor control subsystem guarantees mutual exclusion so that exactly one active writer can dispatch input events to the browser process at any instant.

```
                      ┌──────────────────────┐
                      │         IDLE         │
                      │ controllerId = null  │
                      │ queue = []           │
                      └──────────┬───────────┘
                                 │
           requestControl(u1, s1)│ releaseControl(u1, s1) [queue == []]
           status: "granted"     │ status: "idle"
                                 ▼
                      ┌──────────────────────┐
      ┌──────────────>│       OCCUPIED       │<─────────────┐
      │               │ controllerId = u1    │              │
      │               │ queue = [u2, u3...]  │              │
      │               └──────────┬───────────┘              │
      │                          │                          │
      │ requestControl(u2, s2)   │ releaseControl(u1)       │ handleDisconnect(s1)
      │ status: "queued"         │ [queue != []]            │ status: "promoted"
      │ (appends u2 to queue)    │ status: "promoted"       │ (u2 becomes controller)
      │                          │ (u2 becomes controller)  │
      └──────────────────────────┴──────────────────────────┴──────┘
```

#### State Properties:
- **`IDLE`**: No user possesses floor control. `activeControllerId = null`, `activeControllerSocket = null`, `controlQueue = []`.
- **`OCCUPIED`**: A single client socket is designated as `activeControllerSocket`. Incoming input events from this socket are authorized; input events from all other sockets are dropped.

#### State Transitions:
1. **Initial Grant**: `requestControl(userId, userName, socket)` when `state === "IDLE"`:
   - Sets `state = "OCCUPIED"`, `activeControllerId = userId`, `activeControllerSocket = socket`.
   - Sends Opcode `128` (`grantControl`) directly to requesting socket.
   - Broadcasts Opcode `129` (`controlState`) to all connected sockets.
2. **FIFO Enqueue**: `requestControl(userId, userName, socket)` when `state === "OCCUPIED"`:
   - If `userId === activeControllerId`: Updates `activeControllerSocket = socket`, returns `{ status: "already_controller" }`.
   - If `userId` already in `controlQueue`: Updates stored socket and userName in-place (prevents duplicate queue slots).
   - If `userId` not in queue: Appends `{ userId, userName, socket }` to `controlQueue`, returns `{ status: "queued", position }`.
   - Broadcasts Opcode `129`.
3. **Voluntary Floor Release**: `releaseControl(userId, requestingSocket)`:
   - Authorization check: If `requestingSocket` provided, verifies `activeControllerSocket === requestingSocket`. If mismatched, rejects with `{ status: "unauthorized" }`.
   - If `controlQueue.length > 0`: Pops head (`next = controlQueue.shift()`), promotes `next.userId` to `activeControllerId`, updates `activeControllerSocket`, sends Opcode `128` to `next.socket`, broadcasts Opcode `129` (`status: "promoted"`).
   - If `controlQueue.length === 0`: Resets to `IDLE` (`activeControllerId = null`, `activeControllerSocket = null`), broadcasts Opcode `128` with `{ controllerId: null }` and Opcode `129` (`status: "idle"`).
4. **Queue Removal / Cancellation**: Queued user calls `releaseControl(userId, requestingSocket)`:
   - Verifies `queuedItem.socket === requestingSocket`.
   - Removes user from `controlQueue`, broadcasts Opcode `129` (`status: "removed_from_queue"`).
5. **Host Force Revocation**: `revokeControl(targetUserId)`:
   - Bypasses socket matching. If `targetUserId === activeControllerId`, invokes `releaseControl` to promote queue head or set IDLE. If queued, filters out of queue.
6. **Socket Disconnect Handshake**: `handleDisconnect(socket)`:
   - If disconnected socket was active controller: Automatically invokes `releaseControl(activeControllerId)` to promote next queued user or transition to IDLE.
   - If disconnected socket was in queue: Filters out disconnected socket entries from `controlQueue`.

---

## 3. Normalized Remote Cursor Coordinate Mapping $[0, 1]^2$

### 3.1 Mathematical Foundation

To decouple heterogeneous client display aspect ratios, window viewports, high-DPI scaling factors (Retina / 4K), and server Chromium virtual screen resolution ($1920 \times 1080$), all mouse coordinates are strictly represented as dimensionless unit vectors $(x_{norm}, y_{norm}) \in [0, 1]^2$.

```
Client Mouse Event: (clientX, clientY)
       │
       ▼  Canvas Bounding Box: { left, top, width, height }
   x_norm = clamp((clientX - left) / width, 0, 1)
   y_norm = clamp((clientY - top) / height, 0, 1)
       │
       ├─────────────────────────────────┐
       ▼ (WebSocket Opcode 2/3)          ▼ (Socket.IO vm:cursor)
Server Pixel Mapping:             Peer Visual Overlay:
   x_px = min(W-1, floor(x_norm * W)) CSS: left: ${x_norm * 100}%
   y_px = min(H-1, floor(y_norm * H))      top:  ${y_norm * 100}%
```

### 3.2 Code Implementation Verification

#### Server-Side Transformation (`vm-service/index.ts:157-173`):
```typescript
export function sanitizeUnit(v: number): number {
  if (typeof v !== "number" || Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export function normalizeCoordinates(
  xNorm: number,
  yNorm: number,
  width: number = WIDTH,
  height: number = HEIGHT
): { x: number; y: number } {
  const clampedX = sanitizeUnit(xNorm);
  const clampedY = sanitizeUnit(yNorm);
  const x = Math.min(width - 1, Math.max(0, Math.floor(clampedX * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(clampedY * height)));
  return { x, y };
}
```

#### Client-Side Normalization (`src/components/watchparty/virtual-browser.tsx:166-174`):
```typescript
const getNormalizedCoords = (e: React.MouseEvent) => {
  const canvas = canvasRef.current;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  };
};
```

#### Remote Cursor Overlay Rendering (`virtual-browser.tsx:320-329`):
```tsx
{remoteCursors.filter((c) => c.userId !== userId).map((c) => (
  <div
    key={c.userId}
    className="absolute transition-all duration-75"
    style={{
      left: `${c.x * 100}%`,
      top: `${c.y * 100}%`,
      transform: "translate(-2px,-2px)",
    }}
  >
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 2L3 16L7 12L10 18L12 17L9 11L15 11L3 2Z" fill={c.color} stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
    <span className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ backgroundColor: c.color }}>
      {c.name.slice(0, 8)}
    </span>
  </div>
))}
```

---

## 4. URL Sanitization & Single-Writer Security Invariant

### 4.1 Single-Writer Security Invariant

**Invariant Statement**: *No input message (mouse move, mouse click, mouse scroll, key press, text input, navigation, history traversal, reload, or script execution) shall be processed or dispatched to the underlying Chromium browser instance unless the originating WebSocket connection is the active `FloorControlManager` controller socket.*

#### Enforcement Point (`vm-service/index.ts:470-476`):
```typescript
// Single-Writer Security Invariant: reject input events if not current active controller
if ([2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(type)) {
  if (!floorManager.isController(ws)) {
    // Reject unauthorized input event frame
    return;
  }
}
```

### 4.2 URL Sanitization Security Guard

**Threat Model**: Malicious participants entering URLs into the address bar or crafting POST `/navigate` HTTP payloads attempting:
1. Local filesystem exfiltration (`file:///etc/passwd`, `file://C:/Windows/System32/config/SAM`).
2. Browser internal configuration tampering (`chrome://settings`, `chrome://flags`, `chrome-extension://`).
3. Cross-Site Scripting / Execution context hijacking (`javascript:alert(1)`, `data:text/html,...`).
4. Blank / about navigation exploits (`about:blank`, `about:config`).

#### Sanitization Function (`vm-service/index.ts:175-203`):
```typescript
export function sanitizeUrl(inputUrl: string): string {
  const trimmed = (inputUrl || "").trim();
  if (!trimmed) {
    throw new Error("URL string cannot be empty");
  }

  const lower = trimmed.toLowerCase();
  const forbiddenSchemes = ["file:", "chrome:", "chrome-extension:", "javascript:", "data:", "about:"];
  for (const scheme of forbiddenSchemes) {
    if (lower.startsWith(scheme)) {
      throw new Error(`Forbidden URL scheme: ${scheme}`);
    }
  }

  let formatted = trimmed;
  if (!/^https?:\/\//i.test(formatted)) {
    formatted = `https://${formatted}`;
  }

  try {
    const parsed = new URL(formatted);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only HTTP and HTTPS protocols are allowed");
    }
    return parsed.toString();
  } catch (err) {
    throw new Error(`Invalid URL format: ${(err as Error).message}`);
  }
}
```

---

## 5. Session Lifecycle, CDP / VNC Connection Handling & Message Framing

### 5.1 Binary WebSocket Opcode Framing Protocol

The `vm-service` communicates with clients over a single binary WebSocket (`/ws`). The first byte (`data[0]`) indicates the message opcode:

| Opcode (Hex / Dec) | Direction | Payload Structure | Description |
| :--- | :--- | :--- | :--- |
| `0x01` (1) | Server $\rightarrow$ Client | `[1, ...jpegBytes]` | Binary JPEG screenshot frame (1920x1080) |
| `0x02` (2) | Client $\rightarrow$ Server | `[2, ...JSON({ xNorm, yNorm })]` | Mouse move to normalized coordinates |
| `0x03` (3) | Client $\rightarrow$ Server | `[3, ...JSON({ xNorm, yNorm, button })]` | Mouse click at normalized coordinates |
| `0x04` (4) | Client $\rightarrow$ Server | `[4, ...JSON({ deltaX, deltaY })]` | Mouse wheel scroll |
| `0x05` (5) | Client $\rightarrow$ Server | `[5, ...JSON({ key })]` | Keyboard key press / special keys |
| `0x06` (6) | Client $\rightarrow$ Server | `[6, ...JSON({ text })]` | Keyboard text typing |
| `0x07` (7) | Client $\rightarrow$ Server | `[7, ...JSON({ url })]` | Navigate to sanitized URL |
| `0x08` (8) | Client $\rightarrow$ Server | `[8]` | History back (`page.goBack()`) |
| `0x09` (9) | Client $\rightarrow$ Server | `[9]` | History forward (`page.goForward()`) |
| `0x0A` (10) | Client $\rightarrow$ Server | `[10]` | Reload page (`page.reload()`) |
| `0x0B` (11) | Client $\rightarrow$ Server | `[11, ...JSON({ script })]` | Evaluate JavaScript in browser context |
| `0x0C` (12) | Server $\rightarrow$ Client | `[12, ...JSON({ url })]` | Push CDP `framenavigated` URL change |
| `0x10` (16) | Client $\rightarrow$ Server | `[16, ...JSON({ userId, userName })]` | Request floor control |
| `0x11` (17) | Client $\rightarrow$ Server | `[17, ...JSON({ userId })]` | Release floor control |
| `0x12` (18) | Client $\rightarrow$ Server | `[18, ...JSON({ targetUserId })]` | Host revoke floor control |
| `0x80` (128) | Server $\rightarrow$ Client | `[128, ...JSON({ controllerId, controllerName })]` | Floor control granted notification |
| `0x81` (129) | Server $\rightarrow$ Client | `[129, ...JSON({ controllerId, controllerName, queue })]` | Floor control queue state broadcast |

### 5.2 Address Bar Synchronization Architecture

When a user clicks an internal link or redirects within the virtual browser, `vm-service/index.ts` intercepts CDP navigation events:
```typescript
page.on("framenavigated", (frame) => {
  if (page && frame === page.mainFrame()) {
    broadcastUrl(page.url());
  }
});
```
This pushes Opcode `12` with the updated URL immediately to all connected clients.

---

## 6. Comprehensive Defect, Vulnerability & Inconsistency Catalog

Through forensic analysis of all files in the subsystem, the following **6 critical defects and architectural gaps** have been identified:

| ID | Component | File & Lines | Severity | Defect Description | Impact & Risk | Recommended Resolution |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BUG-VM-01** | `VirtualBrowser` $\leftrightarrow$ `vm-service` | `virtual-browser.tsx:147-151, 281-298`<br>`vm-service/index.ts:470-476` | **CRITICAL** | **Floor Control State Disconnect**: `VirtualBrowser` sends floor control requests exclusively to `sync-service` via Socket.IO, but never sends Opcode `16` (`request-control`) or `17` (`release-control`) to `vm-service`. | `vm-service`'s `floorManager.activeControllerSocket` remains `null`. `isController(ws)` returns `false` for all clients, causing `vm-service` to **drop 100% of user inputs** (mouse, click, keydown). | In `virtual-browser.tsx`, send Opcode `16` over WebSocket when controller status is acquired, or send Opcode `16` on mount/request. |
| **BUG-VM-02** | `VirtualBrowser` | `virtual-browser.tsx:81-110, 127-134` | **HIGH** | **Missing Opcode 12 Navigation Decoder**: `VirtualBrowser`'s `ws.onmessage` only handles Opcode `1` (JPEG frames). It ignores Opcode `12` (CDP `framenavigated` push), falling back to a 3000ms HTTP polling loop (`fetch('/url')`). | 3-second delay for address bar synchronization when clicking links in the virtual browser, unnecessary HTTP polling traffic. | Add `else if (data[0] === 12)` handler in `virtual-browser.tsx:ws.onmessage` and remove HTTP polling interval. |
| **BUG-VM-03** | `sync-service` | `sync-service/index.ts:759-785` | **HIGH** | **Orphaned Controller on Disconnect**: `sync-service` does NOT promote the queue or clear `r.vmController` / `r.vmControlQueue` when a user holding or queued for VM control closes their browser tab. | Room becomes stuck in a locked VM state where the disconnected user remains `vmController`, blocking other users from interacting until manual room reset. | In `sync-service`'s `disconnect` event, check `if (r.vmController === me.userId)`: promote `r.vmControlQueue.shift() || null` and broadcast `vm:control:state`. |
| **BUG-VM-04** | `dedicated-chrome.ts` | `dedicated-chrome.ts:187, 321` | **HIGH** | **Security Bypass in Dedicated Chrome**: `dedicated-chrome.ts` does not call `sanitizeUrl()` in either the POST `/navigate` endpoint or the WebSocket Opcode `7` handler. | Allows navigation to `file:///`, `chrome://`, `javascript:`, bypassing sandbox security guards. | Wrap navigation targets in `sanitizeUrl(url)` as in `index.ts`. |
| **BUG-VM-05** | `cdp-browser.ts` | `cdp-browser.ts:197-282` | **CRITICAL** | **Total Security & Single-Writer Absence**: `cdp-browser.ts` has no `FloorControlManager`, allows unauthenticated input injection from any client, and executes arbitrary code via Opcode `11` (`page.evaluate(payload.script)`). | Complete remote code execution / session hijacking risk if `cdp-browser.ts` is deployed. | Port `FloorControlManager` and input authorization checks to `cdp-browser.ts` or standardize exclusively on `index.ts`. |
| **BUG-VM-06** | `VirtualBrowser` | `virtual-browser.tsx:166-174` | **MEDIUM** | **Unclamped Client Mouse Coordinates**: `getNormalizedCoords` does not clamp `(clientX - rect.left) / rect.width` with `Math.min(1, Math.max(0, ...))`. | Dragging mouse outside canvas boundaries emits out-of-bounds fractions ($<0$ or $>1$) to `onCursorMove`, causing remote cursor badges to render off-screen for peers. | Add `Math.min(1, Math.max(0, ...))` clamping to `getNormalizedCoords`. |

---

## 7. Verification & Test Suite Analysis

### 7.1 Existing Test Suite (`src/__tests__/vm-service.test.ts`)
- Total Tests: **29 passing tests** (567 `expect()` assertions).
- Execution Time: ~243ms via `bun test`.
- Coverage Areas:
  1. `FloorControlManager` state machine transitions (`IDLE` $\leftrightarrow$ `OCCUPIED`).
  2. FIFO queueing, deduplication, queue head promotion, unauthorized release rejection, host force revocation.
  3. Disconnect cleanup with cascading promotion draining to `IDLE`.
  4. Unit vector coordinate normalization math ($[0, 1] \rightarrow \text{pixels}$), bounds clamping, negative/positive overflow, and `NaN`/`Infinity` resilience.
  5. URL sanitization schemes (`file:`, `chrome:`, `javascript:`, `data:`, `about:`, whitespace) and canonical protocol formatting.
  6. Empirical stress tests: 100 concurrent requests, cascading disconnects, single-writer invariant across socket lifecycle.

### 7.2 Verification Commands
```bash
# Run unit & stress tests for Co-Browsing Virtual PC
bun test src/__tests__/vm-service.test.ts

# Run entire WatchParty test suite
bun test

# Run Next.js production build verification
bun run build
```

---

## 8. Summary of Findings & Next Steps

1. The core math for coordinate normalization ($[0, 1]^2 \rightarrow 1920\times 1080$), URL scheme validation, and `FloorControlManager` state transitions in `vm-service/index.ts` is mathematically sound, robust, and verified by 29 automated tests.
2. The primary vulnerability and integration bug resides in the **interface layer between `virtual-browser.tsx` and `vm-service`**: `virtual-browser.tsx` does not send Opcode `16` over WebSocket, resulting in `vm-service` dropping all client mouse and keyboard inputs due to its single-writer security guard.
3. Secondary VM scripts (`dedicated-chrome.ts`, `cdp-browser.ts`) contain security bypasses (un-sanitized URLs, unauthenticated JS evaluation) that must be aligned with `index.ts`.
4. Address bar synchronization should be enhanced in `virtual-browser.tsx` by consuming Opcode `12` frames emitted by `vm-service`'s CDP listener, eliminating 3-second HTTP polling.
