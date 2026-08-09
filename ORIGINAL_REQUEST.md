# Original User Request

## Initial Request — 2026-08-09T18:23:16Z

Execute comprehensive deep research, technical architecture design, and system implementation planning for WatchParty: a production-grade, real-time synchronized video co-watching and shared virtual desktop co-browsing application.

Working directory: c:/Users/Default.L-HCG-9FVVGS3/OneDrive/Desktop/WatchParty
Integrity mode: development

## Requirements

### R1. Comprehensive Architecture & Deep Research Specifications
Perform an exhaustive architectural survey covering:
- **NTP Clock Sync & Cristian's Algorithm**: Mathematical model for clock offset (\bar{\theta}), round-trip time filtering (\delta), and Proportional-Integral (PI) playhead slewing rate controllers (0.95x to 1.05x).
- **Virtual Desktop (VM) Co-Browsing**: Containerized Chromium screen streaming via WebSockets/WebRTC, normalized remote cursor unit vectors (x_{norm}, y_{norm}) \in [0, 1]^2, and mutex floor control queues.
- **Render.com & Cloud Infrastructure**: Low-RAM Chromium container flags (--disable-dev-shm-usage, --js-flags="--max-old-space-size=512"), multi-service TCP/WebSocket proxies, and environment variable topologies.

### R2. Authoritative State Synchronization Engine
Implement sub-100ms playhead synchronization using Cristian's NTP clock sync algorithm, exponential moving average clock offset estimation (\theta), and a Proportional-Integral (PI) slewing rate controller for YouTube, HLS (.m3u8), and native HTML5 MP4 videos.

### R3. Interactive Virtual Desktop (VM) Co-Browsing
Provide a multi-user interactive co-browsing stage with normalized remote cursor overlay, floor control queue (request/release control), and address bar URL navigation running over WebSocket/WebRTC streaming.

### R4. Modern Responsive UI & WhatsApp-Style Chat
Ensure full widescreen 16:9 layout protection (zero video stretching), WhatsApp-style chat bubbles with avatars, system notifications, participant list with crowns, and opt-in camera privacy.

### R5. Cloud Containerization & Deployment Setup
Configure single/multi-container Docker & Render.com deployment setup with environment variable controls (PORT, CORS_ORIGIN, PUBLIC_URL, DATABASE_URL).

## Acceptance Criteria

### Research & System Verification
- [ ] Deliver a complete, peer-reviewed technical architecture & research plan documenting NTP math formulas, VM streaming mechanisms, and Render cloud containerization strategies.
- [ ] Late-joining participants synchronize to the exact expected room playhead frame on initial join without manual seeking.
- [ ] Small playhead drifts (100ms < |\Delta t| <= 1000ms) auto-correct smoothly via rate slewing without audio pops.
- [ ] Main video stage retains strict 16:9 widescreen proportions across window resizes.
- [ ] bun run build succeeds cleanly with 0 TypeScript/ESLint errors.
