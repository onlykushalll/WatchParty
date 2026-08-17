# Project: WatchParty — Multi-Agent Debugging & Adversarial Verification

## Architecture
WatchParty is a real-time collaborative watch party platform consisting of:
1. **Sync Microservice (`mini-services/sync-service/index.ts`)**: Socket.IO server handling room state, sequence numbering, Cristian's clock sync timestamps, group buffer synchronization, command relays (`CMD:play/pause/seek/ts`), and WebRTC/VM signaling.
2. **VM Microservice (`vm-service/`)**: WebSocket & HTTP server providing remote Chromium co-browsing via CDP/VNC screencasting, floor control mutex, cursor mapping, and URL security filtering.
3. **Client Frontend (Next.js 16.3 / React 19 / Bun)**:
   - Synchronized player stage supporting YouTube, HLS, native MP4/WebM, Local File Sync, VirtualBrowser, WebRTC StreamPlayer, TorrentPlayer, and CineVo extension bridge.
   - SidePanel containing WhatsApp-styled Chat, Queue playlist, and Calls with privacy modes.
   - Light theme as default styling.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Clock Sync Estimator | Cristian's NTP algorithm with EMA smoothing (alpha=0.2), RTT outlier rejection (>500ms), sliding window (k=8) | M1 | Survey 1 |
| 2 | PI Slewing Rate Controller | 3-tier playhead synchronization: deadband (<=100ms), PI rate slewing (0.95x-1.05x) with anti-windup, hard seek (>1.0s) | M1 | Survey 1 |
| 3 | Command Relays & tsMap | `CMD:play/pause/seek/ts` relays, `tsMap` heartbeat broadcasting and inactive peer pruning | M1 | Survey 1 |
| 4 | Buffer-Aware Group Wait | Group buffering pause/resume with dynamic RTT padding and disconnect deadlock prevention | M1 | Survey 1 |
| 5 | WebRTC Mesh Signaling | Targeted peer-to-peer `rtc:signal` routing and `stream:announce` | M1 | Survey 1 |
| 6 | CineVo & Local File Sync | MV3 isolated-world extension bridge and zero-upload local file playback state propagation | M1 | Survey 1 |
| 7 | VM Floor Control Mutex | IDLE <-> OCCUPIED floor control state machine and disconnect queue promotion | M2 | Survey 2 |
| 8 | VM Remote Cursor Mapping | Clamped normalized cursor coordinates in [0, 1]^2 space and viewport scaling | M2 | Survey 2 |
| 9 | VM Security & Single-Writer | URL sanitization (RFC 3986, block private IP/file schemes), single-writer invariant on Opcode 11/16 | M2 | Survey 2 |
| 10 | VM Real-Time Frame & Nav Push | Opcode 1 JPEG screencasting and Opcode 12 CDP frame navigation decoder | M2 | Survey 2 |
| 11 | UniversalPlayer & Engines | YouTube, HLS, native video, local file sync integration with unified controller | M3 | Survey 3 |
| 12 | VirtualBrowser & Auxiliary Players | VirtualBrowser, CineVoPanel, StreamPlayer, TorrentPlayer UI integrations | M3 | Survey 3 |
| 13 | SidePanel & WhatsApp Chat | WhatsApp-styled ChatPanel, QueuePanel, CallsPanel with 3 privacy modes | M3 | Survey 3 |
| 14 | Light Theme Default | Default Porcelain light theme via CSS :root and removal of hardcoded dark class on html | M3 | Survey 3 |
| 15 | Adversarial & E2E Test Suite | Comprehensive multi-tier unit, integration, and adversarial tests (`bun test`) | M4 | Survey 1-3 |
| 16 | Production Build & Git Cleanliness | Next.js production build (`bun run build`), clean tree, push to origin/main | M5 | Survey 3 |

## Milestones
| # | Name | Scope | Dependencies | Status | Key Outputs |
|---|------|-------|-------------|--------|-------------|
| M1 | State Sync Engine Hardening | `mini-services/sync-service/`, `src/lib/sync/`, `src/lib/webrtc/`, `extension/` | none | DONE | `ClockSyncEstimator`, `PISlewingController`, targeted WebRTC signaling, buffer recovery |
| M2 | VM Co-Browsing Hardening | `vm-service/`, `src/components/watchparty/virtual-browser.tsx` | none | DONE | Opcode 16/17 handshake, Opcode 12 nav push, coordinate clamping, URL sanitization |
| M3 | UI Players & Light Theme Default | `src/app/layout.tsx`, `src/components/watchparty/` | M1, M2 | DONE | Default Porcelain light theme, UniversalPlayer, CineVoPanel, StreamPlayer, TorrentPlayer, SidePanel |
| M4 | Comprehensive & Adversarial Tests | `src/__tests__/`, `src/lib/sync/__tests__/` | M1, M2, M3 | DONE | 120/120 passing tests, 2,136 assertions across 7 test suites |
| M5 | Production Build & Git Push | Production build, git commit & push to origin/main | M4 | DONE | Next.js Turbopack build exit code 0, Git clean and pushed to `origin/main` |

## Interface Contracts
### Client Sync Hook ↔ Sync Service (`Socket.IO :3003`)
- `clock:ping` -> `{ t0: number }`
- `clock:pong` <- `{ t0: number, t1: number, t2: number }`
- `CMD:play` / `CMD:pause` / `CMD:seek` / `CMD:ts` -> payload with `{ room, userId, time, seq, ... }`
- `REC:play` / `REC:pause` / `REC:seek` / `REC:tsMap` <- broadcast to room members
- `buffer:event` -> `{ room, userId, type: "waiting" | "playing", position }`
- `rtc:signal` -> `{ room, to: string, msg: any }` -> relayed to specific peer `to`

### Client VirtualBrowser ↔ VM Service (`WS :3004`)
- Opcode 1 (0x01): JPEG frame payload `[0x01, ...jpeg_bytes]`
- Opcode 2 (0x02): Mouse Move `[0x02, x_f32, y_f32]`
- Opcode 3 (0x03): Mouse Down `[0x03, button_u8, x_f32, y_f32]`
- Opcode 4 (0x04): Mouse Up `[0x04, button_u8, x_f32, y_f32]`
- Opcode 5 (0x05): Key Down `[0x05, len_u8, ...key_utf8]`
- Opcode 6 (0x06): Key Up `[0x06, len_u8, ...key_utf8]`
- Opcode 7 (0x07): Scroll `[0x07, dx_f32, dy_f32]`
- Opcode 8 (0x08): Navigate `[0x08, len_u16, ...url_utf8]`
- Opcode 11 (0x0B): Text Input `[0x0B, len_u16, ...text_utf8]`
- Opcode 12 (0x0C): CDP Frame Navigated Push `[0x0C, len_u16, ...url_utf8]`
- Opcode 16 (0x10): Request Floor Control `[0x10, len_u8, ...userId_utf8]`
- Opcode 17 (0x11): Release Floor Control `[0x11, len_u8, ...userId_utf8]`
- Opcode 18 (0x12): Floor Status Broadcast `[0x12, state_u8, len_u8, ...controllerId_utf8]`

## Code Layout
- `mini-services/sync-service/`: Standalone Socket.IO sync server
- `vm-service/`: Standalone VM co-browsing daemon
- `src/lib/sync/`: Sync primitives (`clock-sync.ts`, `pi-controller.ts`, `use-sync-engine.ts`, `use-video-controller.ts`, `types.ts`)
- `src/lib/webrtc/`: WebRTC streaming primitives (`use-webrtc-stream.ts`)
- `src/components/watchparty/`: UI components (`universal-player.tsx`, `virtual-browser.tsx`, `stream-player.tsx`, `torrent-player.tsx`, `side-panel.tsx`, `chat-panel.tsx`, `queue-panel.tsx`, `calls-panel.tsx`)
- `src/app/`: Next.js App Router (`layout.tsx`, `page.tsx`, `globals.css`)
- `src/__tests__/`: Test suites
- `extension/`: Chrome MV3 extension
