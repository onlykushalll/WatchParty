# Project: WatchParty

## Architecture
WatchParty consists of:
- Next.js Frontend & API routes (App Router, Tailwind CSS, Lucide icons, Video player components, WhatsApp-style Chat UI).
- Authoritative State Sync Engine (Cristian's algorithm NTP sync, EMA offset estimation, PI slewing rate controller for YouTube/HLS/MP4).
- Virtual Desktop (VM) Service (`vm-service` directory: Express / WebSocket / WebRTC streaming server with Dockerized headless browser / Chromium integration, cursor overlay, floor control).
- Mini-services / Backend Services (`mini-services` directory for state sync or WebSocket hub if applicable).
- Database & Persistence (Prisma ORM, SQLite / PostgreSQL schema for rooms, users, chat messages).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | NTP & Cristian's Math Spec | Architectural survey & formulas for \bar{\theta}, \delta, PI controller (0.95x-1.05x) | M1 | ORIGINAL_REQUEST §R1 |
| 2 | VM Co-Browsing Spec | WebSocket/WebRTC streaming, unit vector cursor (x_{norm}, y_{norm}), floor control | M1 | ORIGINAL_REQUEST §R1 |
| 3 | Render & Cloud Infra Spec | Container flags (--disable-dev-shm-usage, --js-flags="--max-old-space-size=512"), env vars | M1 | ORIGINAL_REQUEST §R1 |
| 4 | State Sync Engine | Cristian's NTP, EMA offset, PI rate controller for YouTube, HLS, MP4 | M2 | ORIGINAL_REQUEST §R2 |
| 5 | Frame-exact Join & Drift Slewing | Instant playhead sync on join, smooth 100ms-1000ms drift correction without audio pops | M2 | ORIGINAL_REQUEST §R2 |
| 6 | VM Co-Browsing Stage | Interactive multi-user stage with cursor overlay, floor control queue, URL nav | M3 | ORIGINAL_REQUEST §R3 |
| 7 | Widescreen UI & WhatsApp Chat | 16:9 widescreen protection, WhatsApp chat bubbles with avatars, system notifications | M4 | ORIGINAL_REQUEST §R4 |
| 8 | Participant List & Camera Privacy | Room participants with crowns, opt-in camera privacy toggles | M4 | ORIGINAL_REQUEST §R4 |
| 9 | Cloud Containerization & Build | Docker setup, Render.com config, PORT/CORS/PUBLIC_URL/DATABASE_URL env, 0 TS/ESLint errors build | M5 | ORIGINAL_REQUEST §R5 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Architectural Research & Specs | Comprehensive research & specifications for NTP math, VM streaming, Render cloud flags | None | DONE |
| M2 | State Sync Engine | Cristian's NTP, EMA offset, PI rate controller across video providers | M1 | DONE |
| M3 | VM Co-Browsing Stage | Multi-user VM co-browsing, cursor overlay, floor control, URL navigation | M1 | IN_PROGRESS |
| M4 | Modern UI & WhatsApp Chat | 16:9 widescreen stage, WhatsApp chat, crowns, camera privacy | M2, M3 | PLANNED |
| M5 | Cloud Deployment & Verification | Docker setup, env variables, zero-error production build | M1, M2, M3, M4 | PLANNED |

## Interface Contracts
### Client ↔ Sync Server (WebSocket)
- NTP probe: `{ type: 'ntp_ping', clientTime: number }` -> `{ type: 'ntp_pong', clientTime: number, serverTime: number }`
- Room Sync State: `{ type: 'room_state', playhead: number, isPlaying: boolean, serverTime: number, mediaUrl: string, mediaType: 'youtube' | 'hls' | 'mp4' | 'vm' }`

### Client ↔ VM Server (WebSocket/WebRTC)
- Floor control: `{ type: 'floor_request' }`, `{ type: 'floor_release' }`, `{ type: 'floor_granted', userId: string }`
- Input events: `{ type: 'cursor_move', xNorm: number, yNorm: number }`, `{ type: 'click', xNorm: number, yNorm: number }`, `{ type: 'navigate', url: string }`

## Code Layout
- `src/app`: Next.js pages & API routes
- `src/components`: UI components (player, chat, vm, participant list)
- `src/lib/sync`: State sync engine, Cristian's NTP, EMA, PI controller
- `vm-service`: Express/WebSocket/WebRTC Virtual Desktop backend
- `mini-services`: Helper services
- `prisma`: Database schema & migrations
