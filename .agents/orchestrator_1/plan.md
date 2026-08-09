# Master Execution Plan: WatchParty

## Project Overview
WatchParty is a production-grade, real-time synchronized video co-watching and shared virtual desktop co-browsing application.

## Milestone Decomposition

### Milestone 1: Comprehensive Architecture & Deep Research Specifications (R1)
- Exhaustive architectural survey & specifications document:
  - NTP Clock Sync & Cristian's Algorithm math formulas (\bar{\theta}, \delta, PI rate controller 0.95x - 1.05x).
  - Virtual Desktop (VM) Co-Browsing streaming mechanisms (WebSocket/WebRTC, normalized cursor vectors (x_{norm}, y_{norm}) \in [0, 1]^2, mutex floor control queues).
  - Render.com & Cloud Infrastructure containerization strategies (--disable-dev-shm-usage, --js-flags="--max-old-space-size=512", TCP/WS proxies, env topology).

### Milestone 2: Authoritative State Synchronization Engine (R2)
- Implementation & refinement of sub-100ms playhead synchronization using Cristian's NTP algorithm.
- Exponential moving average (EMA) clock offset estimation (\theta).
- Proportional-Integral (PI) slewing rate controller for YouTube, HLS (.m3u8), and native HTML5 MP4 videos.
- Verification: Late joiners sync without manual seek; smooth drift auto-correction (100ms < |\Delta t| <= 1000ms) without audio pops.

### Milestone 3: Interactive Virtual Desktop (VM) Co-Browsing (R3)
- Multi-user interactive co-browsing stage.
- Normalized remote cursor overlay.
- Floor control queue (request/release control).
- Address bar URL navigation over WebSocket/WebRTC streaming.

### Milestone 4: Modern Responsive UI & WhatsApp-Style Chat (R4)
- Widescreen 16:9 protection (zero video stretching).
- WhatsApp-style chat bubbles with user avatars and system notifications.
- Participant list with crowns for floor control / host.
- Opt-in camera privacy toggles.

### Milestone 5: Cloud Containerization & Deployment Setup (R5)
- Docker & Render.com configuration.
- Multi-service container setup / scripts.
- Environment variable controls (PORT, CORS_ORIGIN, PUBLIC_URL, DATABASE_URL).
- Full verification: `bun run build` (or npm run build) passes cleanly with 0 TypeScript/ESLint errors.

## Acceptance Criteria Checklist
- [ ] Deliver complete technical architecture & research plan.
- [ ] Late-joining participants sync to exact expected room playhead frame on initial join without manual seeking.
- [ ] Small playhead drifts (100ms < |\Delta t| <= 1000ms) auto-correct smoothly via rate slewing without audio pops.
- [ ] Main video stage retains strict 16:9 widescreen proportions across window resizes.
- [ ] `bun run build` succeeds cleanly with 0 TypeScript/ESLint errors.
