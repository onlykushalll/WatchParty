# WatchParty Technical Specification: Cloud Containerization & Render.com Infrastructure Strategy (Milestone 1 / Requirement R1 & R5)

**Agent ID**: `teamwork_preview_spec_miner_m1_3`  
**Date**: 2026-08-09  
**Status**: Completed Technical Specification Report  

---

## 1. Executive Summary & Infrastructure Overview

WatchParty requires a multi-service architecture comprising:
1. **Next.js Web Application** (`Port 3000`): Full-stack web interface, API routes, user auth, room management, and iframe proxy.
2. **Authoritative State Sync Engine** (`mini-services/sync-service`, `Port 3003`): Real-time Socket.IO server handling NTP clock synchronization (Cristian's algorithm), playback state convergence, sequence validation, and room state distribution.
3. **Virtual Desktop (VM) Browser Service** (`vm-service`, `Port 3004`): Express / WebSocket server controlling a containerized headless Chromium instance via `puppeteer-core`, streaming MJPEG/WebSocket canvas frames (15–24 FPS) and relaying remote mouse/keyboard input events.

This specification details the cloud containerization strategy for deploying WatchParty on resource-constrained cloud providers such as **Render.com** (Starter tier: 512MB RAM, 0.5 CPU cores) or standard Docker container environments.

---

## 2. Low-RAM Chromium Containerization & Memory Tuning

### 2.1 Flag Breakdown & Architectural Rationale

When running Chromium inside Docker on cloud platforms (e.g. Render Free/Starter with 512MB RAM), default Chromium execution parameters will crash the container due to out-of-memory (OOM) kills or `/dev/shm` buffer exhaustion. The table below details the mandatory Chromium flags, their low-level mechanism, and why each is required:

| Chromium Flag | Low-Level Mechanism | Why Required in Docker / Render (512MB RAM) |
|---|---|---|
| `--disable-dev-shm-usage` | Forces Chromium to use `/tmp` file system instead of shared memory buffer `/dev/shm`. | Docker containers default to 64MB for `/dev/shm`. Complex DOM rendering quickly exceeds 64MB, causing Chromium renderer process SIGBUS crashes. |
| `--js-flags="--max-old-space-size=512"` | Passes V8 engine flag setting max memory limit for old generation heap object pool to 512MB (or lower, e.g. 256MB/384MB for strict safety). | Prevents V8 garbage collector from expanding heap memory uncontrollably, ensuring process total footprint stays within cgroup memory limits. |
| `--no-sandbox` | Disables SUID sandbox security layer. | Unprivileged Docker containers (e.g. Render, Alpine, Debian non-root) lack `CLONE_NEWUSER` / `CAP_SYS_ADMIN` capabilities; sandbox initialization fails. |
| `--headless=new` | Uses modern Chrome headless architecture (v112+) using full Blink/V8 without X11 server dependency. | Obsoletes legacy headless mode; provides exact rendering equality with GUI Chrome while avoiding Xvfb display server overhead (~100MB RAM saved). |
| `--disable-gpu` | Disables hardware GPU graphics acceleration and WebGL hardware pipelines. | Cloud containers lack GPU hardware; attempting GPU initialization loads heavy software fallback drivers that consume extra memory (~80MB RAM saved). |
| `--disable-software-rasterizer` | Disables software GL rasterizer fallback (libosmesa/swiftshader). | Avoids loading heavy CPU-based 3D graphics rasterization libraries when rendering normal HTML5 pages. |
| `--mute-audio` | Mutes audio output in Chromium renderer. | Prevents ALSA/PulseAudio driver initializations and audio buffer allocations. Audio is handled natively or muted in virtual desktop streaming mode. |
| `--renderer-process-limit=2` | Limits total concurrent renderer child processes spawned by browser process to 2. | Prevents Chromium from spawning a new process per tab, iframe, or extension, keeping child process count strictly bounded. |
| `--memory-pressure-off` | Disables automatic tab discarding under system memory pressure notifications. | Prevents Chromium from killing the active streaming tab during high-framerate screenshot loops while V8 heap cap controls memory bounds. |
| `--disable-background-timer-throttling` | Keeps timers running at 100% frequency even if browser window is not focused. | Guarantees consistent 60Hz DOM updates and smooth video playback inside the virtual browser canvas. |
| `--disable-backgrounding-occluded-windows` | Prevents Chromium from throttling tab rendering when occluded. | Ensures screenshot capture loop receives newly painted frames without throttling delays. |
| `--disable-blink-features=AutomationControlled` | Removes `window.navigator.webdriver` property and CDP markers. | Stealth flag preventing Cloudflare, Akamai, and anti-bot systems from blocking automated virtual browsing. |
| `--exclude-switches=enable-automation` | Removes default Chrome infobar "Chrome is being controlled by automated test software". | Preserves full 16:9 viewable browser real estate without layout shifts. |

### 2.2 Memory Allocation Budget (Render 512MB RAM Tier)

To ensure high availability without triggering Linux OOM killer (`OOM-kill score 1000`), the process memory budget for the `vm-service` container is structured as follows:

```
Total Available System RAM: 512 MB
┌─────────────────────────────────────────────────────────┐
│ OS Kernel & Base Linux Overhead (Debian/Alpine): ~50 MB  │
├─────────────────────────────────────────────────────────┤
│ Node.js Runtime (vm-service index.ts + WS):      ~70 MB  │
├─────────────────────────────────────────────────────────┤
│ Chromium Main Process:                           ~110 MB │
├─────────────────────────────────────────────────────────┤
│ Chromium Renderer Process (V8 max-old-space=256):~200 MB │
├─────────────────────────────────────────────────────────┤
│ Buffer Reserve / Safety Headroom:                ~62 MB  │
└─────────────────────────────────────────────────────────┘
Total Peak Memory Footprint: ~450 MB (< 512 MB limit)
```

---

## 3. Multi-Service TCP & WebSocket Proxy Architecture

WatchParty relies on 3 distinct network services. Routing HTTP, WebSocket (WS), WebRTC, and Socket.IO connections through cloud single-port or multi-port environments requires clear proxy topology.

### 3.1 Network Topology & Port Assignment

| Service Name | Working Directory | Runtime | Internal Port | Protocol / Traffic Types |
|---|---|---|---|---|
| **Next.js Main App** | Root (`/`) | Node.js (Standalone) | `3000` | HTTP GET/POST, Next.js Server Components, API routes (`/api/proxy`, `/api/rooms`) |
| **Sync Service** | `mini-services/sync-service` | Bun / Node.js | `3003` | Socket.IO Engine.IO protocol (HTTP long-polling upgrade to WebSocket) |
| **VM Browser Service** | `vm-service` | Node.js / Bun | `3004` | HTTP (`/health`, `/stream`, `/url`, `/navigate`), WebSocket (`/ws` for frame stream & input control) |

### 3.2 Ingress & Reverse Proxy Topology Options

#### Option A: Render Multi-Service Blueprint (`render.yaml`)
In a native Render environment with paid or separate web services:
- Service 1: `watchparty-web` (`https://watchparty.onrender.com`) -> Port 3000 (Next.js)
- Service 2: `watchparty-sync` (`https://watchparty-sync.onrender.com`) -> Port 3003 (Socket.IO)
- Service 3: `watchparty-vm` (`https://watchparty-vm.onrender.com`) -> Port 3004 (Puppeteer VM)

Client components connect directly to `NEXT_PUBLIC_SYNC_URL` and `NEXT_PUBLIC_VM_URL`.

#### Option B: Single-Container Unified Reverse Proxy (Render Starter / Free Tier)
To run all 3 services inside a SINGLE Docker container on Render (which exposes only a single dynamic `$PORT`, typically 10000):

```
                       Client Browser
                             │
               HTTPS / WSS   │ (Port 443 / $PORT)
                             ▼
              ┌─────────────────────────────┐
              │    Unified Nginx / Caddy    │
              │     or Node.js Gateway      │
              └──────────────┬──────────────┘
                             │
     ┌───────────────────────┼───────────────────────┐
     │ /                     │ /socket.io/           │ /vm-api/ & /vm-ws/
     ▼                       ▼                       ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Next.js App │     │ Sync Service │     │  VM Service  │
│ (Port 3000)  │     │ (Port 3003)  │     │ (Port 3004)  │
└──────────────┘     └──────────────┘     └──────────────┘
```

**Routing Rules for Single-Container Gateway**:
1. Path `/socket.io/*` -> Proxy pass to `http://127.0.0.1:3003` with `Upgrade: $http_upgrade` and `Connection: "upgrade"`.
2. Path `/vm-ws` or `/vm/*` -> Strip prefix `/vm`, Proxy pass to `http://127.0.0.1:3004` with WebSocket headers.
3. Default `/` -> Proxy pass to `http://127.0.0.1:3000`.

---

## 4. Environment Variable Topology

The table below defines the complete environment variable schema required across frontend, sync service, vm-service, and cloud container environments:

| Variable Name | Scope | Default Value | Description / Purpose |
|---|---|---|---|
| `PORT` | System / Cloud | `3000` (App), `3003` (Sync), `3004` (VM) | Port assigned by host OS or Render runtime ($PORT). |
| `HOSTNAME` | App / Docker | `0.0.0.0` | IP binding address for container network interface. |
| `NODE_ENV` | Global | `production` | Node execution mode (`production` enables standalone optimizations). |
| `CORS_ORIGIN` | Sync & VM Services | `*` or `https://watchparty.onrender.com` | Allowed CORS origins for WebSocket handshakes and HTTP requests. |
| `PUBLIC_URL` | Global Backend | `http://localhost:3000` | Canonical public base URL of the deployment. |
| `NEXT_PUBLIC_APP_URL` | Frontend Client | `http://localhost:3000` | Frontend public URL accessed by client browser. |
| `NEXT_PUBLIC_SYNC_URL` | Frontend Client | `http://localhost:3003` | Socket.IO server URL for clock sync and room state. |
| `NEXT_PUBLIC_VM_URL` | Frontend Client | `http://localhost:3004` | Virtual Desktop service HTTP/WS base URL. |
| `DATABASE_URL` | Next.js App | `file:./db/watchparty.db` | Prisma ORM database connection string (SQLite file or PostgreSQL URI). |
| `CHROME_PATH` | VM Service | `/usr/bin/chromium` | Absolute binary path to Chromium inside Linux Docker container. |
| `HEADLESS` | VM Service | `true` | Controls whether Puppeteer launches in headless mode (`true` for cloud). |
| `MCPILOT_BASE_URL` | Next.js API | `https://kushalneedsmcp.online` | Optional external browser automation base endpoint. |
| `MCPILOT_TOKEN` | Next.js API | `mcpilot-secret-2024` | Bearer token for external MCPilot tool integration. |

---

## 5. Docker Multi-Stage Build & Render Configuration Setup

### 5.1 Analysis of Existing Docker Infrastructure

Existing root `Dockerfile`:
- **Stage 1 (`deps`)**: Uses `node:20-alpine`, runs `npm ci`.
- **Stage 2 (`builder`)**: Runs `npx prisma generate` and `npm run build`. Builds Next.js standalone server in `.next/standalone`.
- **Stage 3 (`runner`)**: Copies `.next/standalone`, static files, Prisma engine binaries. Exposes port 3000, runs `node server.js` as user `nextjs`.

Existing `docker-compose.yml`:
- Defines 3 services (`app`, `sync`, `vm`).
- Mounts local directory volumes.
- Installs Chromium at container launch inside `vm` service via `apt-get install -y chromium`.

### 5.2 Production Docker Blueprint for VM Service (`vm-service/Dockerfile`)

Because `vm-service` requires a Linux environment with Chromium and its system dependencies installed (e.g. `nss`, `freetype`, `harfbuzz`, `ca-certificates`, `ttf-freefont`), it requires a dedicated lightweight multi-stage Dockerfile:

```dockerfile
# ─── VM Service Dockerfile ───
FROM node:20-slim AS base

# Install Chromium and required runtime fonts/libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-freefont-ttf \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --only=production

COPY . .

ENV NODE_ENV=production
ENV CHROME_PATH=/usr/bin/chromium
ENV HEADLESS=true
ENV PORT=3004

EXPOSE 3004

CMD ["node", "--import", "tsx", "index.ts"] # or bun index.ts
```

### 5.3 Render Infrastructure Blueprint (`render.yaml`)

For automated deployment on Render.com, a `render.yaml` specification defines the multi-service pipeline:

```yaml
services:
  # Service 1: Next.js Frontend
  - type: web
    name: watchparty-web
    env: docker
    dockerfilePath: Dockerfile
    plan: starter
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        value: file:/app/db/watchparty.db
      - key: NEXT_PUBLIC_SYNC_URL
        fromService:
          type: web
          name: watchparty-sync
          property: host
      - key: NEXT_PUBLIC_VM_URL
        fromService:
          type: web
          name: watchparty-vm
          property: host

  # Service 2: Socket.IO Sync Engine
  - type: web
    name: watchparty-sync
    env: docker
    dockerfilePath: mini-services/sync-service/Dockerfile
    plan: starter
    envVars:
      - key: PORT
        value: 3003
      - key: CORS_ORIGIN
        value: "*"

  # Service 3: Virtual Browser Service
  - type: web
    name: watchparty-vm
    env: docker
    dockerfilePath: vm-service/Dockerfile
    plan: starter
    envVars:
      - key: PORT
        value: 3004
      - key: CHROME_PATH
        value: /usr/bin/chromium
      - key: HEADLESS
        value: "true"
```

---

## 6. Codebase Exploration & Implementation Gap Analysis

During probing of existing codebase files (`vm-service/index.ts`, `vm-service/dedicated-chrome.ts`, `docker-compose.yml`, `package.json`, `next.config.ts`), the following **critical implementation gaps** were identified:

1. **Hardcoded Windows Binary Paths**:
   - `vm-service/index.ts` (Line 20): `const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";`
   - `vm-service/dedicated-chrome.ts` (Line 22 & Line 41): Windows user data directory `C:\Users\Default.L-HCG-9FVVGS3\vm-chrome-profile`.
   - **Impact**: Will immediately crash on Linux containers/Render with `ENOENT` / `Failed to launch Chrome`.
   - **Fix Requirement**: Fallback dynamically to `process.env.CHROME_PATH || "/usr/bin/chromium"` and OS temp directory `/tmp/vm-chrome-profile`.

2. **Headless Execution Conflict in Cloud Containers**:
   - `vm-service/index.ts` (Line 40) and `dedicated-chrome.ts` (Line 45): Hardcoded `headless: false`.
   - **Impact**: Linux cloud containers operate without an active X11 display server. Launching Puppeteer with `headless: false` in Docker will throw `Error: Failed to launch the browser process! Could not connect to display`.
   - **Fix Requirement**: Configure `headless: process.env.HEADLESS === "true" ? "new" : false` and add low-RAM headless flags (`--headless=new`).

3. **Database Ephemerality on Cloud Storage**:
   - `.env` & `docker-compose.yml`: `DATABASE_URL=file:./db/watchparty.db`.
   - **Impact**: Render Web Services feature ephemeral disks; container restarts will wipe rooms, chat history, and user sessions.
   - **Fix Requirement**: Document persistent disk mounting or PostgreSQL URI migration for production deployment.

---

## 7. Features Discovered

```
## Features Discovered
| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Infrastructure | Low-RAM Chromium Memory Tuning | Container flags limiting V8 memory, disabling dev-shm, and restricting render processes for 512MB RAM constraints | CLI flags (`--disable-dev-shm-usage`, `--js-flags="--max-old-space-size=512"`, `--headless=new`) | Stable <450MB footprint | Chrome process exit / SIGKILL if unconfigured | Probing `vm-service/index.ts` & `dedicated-chrome.ts` |
| 2 | Networking | Multi-Service WS & HTTP Proxy | Routing matrix between Next.js (3000), Socket.IO Sync (3003), and Puppeteer VM (3004) | Ingress requests on ports 3000/3003/3004 or proxy paths `/socket.io/`, `/ws` | Routed HTTP/WS streams | 502 Bad Gateway / Connection Refused | Probing `docker-compose.yml` & `src/app/api/proxy/route.ts` |
| 3 | Environment | Env Variable Topology | Centralized topology for CORS, internal binding ports, dynamic external public URLs, and Chrome binary paths | `.env`, `render.yaml` environment variables | Configured service runtimes | Missing config fallback to defaults | Probing `.env`, `Dockerfile`, `next.config.ts` |
| 4 | Containerization | Multi-Stage Next.js Docker Build | 3-stage Docker build optimizing Next.js standalone bundle size | `package.json`, `next.config.ts` (`output: "standalone"`) | Lightweight runtime container | Build failure on missing Prisma engine | Probing `Dockerfile` |
| 5 | Infrastructure | Render Blueprint Deployment | Declarative `render.yaml` specification for 3-tier container deployment on Render cloud | `render.yaml` configuration schema | Provisioned Render Web Services | Cloud build error on missing dependencies | Probing requirements §R1/R5 & `PROJECT.md` |
| 6 | VM Streaming | Dual Streaming Endpoints | Support for both WebSocket binary frame streaming (`/ws`) and fallback MJPEG HTTP streaming (`/stream`) | HTTP GET `/stream` or WS connection to `/ws` | JPEG image frames / binary buffers | Client disconnect fallback to polling | Probing `vm-service/index.ts` |
| 7 | Security | Anti-Bot Stealth Automation | Suppression of `navigator.webdriver` and automation infobars to allow browsing protected media sites | Puppeteer args (`--disable-blink-features=AutomationControlled`, page evaluate overrides) | Clean browser execution | Blocked by Cloudflare if missing | Probing `vm-service/index.ts` |
```

---

## 8. Edge Cases

```
## Edge Cases
| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | Low-RAM Chromium | High resolution 1920x1080 canvas screenshot loop at 24 FPS without `--disable-dev-shm-usage` | Docker `/dev/shm` 64MB buffer exhausts within seconds; Chrome renderer process crashes with SIGBUS error. |
| 2 | VM Browser Service | Running in Linux Docker container with `headless: false` | Fails immediately on browser launch with `Error: Could not connect to display :0` due to missing X11 display server. |
| 3 | Environment Topology | Client connects to VM service using `localhost:3004` when deployed on Render | Connection fails; client-side JavaScript must resolve dynamic `NEXT_PUBLIC_VM_URL` pointing to Render public hostname. |
| 4 | Multi-Service Proxy | Socket.IO client connects to Next.js port 3000 without proxying `/socket.io/` to port 3003 | Connection timeout / 404 Not Found; Socket.IO handshake fails. |
| 5 | Prisma DB Persistence | SQLite file database stored inside container filesystem on Render without persistent disk volume | Data is reset on every container redeploy or automatic restart. |
```
