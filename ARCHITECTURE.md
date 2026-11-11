# WatchParty — System Architecture & Technical Due Diligence

## 1. High-Level Topology

WatchParty separates media playback, real-time room synchronization, WebRTC peer communication, and sandboxed virtual browsing into three decoupled services backed by Prisma/SQLite.

```mermaid
flowchart TB
    subgraph Client ["Client Runtime (Browser + MV3 Extension)"]
        Player["UniversalPlayer<br/>YouTube / HLS / MP4 / WebTorrent / CineVo"]
        Clock["ClockSyncEstimator<br/>Cristian NTP + EMA (alpha=0.2)"]
        PI["PISlewingController<br/>Deadband <= 100ms | Slew 0.95x-1.05x | Hard Seek > 1.0s"]
        Canvas["Remote Browser Canvas + Input Normalizer"]
        RTC["CallsPanel (WebRTC Mesh + PTT + Privacy Blur/Blackout)"]
    end

    subgraph WebApp ["Next.js 16 App (:3000)"]
        RoomsAPI["/api/rooms (Prisma CRUD)"]
        ProxyAPI["/api/proxy (SSRF-guarded X-Frame-Options Stripper)"]
    end

    subgraph SyncService ["Socket.IO Sync Service (:3003)"]
        RoomState["Authoritative Room State + Monotonic seq"]
        BufWait["Buffer-Aware Group Wait + RTT Padding"]
        ChatQueue["Chat, Reactions, Subtitle Offsets, Shared Queue"]
    end

    subgraph VMService ["Virtual Browser Service (:3004)"]
        Floor["FloorControlManager Mutex (FIFO Single-Writer)"]
        CDP["Puppeteer / CDP Screencast + Video URL Extractor"]
    end

    Clock --> PI --> Player
    Client <-->|"HTTP / REST"| WebApp
    Client <-->|"Socket.IO"| SyncService
    Client <-->|"Binary WS Frames"| VMService
    WebApp --> DB[("SQLite via Prisma")]
```

## 2. Core Engineering Subsystems

1. **Synchronization Engine (`src/lib/sync/`)**
   - **`ClockSyncEstimator`**: Samples server RTT probes, rejects >500ms jitter outliers, keeps a sliding window of minimum-RTT samples, and applies Exponential Moving Average (`alpha = 0.2`) clock offset correction.
   - **`PISlewingController`**: Deadband zone (`<= 100ms`), bounded PI playback rate adjustment (`[0.95x, 1.05x]`) with anti-windup integral freezing, and automatic hard seek (`> 1.0s`).
   - **Monotonic Sequence Guarding**: Server-stamped timestamps (`lastChangedAt`) + strictly increasing `seq` counters eliminate out-of-order state echoes.

2. **Virtual Browser & Floor Control (`vm-service/`)**
   - **`FloorControlManager`**: Server-enforced single-writer mutex with FIFO request queue and automatic host promotion on disconnect.
   - **CDP Screencast & Extractor (`cdp-browser.ts`, `video-extractor.ts`)**: Captures JPEG frames directly from Chromium DevTools Protocol and extracts `.m3u8`/`.mp4` streams when direct extraction is preferred. Configurable via `CHROME_PATH` and `CHROME_PROFILE_DIR`.

3. **Security & SSRF Protection (`src/app/api/proxy/route.ts`)**
   - Explicit hostname blocklist (`localhost`, loopback, RFC1918 private ranges, link-local metadata), protocol allowlist (`http:` / `https:`), redirect cap (5 hops), and 8 MB payload limit.
