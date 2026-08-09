# M5 Docker Container & Render.com Blueprint Analysis Report

## 1. Observation

### 1.1 Root Dockerfile Inspection
- **File**: `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/Dockerfile`
- **Structure**: 3-stage multi-stage build utilizing `node:20-alpine`:
  - **Stage 1 (`deps`)**: Copies `package.json`, `package-lock.json*`, executes `npm ci --no-audit --no-fund || npm install --no-audit --no-fund`.
  - **Stage 2 (`builder`)**: Copies `node_modules`, project source, executes `npx prisma generate` and `npm run build`.
  - **Stage 3 (`runner`)**: Base `node:20-alpine`, sets `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`, creates `nextjs` system user, copies `.next/standalone`, `.next/static`, `public`, `prisma`, `@prisma`, exposes port `3000`, sets `PORT=3000`, `HOSTNAME="0.0.0.0"`, CMD `["node", "server.js"]`.
- **Finding**: The root `Dockerfile` cleanly handles the Next.js standalone web frontend build. It does not include Chromium or audio/video encoding dependencies, which is appropriate since Next.js operates as a standalone web application.

### 1.2 `vm-service/Dockerfile` Inspection
- **File**: `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/vm-service/Dockerfile`
- **Finding**: **MISSING**. There is currently no `Dockerfile` inside the `vm-service` directory.
- **Current Workaround**: `docker-compose.yml` uses a generic `node:20-slim` base image and runs an inline bash command (`apt-get update && apt-get install -y chromium && npm install && node index.js`) at container runtime. This introduces startup latency, non-reproducible container builds, and prevents Render.com from launching `vm-service` as an isolated container service.

### 1.3 Chromium Low-RAM Flags Verification
- **Primary Service (`vm-service/index.ts`, lines 255-269)**:
  ```ts
  args: [
    `--window-size=${WIDTH},${HEIGHT}`,
    "--no-sandbox",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    "--mute-audio",
    "--autoplay-policy=no-user-gesture-required",
    "--renderer-process-limit=2",
    '--js-flags="--max-old-space-size=512"',
    "--disable-blink-features=AutomationControlled",
    "--exclude-switches=enable-automation",
    "--disable-features=IsolateOrigins,site-per-process",
    "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
  ]
  ```
  - `vm-service/index.ts` contains all four required low-RAM flags (`--disable-dev-shm-usage`, `--js-flags="--max-old-space-size=512"`, `--no-sandbox`, `--disable-gpu`).
- **Dedicated Service (`vm-service/dedicated-chrome.ts`, lines 79-105)**:
  ```ts
  const userDataDir = "C:\\Users\\Default.L-HCG-9FVVGS3\\vm-chrome-profile";
  args: [
    ...
    "--no-sandbox",
    "--renderer-process-limit=2",
    "--js-flags=--max-old-space-size=512",
    ...
  ]
  ```
  - **Deficiency 1**: `vm-service/dedicated-chrome.ts` is **MISSING** `--disable-dev-shm-usage` and `--disable-gpu`.
  - **Deficiency 2**: Line 73 uses a hardcoded Windows file system path (`C:\\Users\\Default.L-HCG-9FVVGS3\\vm-chrome-profile`), which will fail when executed inside a Linux Docker / Render container environment.

### 1.4 Docker Compose Configuration (`docker-compose.yml`)
- **File**: `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/docker-compose.yml`
- **Services Defined**:
  - `app`: Port `3000:3000`, env `DATABASE_URL=file:./db/watchparty.db`, volume `app_db:/app/db`.
  - `sync`: `oven/bun:latest`, port `3003:3003`, mounts `./mini-services/sync-service:/app`, runs `bun run dev`.
  - `vm`: `node:20-slim`, port `3004:3004`, mounts `./vm-service:/app`, runs inline `apt-get` bash command.
- **Deficiencies**:
  - `vm` service does not use a dedicated Dockerfile build context (`build: ./vm-service`).
  - `sync` service does not use a dedicated Dockerfile build context (`build: ./mini-services/sync-service`).
  - Lacks explicit environment variable wiring (`NEXT_PUBLIC_SYNC_SERVICE_URL`, `NEXT_PUBLIC_VM_SERVICE_URL`, `CORS_ORIGIN`, `PUBLIC_URL`).
  - Lacks container healthchecks (`healthcheck`) and dependency conditions (`depends_on`).

### 1.5 Render.com Blueprint Configuration (`render.yaml`)
- **File**: `c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty/render.yaml`
- **Finding**: **MISSING**. No `render.yaml` file exists in the repository.

---

## 2. Logic Chain

1. **Root Dockerfile & Service Modularization**:
   - The root `Dockerfile` accurately builds the Next.js standalone web frontend.
   - However, the overall system architecture consists of 3 distinct services: Next.js Web App (`app`), Socket.IO Sync Server (`sync`), and Chromium Virtual Desktop Server (`vm`).
   - Requiring runtime `apt-get install chromium` inside `docker-compose.yml` violates container best practices and breaks cloud platforms like Render.com.
   - Therefore, creating dedicated Dockerfiles for `vm-service/Dockerfile` and `mini-services/sync-service/Dockerfile` is required for reproducible builds.

2. **Low-RAM Chromium Container Stability**:
   - In Docker containers with restricted memory (e.g. Render's 512MB free tier), Chromium's default shared memory `/dev/shm` buffer (64MB) causes renderer process crashes (`SIGBUS`).
   - `--disable-dev-shm-usage` instructs Chromium to utilize `/tmp` shared memory disk swap instead.
   - `--js-flags="--max-old-space-size=512"` limits V8 heap memory usage, preventing container OOM kills.
   - `--no-sandbox` allows headless Chrome to execute in unprivileged container environments.
   - `--disable-gpu` avoids attempting to initialize hardware GPU acceleration inside headless Linux containers.
   - `vm-service/index.ts` has these flags, but `vm-service/dedicated-chrome.ts` lacks `--disable-dev-shm-usage` and `--disable-gpu`, and has a hardcoded Windows path (`userDataDir`) that will break Linux Docker containers. Fixing `dedicated-chrome.ts` ensures container stability across all browser invocation paths.

3. **Docker Compose & Render Blueprint Optimization**:
   - Creating `render.yaml` with explicit service declarations (`watchparty-web`, `watchparty-vm`, `watchparty-sync`) allows automated zero-config deployment on Render.com.
   - Updating `docker-compose.yml` to build from `Dockerfile`, `vm-service/Dockerfile`, and `mini-services/sync-service/Dockerfile` ensures full multi-container deployment parity between local development and cloud production.

---

## 3. Caveats

- **Free Tier Sleep Behavior**: Render's free tier web services spin down after 15 minutes of inactivity. Active WebSocket connections from clients will maintain active sessions, but cold starts may take ~30 seconds.
- **SQLite Persistence**: Docker compose uses persistent volume `app_db:/app/db`. On Render.com, disk persistence requires Render Disk or PostgreSQL (`DATABASE_URL`). The blueprint will support both file-based SQLite and PostgreSQL URIs via `DATABASE_URL`.
- **Host Platform Differences**: Local testing was conducted on Windows 11. Linux container paths (`/usr/bin/chromium` and `/tmp`) must be handled dynamically via environment variables (`CHROME_PATH`, `HEADLESS`).

---

## 4. Conclusion & Recommended M5 Implementation Plan

To complete Milestone M5, the following actionable implementation plan is recommended:

1. **Create `vm-service/Dockerfile`**:
   - Base image: `node:20-slim`.
   - Install dependencies: `apt-get update && apt-get install -y chromium ffmpeg fonts-liberation libasound2 libatk-bridge2.0-0 libgtk-3-0 libnss3 libxss1 xdg-utils --no-install-recommends`.
   - Set environment variables: `CHROME_PATH=/usr/bin/chromium`, `HEADLESS=true`, `PORT=3004`.
   - Copy `package.json`, `package-lock.json`, run `npm ci`, copy source code, CMD `["node", "index.js"]` (or `bun index.ts`).

2. **Create `mini-services/sync-service/Dockerfile`**:
   - Base image: `oven/bun:latest` or `node:20-alpine`.
   - Install dependencies and run `bun index.ts` (or `node index.js`).
   - Expose port `3003`.

3. **Update Low-RAM Flags & Cross-Platform Paths in `vm-service/dedicated-chrome.ts`**:
   - Add `--disable-dev-shm-usage` and `--disable-gpu` to browser launch args.
   - Replace hardcoded Windows `userDataDir` path (`C:\\Users\\Default...`) with a dynamic OS temp path (`path.join(os.tmpdir(), "vm-chrome-profile")`).

4. **Update `docker-compose.yml`**:
   - Replace inline `command` and `image: node:20-slim` in `vm` service with `build: ./vm-service`.
   - Update `sync` service to `build: ./mini-services/sync-service`.
   - Wire explicit environment variables (`CORS_ORIGIN=*`, `PUBLIC_URL=http://localhost:3000`, `NEXT_PUBLIC_SYNC_SERVICE_URL=http://localhost:3003`, `NEXT_PUBLIC_VM_SERVICE_URL=ws://localhost:3004`).
   - Add service healthchecks and `depends_on`.

5. **Create Render.com Blueprint (`render.yaml`)**:
   - Define multi-service infrastructure:
     - `watchparty-web` (Next.js web service, port 3000)
     - `watchparty-vm` (Virtual desktop service, port 3004)
     - `watchparty-sync` (Socket.IO sync service, port 3003)
   - Configure 512MB RAM free tier limits and environment variable bindings (`PORT`, `CORS_ORIGIN`, `PUBLIC_URL`, `DATABASE_URL`, `CHROME_PATH`, `HEADLESS`).

---

## 5. Verification Method

1. **Unit Test Suite**:
   ```bash
   bun test
   ```
   Verify all 74 existing unit tests in `src/__tests__/` pass with 0 failures.

2. **Next.js Production Build**:
   ```bash
   bun run build
   ```
   Verify Next.js production build succeeds with 0 TypeScript/ESLint errors and produces `.next/standalone`.

3. **YAML Schema Validation**:
   - Inspect `render.yaml` and `docker-compose.yml` for correct syntax and structure.
