# Technical Specification & Architectural Research: Interactive Virtual Desktop (VM) Co-Browsing Architecture

**Milestone**: Milestone 1 (Architectural Research & Specs)  
**Requirements**: R1 & R3  
**Target Path**: `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/.agents/teamwork_preview_explorer_m1_2/analysis.md`  
**Status**: Completed  

---

## 1. Executive Summary & System Overview

The **WatchParty Interactive Virtual Desktop (VM) Co-Browsing Architecture** enables multiple concurrent users in a shared virtual watch party room to view, navigate, and interactively control a single cloud-hosted Chromium browser session in real time.

Co-browsing differs from static video playback (YouTube, HLS, MP4) because the media stream is dynamically rendered server-side by a containerized Chromium instance. To achieve sub-100ms interaction latency, synchronized multi-user cursor visibility, and race-free control transfer, the VM co-browsing stage integrates four core subsystems:
1. **Containerized Chromium Capture & Streaming Engine**: Low-RAM Chromium execution paired with WebSocket frame streaming (MJPEG binary protocol) and a WebRTC PeerConnection pipeline (H.264/VP8 low-latency video + Opus audio stream).
2. **Normalized Unit Vector Input System**: Client cursor inputs captured as floating-point unit vectors $(x_{\text{norm}}, y_{\text{norm}}) \in [0, 1]^2$, independent of local display DPI, canvas dimensions, or aspect ratios, and mapped to server-side viewport dimensions $(W_{\text{viewport}} \times H_{\text{viewport}})$.
3. **Mutex Floor Control Queue Engine**: A stateful, single-writer multi-reader floor control queue preventing concurrent conflicting inputs while allowing seamless request, grant, release, and broadcast of control authority.
4. **Synchronized URL Navigation & Toolbar State**: Real-time URL synchronization, navigation event propagation (`navigate`, `back`, `forward`, `reload`), and security sanitization.

---

## 2. Containerized Chromium Screen Capture & Streaming Architecture

### 2.1 Streaming Protocols: WebSocket Binary JPEG vs WebRTC MediaStream

WatchParty supports two streaming transport architectures for VM co-browsing:

| Feature / Metric | WebSocket MJPEG Stream (`/ws`) | WebRTC MediaStream (`RTCDataChannel` / RTP) |
| :--- | :--- | :--- |
| **Transport Protocol** | TCP (WebSocket binary frames) | UDP (SRTP / SCTP) with TCP fallback (TURN/TLS) |
| **Codec / Payload** | JPEG images (`image/jpeg`), standard binary frames | H.264 / VP8 video stream + Opus audio stream |
| **Frame Encoding Cost** | Low CPU per frame (`puppeteer` screenshot clip) | Medium/High GPU/CPU encoding (FFmpeg / WebRTC native) |
| **Latency Profile** | 60ms – 150ms (TCP buffer delay under packet loss) | 20ms – 70ms (Unreliable/unordered RTP delivery) |
| **Cloud Proxy Compatibility** | 100% compatible with Cloudflare Tunnel, Nginx, Render HTTP proxies | Requires STUN/TURN server (Coturn) for NAT traversal |
| **Audio Support** | No native audio stream (requires separate WebAudio pipeline) | Synchronized stereo audio stream embedded in MediaStream |
| **Bandwidth Efficiency** | 2.5 – 6.0 Mbps at 1600x900 / 24 FPS (JPEG Quality 80) | 0.8 – 2.0 Mbps at 1600x900 / 30 FPS (H.264 hardware/software) |

#### Recommended Dual-Engine Strategy
- **Primary Transport**: WebRTC PeerConnection for low-latency video/audio streaming where UDP/ICE connectivity is supported.
- **Fallback Transport**: WebSocket binary JPEG frame streaming over port 3004 (or proxied `/vm/ws`) for restrictive network environments, firewalls, or proxy topologies (e.g. Render.com / Cloudflare Tunnel).

---

### 2.2 Low-RAM & Cloud Optimization Flags (Render.com Deployment)

Running headless or non-headless Chromium in cloud environments with limited memory (e.g. Render.com 512MB / 1GB RAM instances) requires explicit V8 and Chromium engine configuration flags:

```typescript
const CHROMIUM_LAUNCH_ARGS = [
  // Container & Memory Management
  "--disable-dev-shm-usage",         // Use /tmp instead of /dev/shm (prevents crash on default 64MB Docker /dev/shm)
  "--js-flags=--max-old-space-size=512", // Cap V8 JS heap size to 512MB
  "--renderer-process-limit=2",       // Cap renderer process spawn limit
  "--memory-pressure-off",            // Prevent premature renderer kill under synthetic pressure
  
  // Display & Rendering Optimizations
  "--no-sandbox",                     // Required inside unprivileged Docker containers
  "--disable-gpu",                    // Disable hardware acceleration on headless cloud servers
  "--disable-software-rasterizer",    // Avoid CPU-heavy software rasterization fallback
  "--window-size=1600,900",           // Fixed canonical resolution
  
  // Backgrounding & Performance Protection
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--autoplay-policy=no-user-gesture-required",
  "--mute-audio",                     // Mute local sound output (captured via virtual audio loopback if WebRTC enabled)
  
  // Anti-Bot & Anti-Detection Stealth Configuration
  "--disable-blink-features=AutomationControlled",
  "--exclude-switches=enable-automation",
  "--disable-features=IsolateOrigins,site-per-process,Translate,BackForwardCache,MediaRouter",
  '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];
```

---

## 3. Remote Input Handling & Coordinate Normalization Math

### 3.1 Normalized Unit Vector Coordinate System

To ensure that cursor interactions (clicks, hovers, drags) align accurately regardless of client device display resolution, zoom level, container aspect ratio, or window resizing, all mouse positions are represented as **normalized unit vectors**:

$$(x_{\text{norm}}, y_{\text{norm}}) \in [0, 1]^2$$

#### Client-Side Capture Formula
When a user interacts with the `<canvas>` element displaying the remote VM stream:
Let:
- $(x_{\text{event}}, y_{\text{event}})$ be the local client mouse coordinates relative to the viewport (`e.clientX`, `e.clientY`).
- $\text{rect}$ be the client bounding rectangle of the canvas element (`canvas.getBoundingClientRect()`).

$$x_{\text{norm}} = \frac{x_{\text{event}} - \text{rect.left}}{\text{rect.width}}$$

$$y_{\text{norm}} = \frac{y_{\text{event}} - \text{rect.top}}{\text{rect.height}}$$

Clamping condition to prevent out-of-bounds inputs:
$$x_{\text{norm}} = \max(0, \min(1, x_{\text{norm}}))$$
$$y_{\text{norm}} = \max(0, \min(1, y_{\text{norm}}))$$

#### Server-Side Mapping Formula
When `vm-service` receives an input event containing $(x_{\text{norm}}, y_{\text{norm}})$:
Let:
- $W_{\text{viewport}}$ be the server-side browser viewport width (e.g. 1600 or 1920).
- $H_{\text{viewport}}$ be the server-side browser viewport height (e.g. 900 or 1080).

$$X_{\text{pixel}} = \lfloor x_{\text{norm}} \times W_{\text{viewport}} \rfloor$$

$$Y_{\text{pixel}} = \lfloor y_{\text{norm}} \times H_{\text{viewport}} \rfloor$$

```typescript
// Server-side translation in vm-service
const pixelX = Math.round(xNorm * viewportWidth);
const pixelY = Math.round(yNorm * viewportHeight);
await page.mouse.move(pixelX, pixelY);
```

#### Peer Remote Cursor Rendering Formula
For non-controller clients receiving remote cursor positions $(x_{\text{norm}}, y_{\text{norm}})$ via Socket.IO:
$$\text{CSS left} = x_{\text{norm}} \times 100\%$$
$$\text{CSS top} = y_{\text{norm}} \times 100\%$$

```tsx
// Client-side overlay in virtual-browser.tsx
<div
  key={cursor.userId}
  className="absolute pointer-events-none transition-all duration-75"
  style={{
    left: `${cursor.x * 100}%`,
    top: `${cursor.y * 100}%`,
    transform: "translate(-2px, -2px)"
  }}
>
  <CursorSvg color={cursor.color} />
  <span style={{ backgroundColor: cursor.color }}>{cursor.name}</span>
</div>
```

---

### 3.2 Input Protocol Wire Payload Specification

WebSocket binary/JSON messages sent from client to `vm-service`:

| Type Header | Event Name | Payload Structure | Puppeteer Action |
| :--- | :--- | :--- | :--- |
| `0x02` | Mouse Move | `{ xNorm: number, yNorm: number }` | `page.mouse.move(xPixel, yPixel)` |
| `0x03` | Mouse Click | `{ xNorm: number, yNorm: number, button: 'left' \| 'right' \| 'middle' }` | `page.mouse.click(xPixel, yPixel, { button })` |
| `0x04` | Mouse Wheel | `{ deltaX: number, deltaY: number }` | `page.mouse.wheel({ deltaX, deltaY })` |
| `0x05` | Key Press | `{ key: string, code: string, modifiers: string[] }` | `page.keyboard.press(key)` |
| `0x06` | Text Input | `{ text: string }` | `page.keyboard.type(text)` |
| `0x07` | Navigate | `{ url: string }` | `page.goto(url, { waitUntil: 'domcontentloaded' })` |
| `0x08` | Go Back | `{}` | `page.goBack()` |
| `0x09` | Go Forward | `{}` | `page.goForward()` |
| `0x0A` | Reload | `{}` | `page.reload()` |
| `0x0B` | Script Injection| `{ script: string }` | `page.evaluate(script)` |

---

## 4. Mutex Floor Control Queue Mechanism

### 4.1 Formal State Machine & Mutex Invariants

To guarantee orderly input execution without race conditions or control conflicts:
- **Mutex Invariant**: At any instant $t$, at most **one** participant $U_{\text{controller}} \in U_{\text{room}} \cup \{\text{null}\}$ possesses control authority.
- **Input Privilege Rule**: `vm-service` **must reject** any input payload originating from a connection where $\text{userId} \neq U_{\text{controller}}$.
- **Queue Structure**: A FIFO queue $Q = [U_1, U_2, \dots, U_k]$ stores pending requestors in order of request arrival.

```
                  +-----------------------------------+
                  |         NO CONTROLLER             |
                  |     (controllerId = null)         |
                  +-----------------------------------+
                                    |
                        requestControl(User_A)
                                    v
                  +-----------------------------------+
                  |       USER_A HAS CONTROL          |
                  |     (controllerId = User_A)       |
                  +-----------------------------------+
                       /                         \
         requestControl(User_B)             releaseControl(User_A)
                      /                           \
                     v                             v
  +-----------------------------------+   +-----------------------------------+
  |       USER_A HAS CONTROL          |   |         NO CONTROLLER             |
  |     Queue: [User_B]               |   |     (or User_B promoted)        |
  +-----------------------------------+   +-----------------------------------+
```

---

### 4.2 State Transition Matrix & Protocol Commands

| Trigger Event | Current State ($U_{\text{ctrl}}, Q$) | Action & State Transition | Broadcast Message |
| :--- | :--- | :--- | :--- |
| `vm:control:request` | $U_{\text{ctrl}} = \text{null}, Q = []$ | $U_{\text{ctrl}} \leftarrow U_{\text{req}}$ | `vm:control:granted` $\rightarrow U_{\text{req}}$, `vm:control:state` |
| `vm:control:request` | $U_{\text{ctrl}} \neq \text{null}, U_{\text{req}} \notin Q$ | $Q \leftarrow Q \mathbin{\Vert} [U_{\text{req}}]$ | `vm:control:state` $\rightarrow \text{All}$ |
| `vm:control:release` | $U_{\text{ctrl}} == U_{\text{rel}}, Q = [U_{\text{next}}, \dots]$ | $U_{\text{ctrl}} \leftarrow U_{\text{next}}, Q \leftarrow Q[1:]$ | `vm:control:granted` $\rightarrow U_{\text{next}}$, `vm:control:state` |
| `vm:control:release` | $U_{\text{ctrl}} == U_{\text{rel}}, Q = []$ | $U_{\text{ctrl}} \leftarrow \text{null}$ | `vm:control:granted` $\rightarrow \text{null}$, `vm:control:state` |
| Participant Disconnect | $U_{\text{disc}} == U_{\text{ctrl}}$ | Auto-release floor, promote head of $Q$ | `vm:control:granted` $\rightarrow U_{\text{head}}$, `vm:control:state` |
| Participant Disconnect | $U_{\text{disc}} \in Q$ | Filter $U_{\text{disc}}$ out of $Q$ | `vm:control:state` $\rightarrow \text{All}$ |

---

## 5. Shared URL Navigation & Synchronization Protocol

### 5.1 URL Sanitization & Security Constraints

When a user submits a URL via the co-browsing address bar:
1. **Scheme Validation**:
   - Allowed schemes: `http://`, `https://`.
   - Denied schemes: `file://`, `chrome://`, `chrome-extension://`, `javascript:`, `data:`, `about:`.
2. **Auto-Formatting**:
   - Inputs lacking explicit scheme (e.g. `google.com`) are automatically prefixed with `https://`.
3. **Puppeteer Navigation Options**:
   ```typescript
   await page.goto(sanitizedUrl, {
     waitUntil: "domcontentloaded",
     timeout: 15000,
   });
   ```

### 5.2 Navigation Event Pushing vs Polling

Instead of clients polling the server via HTTP `GET /url` every 3000ms:
- `vm-service` registers Puppeteer event listeners on frame navigation:
  ```typescript
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      const newUrl = page.url();
      broadcastToAllClients({ type: "url_change", url: newUrl });
    }
  });
  ```

---

## 6. Comprehensive Codebase Gap & Defect Analysis

Based on an exhaustive audit of the existing codebase (`vm-service/index.ts`, `vm-service/dedicated-chrome.ts`, `vm-service/vnc-proxy.ts`, `src/components/watchparty/virtual-browser.tsx`, and `mini-services/sync-service/index.ts`), the following **6 critical architectural gaps** have been identified:

```
+-----------------------------------------------------------------------------------+
|                            EXISTING CODEBASE AUDIT MATRIX                         |
+-------------------+--------------------------------+------------------------------+
| Component         | Implementation Status          | Critical Architectural Defect|
+-------------------+--------------------------------+------------------------------+
| vm-service/       | Node/Bun + Puppeteer JPEG      | ❌ Zero floor control check.  |
| index.ts          | capture loop over WS           | Any WS client can send input.|
+-------------------+--------------------------------+------------------------------+
| virtual-browser.ts| React canvas viewer + WS input | ❌ Mouse inputs sent as absolute|
|                   | & Socket.IO cursor overlay     | pixels using client canvas   |
|                   |                                | instead of server resolution |
+-------------------+--------------------------------+------------------------------+
| sync-service/     | Socket.IO floor queue state &  | ❌ Disconnected state between|
| index.ts          | cursor coordinate relay        | sync-service and vm-service  |
+-------------------+--------------------------------+------------------------------+
```

### Detailed Gap Breakdown:

1. **CRITICAL GAP 1: Disconnected Floor Control Privilege Verification (Security & Mutex Bypass)**
   - *Observation*: In `mini-services/sync-service/index.ts` (lines 474-515), floor control state (`vmController`, `vmControlQueue`) is managed via Socket.IO events (`vm:control:request`, `vm:control:release`). However, input messages (mouse move, click, keydown) are sent directly from `virtual-browser.tsx` to `vm-service` over a separate raw WebSocket connection (`ws://localhost:3004/ws`).
   - *Defect*: `vm-service/index.ts` (lines 196-238) accepts and executes all input payloads without checking if the sender is currently authorized as `vmController` by `sync-service`. Any connected client can manually craft binary WebSocket frames to hijack inputs regardless of floor control queue state.

2. **CRITICAL GAP 2: Coordinate Mapping & Resolution Mismatch (Input Precision Loss)**
   - *Observation*: In `src/components/watchparty/virtual-browser.tsx` (lines 176-196), local mouse coordinates are calculated relative to the rendered canvas element:
     `x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width))`
     `y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height))`
     `sendMsg(2, { x, y })`
   - *Defect*: `sendMsg` sends these raw pixel coordinates to `vm-service`. But `canvas.width` and `canvas.height` change dynamically based on JPEG frame dimensions received from the server. If `vm-service` is initialized at $1920 \times 1080$ (`index.ts`) while `dedicated-chrome.ts` runs at $1600 \times 900$, or if aspect ratio scaling occurs on the client, clicks miss target UI elements because absolute coordinates are passed instead of normalized $(x_{\text{norm}}, y_{\text{norm}})$.

3. **CRITICAL GAP 3: High CPU/RAM Capture Loop & Lack of WebRTC Pipeline**
   - *Observation*: `vm-service/index.ts` (lines 82-107) runs a tight `while (capturing)` loop calling `await page.screenshot({ type: "jpeg", quality: 70 })` at 15 FPS.
   - *Defect*: `page.screenshot()` invokes Puppeteer CDP (Chrome DevTools Protocol) encoding on every frame, generating severe CPU usage and V8 garbage collection overhead (allocating 15-24 JPEG Buffer objects per second). There is no native WebRTC peer connection or H.264 hardware encoding implementation.

4. **CRITICAL GAP 4: Missing Audio Capture & Streaming**
   - *Observation*: `vm-service/index.ts` passes `--mute-audio` (line 47) and only streams JPEG image buffers.
   - *Defect*: Video or media played inside the virtual browser produces no sound for room participants.

5. **CRITICAL GAP 5: Auto-Request Control Mount Race Condition**
   - *Observation*: In `virtual-browser.tsx` (lines 149-155), an effect automatically issues `onRequestControl()` after a 1500ms timeout if no controller ID is present on mount.
   - *Defect*: When multiple participants join a room simultaneously, all client components trigger competing `onRequestControl()` timers, leading to non-deterministic queue ordering and race conditions.

6. **CRITICAL GAP 6: URL Bar Synchronization via Polling**
   - *Observation*: `virtual-browser.tsx` (lines 129-138) runs an HTTP `setInterval` polling `fetch('/url')` every 3 seconds.
   - *Defect*: High HTTP overhead and delayed URL bar updates when navigating complex SPAs or performing multi-page redirects.

---

## 7. Refactoring Architecture & Implementation Plan (Milestone 3 Guidance)

To resolve these defects during Milestone 3 implementation, the following architectural upgrades are specified:

### 1. Unified Authentication & Shared Floor Control Token
`sync-service` issues a signed short-lived session token `vmControlToken` whenever a user is granted floor control (`vm:control:granted`). `vm-service` validates this token on every incoming WebSocket input message:

```typescript
// vm-service/index.ts
ws.on("message", async (data: Buffer) => {
  const { token, type, xNorm, yNorm, key } = parseMessage(data);
  if (!verifyControlToken(token, currentActiveControllerId)) {
    return; // Reject unauthorized input frame
  }
  // Proceed to execute input
});
```

### 2. Strict Normalized Coordinate Protocol
`virtual-browser.tsx` sends strictly normalized floating-point unit vectors:
```typescript
// Client emission
const xNorm = (e.clientX - rect.left) / rect.width;
const yNorm = (e.clientY - rect.top) / rect.height;
sendMsg(MSG_MOUSE_MOVE, { xNorm, yNorm });

// Server translation
const targetX = Math.round(xNorm * VIEWPORT.width);
const targetY = Math.round(yNorm * VIEWPORT.height);
await page.mouse.move(targetX, targetY);
```

### 3. Navigation Push Events
Replace client-side HTTP polling with CDP `Page.frameNavigated` event broadcasts directly over the WebSocket frame channel.

---

*Report Compiled by Explorer Subagent (ID: teamwork_preview_explorer_m1_2)*
