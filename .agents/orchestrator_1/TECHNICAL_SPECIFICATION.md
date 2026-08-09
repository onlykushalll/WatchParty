# WatchParty Technical Architecture & Deep Research Specifications

## 1. NTP Clock Synchronization & PI Playhead Slewing Controller

### 1.1 Mathematical Model (Cristian's Algorithm)
- **Round-Trip Time (RTT)**:
  $$\delta = (t_3 - t_0) - (t_2 - t_1)$$
  where $t_0$ is client send time, $t_1$ is server receive time, $t_2$ is server response send time, $t_3$ is client receive time.
- **Clock Offset Estimation**:
  $$\bar{\theta} = \frac{(t_1 - t_0) + (t_2 - t_3)}{2}$$
- **Sliding-Window Min-RTT Filtering**:
  Given a sliding window $W$ of $N=8$ recent probes, select sample $i^*$ with minimum RTT:
  $$i^* = \arg\min_{i \in W} \delta_i, \quad \text{filtered offset } \theta_{sample} = \bar{\theta}_{i^*}$$
  Outliers with $\delta > 500\text{ms}$ are rejected.
- **Exponential Moving Average (EMA) Smoothing**:
  $$\theta_k = \alpha \cdot \theta_{sample} + (1 - \alpha) \cdot \theta_{k-1}, \quad \alpha = 0.2$$

### 1.2 Proportional-Integral (PI) Slewing Rate Controller
- **Target Playhead Position**:
  $$t_{expected}(t_{client}) = t_{server\_base} + (t_{client} + \theta_k - t_{sync\_received}) \cdot \text{rate}$$
- **Playhead Error**:
  $$e_k = t_{expected} - t_{actual}$$
- **Controller Action**:
  - Direct seek if $|e_k| > 1.0\text{s}$ or on initial room join.
  - No adjustment if $|e_k| \le 0.1\text{s}$ (100ms deadband).
  - Smooth rate slewing if $0.1\text{s} < |e_k| \le 1.0\text{s}$:
    $$u_k = 1.0 + K_p \cdot e_k + K_i \cdot I_k$$
    $$I_k = I_{k-1} + e_k \cdot \Delta t$$
    where $K_p = 0.05, K_i = 0.005$.
- **Slewing Rate Bounds & Anti-Windup Guard**:
  - Rate $u_k$ is strictly clamped: $u_k \in [0.95, 1.05]$.
  - Integral anti-windup: $I_k$ is frozen when rate saturates at bounds.
- **Provider Adapters**:
  - YouTube iFrame API: `player.setPlaybackRate(u_k)`.
  - HLS.js / HTML5 Video: `videoElement.playbackRate = u_k`.

---

## 2. Interactive Virtual Desktop (VM) Co-Browsing Architecture

### 2.1 Headless Chromium Container & Streaming
- **Browser Execution**: Puppeteer / Playwright managing headless Chromium in containerized environment.
- **Streaming Pipeline**: WebSocket binary MJPEG frame stream or WebRTC canvas capture (`captureStream(30)`).
- **Stealth & Resource Flags**:
  - `--disable-dev-shm-usage`, `--js-flags="--max-old-space-size=512"`, `--headless=new`, `--no-sandbox`.

### 2.2 Remote Input Vector Normalization
- **Client Capture**:
  $$(x_{norm}, y_{norm}) = \left(\frac{x_{event}}{width_{container}}, \frac{y_{event}}{height_{container}}\right) \in [0, 1]^2$$
- **Server Viewport Projection**:
  $$X_{pixel} = \lfloor x_{norm} \times W_{viewport} \rfloor, \quad Y_{pixel} = \lfloor y_{norm} \times H_{viewport} \rfloor$$
- **Cursor Overlay**: Broadcast active controller cursor position as percentages `(xNorm * 100%, yNorm * 100%)` for smooth CSS placement across arbitrary screen dimensions.

### 2.3 Mutex Floor Control Queue State Machine
- **States**: `IDLE` (no owner), `OCCUPIED` (active owner), `QUEUED` (waitlist).
- **Messages**:
  - `floor_request`: Appends user to mutex queue.
  - `floor_grant`: Assigned to queue head; grants input permission.
  - `floor_release`: Relies control; auto-grants next in queue.
  - `floor_revoke`: Host/admin force revokes control.
- **Single-Writer Security Invariant**: Server ignores input events from socket IDs that do not hold the active floor lock.

### 2.4 Address Bar & Navigation
- URL input sanitization (`http://` / `https://` validation).
- CDP frame navigation: `page.goto(url, { waitUntil: 'domcontentloaded' })`.

---

## 3. Cloud Containerization & Deployment Setup (Render.com)

### 3.1 Low-RAM Memory Tuning
- Render 512MB RAM free tier allocation budget:
  - Base Node.js process: ~80MB
  - Chromium browser main process: ~120MB
  - Chromium renderer process: ~200MB (capped via `--renderer-process-limit=2` and `--js-flags="--max-old-space-size=512"`)
  - Shared memory `/dev/shm` bypassed via `--disable-dev-shm-usage` (uses `/tmp` disk swap).
  - Peak footprint target: ~450MB (< 512MB hard limit).

### 3.2 Dynamic Environment Config & Paths
- `CHROME_PATH`: Default to `/usr/bin/chromium` on Linux, dynamic fallback via `process.env.CHROME_PATH`.
- `HEADLESS`: Boolean string (`true`/`false`), dynamic fallback via `process.env.HEADLESS !== "false"`.
- Environment Variable Topology:
  - `PORT`: Public application HTTP port (default `3000`).
  - `CORS_ORIGIN`: Allowed origins for WebSocket/HTTP.
  - `PUBLIC_URL`: Canonical public domain.
  - `DATABASE_URL`: Prisma connection string (SQLite file path or PostgreSQL URI).

### 3.3 Multi-Service Docker & Render Blueprint
- Multi-stage Dockerfile compiling Next.js app, node backend, and installing Chromium dependencies (`apt-get install -y chromium ffmpeg`).
- Declarative `render.yaml` defining Next.js web service and background VM worker service.
