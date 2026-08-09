# Technical Architecture & Implementation Blueprint: Interactive Virtual Desktop Co-Browsing (Milestone 3 / Requirement R3)

**Subagent ID**: `teamwork_preview_explorer_m3_1`  
**Working Directory**: `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_explorer_m3_1`  
**Milestone**: Milestone 3 (Interactive Virtual Desktop VM Co-Browsing Stage)  
**Requirement Target**: Requirement R3 & R1 VM Specifications  
**Status**: Investigation Complete — Blueprint Ready for Implementation  

---

## 1. Executive Summary & Architecture Overview

Requirement R3 mandates a multi-user interactive Virtual Desktop (VM) co-browsing stage where users in a shared room can interactively view, navigate, and control a containerized headless/dedicated Chromium browser session in real time. 

To achieve a production-grade, secure, multi-user co-browsing environment with low-latency responsiveness, five core architectural pillars must be realized:
1. **Server-Side Mutex Floor Control Queue State Machine**: Enforces single-writer security invariants (`IDLE` vs. `OCCUPIED` states, FIFO request queue, server-authoritative event filtering) so that unauthorized clients cannot hijack cursor or keyboard input.
2. **Normalized Unit Vector Input System**: Captures client mouse interactions as floating-point unit vectors $(x_{\text{norm}}, y_{\text{norm}}) \in [0, 1]^2$ relative to the rendered canvas container and projects them to server-side viewport dimensions $(X_{\text{pixel}}, Y_{\text{pixel}})$, guaranteeing input accuracy across arbitrary client resolutions and aspect ratios.
3. **Multi-User Remote Cursor Overlay**: Relays the active floor controller's cursor position $(x_{\text{norm}}, y_{\text{norm}})$ to all room participants via WebSocket / Socket.IO and renders smooth CSS cursor overlays with avatar/name tags.
4. **Shared Address Bar Navigation & CDP Event Pushing**: Provides URL input bar, protocol sanitization (blocking dangerous schemes like `file://`, `chrome://`, `javascript:`), CDP `page.goto(url)` over WebSocket, and real-time CDP frame navigation push events to update all clients' address bars without HTTP polling.
5. **Dynamic Cloud-Ready Headless Chrome Launch**: Supports dynamic environment paths (`process.env.CHROME_PATH || '/usr/bin/chromium'`) and configurable headless execution (`process.env.HEADLESS !== 'false'`) optimized for low-RAM cloud containerization (Render.com 512MB RAM budget).

---

## 2. Existing Codebase Audit & Gap Matrix

An exhaustive audit of `vm-service/index.ts`, `vm-service/dedicated-chrome.ts`, `src/components/watchparty/virtual-browser.tsx`, and `mini-services/sync-service/index.ts` revealed five major architectural defects that must be refactored:

```
+--------------------------------------------------------------------------------------------------+
|                                    CODEBASE GAP MATRIX                                           |
+-------------------+-----------------------------------+------------------------------------------+
| Source File       | Existing Implementation           | Architectural Defect / Gap               |
+-------------------+-----------------------------------+------------------------------------------+
| vm-service/       | Raw WebSocket server on port 3004.| ❌ No floor control checks. Accepts input|
| index.ts          | Executes all incoming input events| frames from ANY socket. Violates single- |
|                   | unconditionally.                  | writer security invariant.               |
+-------------------+-----------------------------------+------------------------------------------+
| virtual-browser.ts| Computes pixel coords via canvas  | ❌ Resolution mismatch risk. Sends raw   |
|                   | dimensions (Math.round(x * scale))| absolute pixels instead of unit vectors  |
|                   | and sends to server.              | (x_norm, y_norm) in [0, 1]^2.            |
+-------------------+-----------------------------------+------------------------------------------+
| virtual-browser.ts| Runs HTTP setInterval polling     | ❌ High HTTP overhead (1 req / 3 sec)    |
|                   | to GET /url every 3000ms.          | and delayed navigation feedback for      |
|                   |                                   | single-page apps.                        |
+-------------------+-----------------------------------+------------------------------------------+
| vm-service/       | Hardcoded Windows path            | ❌ Fails on Docker/Linux deployments     |
| index.ts          | CHROME_PATH = "C:\\...\\chrome.exe| where Chromium binary is at              |
|                   | and headless: false.              | /usr/bin/chromium.                       |
+-------------------+-----------------------------------+------------------------------------------+
| src/__tests__/    | Sync engine tests exist, but zero | ❌ No automated verification for floor   |
|                   | VM service tests.                 | mutex queue, coordinate math, or URL     |
|                   |                                   | sanitization.                            |
+-------------------+-----------------------------------+------------------------------------------+
```

---

## 3. Comprehensive File Modification Blueprint

### 3.1 Component 1: Server-Side Mutex Floor Control Queue (`vm-service/index.ts` & `mini-services/sync-service/index.ts`)

#### 3.1.1 State Machine Specification
The VM service (`vm-service/index.ts`) must maintain an internal state machine:
- **Floor State**: `floorState: 'IDLE' | 'OCCUPIED'` (Default: `'IDLE'`)
- **Active Controller**: `activeControllerId: string | null` (Default: `null`)
- **Active Controller Socket**: `activeControllerSocket: WebSocket | null` (Default: `null`)
- **Pending Control Queue**: `controlQueue: Array<{ userId: string; userName: string; socket: WebSocket }>` (Default: `[]`)

#### 3.1.2 Protocol Commands & Events (WebSocket Wire Protocol)
Extend the binary/JSON WebSocket protocol in `vm-service/index.ts`:

- **Client → Server Events**:
  - `0x10` (`16`): `request-control` — Payload: `{ userId: string, userName: string }`
  - `0x11` (`17`): `release-control` — Payload: `{ userId: string }`
  - `0x12` (`18`): `revoke-control` — Payload: `{ userId: string, targetUserId: string }` (Admin force-revoke)

- **Server → Client Broadcast Events**:
  - `0x80` (`128`): `grant-control` — Payload: `{ controllerId: string | null, controllerName?: string }`
  - `0x81` (`129`): `control-state` — Payload: `{ controllerId: string | null, queue: Array<{ userId: string, userName: string }> }`

#### 3.1.3 Single-Writer Security Invariant
In `vm-service/index.ts`, before processing any input frame (`0x02` mouse move, `0x03` click, `0x04` scroll, `0x05` keydown, `0x06` type, `0x07` navigate):
```typescript
// Single-Writer Security Invariant Enforcement
if (floorState !== 'OCCUPIED' || ws !== activeControllerSocket) {
  // Reject unauthorized input frame silently or log debug warning
  return;
}
```

#### 3.1.4 Exact Modification Instructions for `vm-service/index.ts`
1. Define `FloorState` interface and state variables.
2. In `wss.on('connection')`:
   - Send initial `control-state` event (`0x81`) to the newly connected client.
3. In `ws.on('message')`:
   - Handle Type `16` (`request-control`):
     - If `floorState === 'IDLE'`:
       - `floorState = 'OCCUPIED'`;
       - `activeControllerId = userId`;
       - `activeControllerSocket = ws`;
       - Send `grant-control` (`0x80`) to `ws`;
       - Broadcast `control-state` (`0x81`) to all connected clients.
     - Else (`floorState === 'OCCUPIED'`):
       - If `userId !== activeControllerId` and not already in `controlQueue`:
         - `controlQueue.push({ userId, userName, socket: ws })`;
         - Broadcast `control-state` (`0x81`) to all clients.
   - Handle Type `17` (`release-control`):
     - If `activeControllerId === userId`:
       - If `controlQueue.length > 0`:
         - `{ userId: nextId, userName: nextName, socket: nextWs } = controlQueue.shift()!`;
         - `activeControllerId = nextId`;
         - `activeControllerSocket = nextWs`;
         - Send `grant-control` (`0x80`) to `nextWs`;
         - Broadcast `control-state` (`0x81`) to all clients.
       - Else:
         - `floorState = 'IDLE'`;
         - `activeControllerId = null`;
         - `activeControllerSocket = null`;
         - Broadcast `grant-control` (`0x80`, `{ controllerId: null }`);
         - Broadcast `control-state` (`0x81`) to all clients.
   - Handle Type `18` (`revoke-control`):
     - If target user is current active controller or in queue, execute release / removal logic.
4. On `ws.on('close')`:
   - If `ws === activeControllerSocket`: Trigger release logic.
   - Remove `ws` from `controlQueue` if present, then broadcast updated `control-state`.

---

### 3.2 Component 2: Remote Input Vector Normalization Math (`virtual-browser.tsx` & `vm-service/index.ts`)

#### 3.2.1 Mathematical Model
- **Client Capture**:
  Given client event $(x_{\text{event}}, y_{\text{event}})$ and canvas bounding rectangle `rect`:
  $$x_{\text{norm}} = \frac{x_{\text{event}} - \text{rect.left}}{\text{rect.width}}$$
  $$y_{\text{norm}} = \frac{y_{\text{event}} - \text{rect.top}}{\text{rect.height}}$$
  Clamping:
  $$x_{\text{norm}} = \max(0, \min(1, x_{\text{norm}}))$$
  $$y_{\text{norm}} = \max(0, \min(1, y_{\text{norm}}))$$

- **Server Viewport Projection**:
  Given viewport dimensions $W, H$ (e.g., $1920, 1080$):
  $$X = \min(W - 1, \max(0, \lfloor x_{\text{norm}} \cdot W \rfloor))$$
  $$Y = \min(H - 1, \max(0, \lfloor y_{\text{norm}} \cdot H \rfloor))$$

#### 3.2.2 Exact Modification Instructions
- **In `src/components/watchparty/virtual-browser.tsx`**:
  Update mouse handlers to calculate unit vectors and send `{ xNorm, yNorm }`:
  ```typescript
  const getNormalizedCoords = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { xNorm: 0, yNorm: 0 };
    const rect = canvas.getBoundingClientRect();
    const xNorm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const yNorm = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { xNorm, yNorm };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isControllerRef.current) return;
    const { xNorm, yNorm } = getNormalizedCoords(e);
    sendMsg(2, { xNorm, yNorm });
    onCursorMove(xNorm, yNorm);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isControllerRef.current) return;
    const { xNorm, yNorm } = getNormalizedCoords(e);
    sendMsg(3, { xNorm, yNorm, button: e.button === 2 ? "right" : "left" });
    e.preventDefault();
  };
  ```

- **In `vm-service/index.ts`**:
  Update input message handler:
  ```typescript
  if (type === 2) {
    // Mouse move
    const { xNorm, yNorm } = JSON.parse(payload);
    const X = Math.min(WIDTH - 1, Math.max(0, Math.floor(xNorm * WIDTH)));
    const Y = Math.min(HEIGHT - 1, Math.max(0, Math.floor(yNorm * HEIGHT)));
    await page.mouse.move(X, Y);
  } else if (type === 3) {
    // Mouse click
    const { xNorm, yNorm, button } = JSON.parse(payload);
    const X = Math.min(WIDTH - 1, Math.max(0, Math.floor(xNorm * WIDTH)));
    const Y = Math.min(HEIGHT - 1, Math.max(0, Math.floor(yNorm * HEIGHT)));
    await page.mouse.click(X, Y, { button: button || "left" });
  }
  ```

---

### 3.3 Component 3: Multi-User Remote Cursor Overlay (`sync-service/index.ts` & `virtual-browser.tsx`)

#### 3.3.1 Specification
- The active controller emits $(x_{\text{norm}}, y_{\text{norm}})$ to `onCursorMove`.
- `sync-service/index.ts` relays `vm:cursor` to all other room participants:
  ```typescript
  socket.on("vm:cursor", (payload: { x: number; y: number }) => {
    if (!currentRoomId) return;
    const r = rooms.get(currentRoomId);
    if (!r) return;
    const me = r.participants.get(socket.id);
    if (!me) return;
    socket.to(currentRoomId).emit("vm:cursor", {
      userId: me.userId,
      name: me.name,
      color: me.color,
      x: payload.x,
      y: payload.y,
    });
  });
  ```
- **Client Rendering Overlay in `virtual-browser.tsx`**:
  Render absolute CSS percentages `left: ${c.x * 100}%`, `top: ${c.y * 100}%` with smooth CSS transition (`transition: left 75ms linear, top 75ms linear`), rendering user avatar initial badge and name tag.

---

### 3.4 Component 4: Shared URL Address Bar Navigation & CDP Event Pushing (`vm-service/index.ts` & `virtual-browser.tsx`)

#### 3.4.1 URL Sanitization Module (`vm-service/url-sanitizer.ts` or inline helper)
```typescript
export function sanitizeUrl(inputUrl: string): string {
  const trimmed = inputUrl.trim();
  if (!trimmed) {
    throw new Error("URL string cannot be empty");
  }

  // Block dangerous or internal schemes
  const lower = trimmed.toLowerCase();
  const forbiddenSchemes = ["file:", "chrome:", "chrome-extension:", "javascript:", "data:", "about:"];
  for (const scheme of forbiddenSchemes) {
    if (lower.startsWith(scheme)) {
      throw new Error(`Forbidden URL scheme: ${scheme}`);
    }
  }

  // Prepend https:// if protocol is missing
  let formatted = trimmed;
  if (!/^https?:\/\//i.test(formatted)) {
    formatted = `https://${formatted}`;
  }

  // Validate URL syntax
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

#### 3.4.2 CDP Event Pushing for Navigation
Replace HTTP `/url` polling by registering a Puppeteer `framenavigated` event in `vm-service/index.ts`:
```typescript
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) {
    const currentUrl = page.url();
    const payloadStr = JSON.stringify({ url: currentUrl });
    const msg = Buffer.concat([
      Buffer.from([12]), // Type 12 (0x0C): Push URL change
      Buffer.from(payloadStr),
    ]);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }
});
```
In `virtual-browser.tsx`:
- Listen for `data[0] === 12`, parse JSON payload `{ url }`, update `urlBar` state instantly.
- Remove `setInterval(..., 3000)` polling effect.

---

### 3.5 Component 5: Dynamic Headless Chrome Launch & Memory Tuning (`vm-service/index.ts`)

#### 3.5.1 Environment Configuration
```typescript
import { platform } from "os";

const DEFAULT_CHROME_PATH = platform() === "win32"
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "/usr/bin/chromium";

const CHROME_PATH = process.env.CHROME_PATH || DEFAULT_CHROME_PATH;
const IS_HEADLESS = process.env.HEADLESS !== "false";

console.log(`[vm] Environment Config -> CHROME_PATH: ${CHROME_PATH}, HEADLESS: ${IS_HEADLESS}`);

browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: IS_HEADLESS ? "shell" : false,
  args: [
    `--window-size=${WIDTH},${HEIGHT}`,
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    "--renderer-process-limit=2",
    '--js-flags="--max-old-space-size=512"',
    "--memory-pressure-off",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=Translate,BackForwardCache,MediaRouter,IsolateOrigins,site-per-process",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
    "--disable-blink-features=AutomationControlled",
    "--exclude-switches=enable-automation",
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ],
  defaultViewport: { width: WIDTH, height: HEIGHT },
  ignoreDefaultArgs: ["--enable-automation"],
});
```

---

## 4. Unit Testing Strategy & Test Plan (`src/__tests__/vm-service.test.ts`)

We will create a new test file: `src/__tests__/vm-service.test.ts` executing via `bun test`.

### 4.1 Test Cases Covered
1. **Floor Control Mutex Queue Unit Tests**:
   - `initial state is IDLE with no active controller`
   - `grants control to initial requester and sets state to OCCUPIED`
   - `queues subsequent control requests in FIFO order`
   - `promotes queue head when active controller releases floor`
   - `returns to IDLE state when last controller releases floor with empty queue`
   - `allows admin/host force revoke of floor control`
   - `removes disconnected user from queue or floor lock`
   - `STRESS / SECURITY: ignores input events originating from non-controller socket`
2. **Coordinate Normalization Math Unit Tests**:
   - `maps center coordinate (0.5, 0.5) to exact center pixels (960, 540) on 1920x1080`
   - `maps origin (0.0, 0.0) to (0, 0) and max bounds (1.0, 1.0) to (1919, 1079)`
   - `clamps out-of-bounds inputs (-0.2, 1.5) to valid [0, 1] range`
3. **URL Sanitization & Validation Unit Tests**:
   - `auto-prefixes missing protocol scheme (google.com -> https://google.com)`
   - `preserves valid http:// and https:// URLs`
   - `rejects dangerous file:// scheme`
   - `rejects chrome:// and chrome-extension:// schemes`
   - `rejects javascript: and data: inline execution schemes`

---

## 5. Verification Plan & Commands

1. **Static Analysis & Type Checking**:
   ```bash
   bun run build
   ```
   Must pass with zero TypeScript compilation errors.

2. **Automated Unit Tests**:
   ```bash
   bun test src/__tests__/vm-service.test.ts
   ```
   Must execute and pass 100% of test assertions.

3. **Runtime VM Health Verification**:
   ```bash
   curl http://localhost:3004/health
   ```
   Must return `{ ok: true, service: "vm-browser" }`.

---
*Report Prepared by Explorer Subagent (`teamwork_preview_explorer_m3_1`)*
