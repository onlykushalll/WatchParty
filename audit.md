# Site Audit Report
**Date:** 2026-09-07
**Project:** WatchParty (Synchronized Co-Watching Platform)
**Detected stack:** Next.js 16, React 19, TypeScript 5, Socket.io 4.8, Prisma (SQLite), HLS.js, NoVNC (@novnc/novnc), Puppeteer-core, Tailwind CSS 4, Radix UI, Framer Motion 12, Zustand, Z-AI Web Dev SDK
**Detected audience/goal:** Distributed friend groups, families, and remote communities seeking synchronized media playback (YouTube, HLS, local video, or remote headless browser streaming) with real-time text chat and reaction emojis.
**Design system maturity:** Tokenized — Tailwind CSS v4 design tokens, Radix UI headless components, consistent dark theater palette (`bg-background text-foreground`), custom media player chrome.

---

## Anti-Pattern Verdict
Does this look AI-generated? **Partially.** Specific tells:
- **Tracked AI Teamwork Artifacts:** Repository root previously contained an `.agents` directory with 232 subagent briefing/dispatch Markdown files (`ORIGINAL_REQUEST.md`, `sentinel/BRIEFING.md`, etc.), an undeniable artifact of automated multi-agent code generation.
- **Overloaded Scaffolding Dependencies:** Presence of heavy unrelated packages (@dnd-kit, @mdxeditor/editor, next-auth, next-intl, @tanstack/react-table, recharts) indicating a kitchen-sink boilerplate origin.
- **Inline DangerouslySetInnerHTML:** `src/components/ui/chart.tsx:83` uses `dangerouslySetInnerHTML` for CSS variables injection.

**Counter-Tells (Human / Custom Engineering):**
- Sophisticated dual-mode media synchronization: high-precision WebSocket timestamp drift compensation (< 250ms drift adjustment) alongside a headless Chromium / NoVNC remote browser engine (`vm-service`).
- Purpose-built reverse proxy in `src/app/api/proxy/route.ts` with custom regex rewriting of HTML relative paths for iframe embedding.
- Clean Next.js App Router structure with modular socket events (`mini-services/`).

Score: **2/4** — Exceptional real-time video synchronization and VNC capabilities, heavily marred by tracked AI agent handoff files and unused boilerplate dependencies.

---

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 2/4 | Video controls lack full ARIA slider attributes (`aria-valuenow`, `aria-valuemin`, `aria-valuemax`); live chat lacks screen reader scroll throttling |
| 2 | Performance | 2/4 | WebSocket chat dispatches trigger high-frequency re-renders in main room layout; ~15 unused npm dependencies inflate bundle size by ~4MB |
| 3 | Security | 1/4 | `/api/proxy` acts as an unauthenticated, un-rate-limited open reverse HTTP proxy; SSRF guard can be bypassed via DNS rebinding |
| 4 | Theming & design system | 3/4 | Excellent dark theater immersion with consistent typography and color tokens; minor leaks in chat tooltip borders |
| 5 | Responsive design | 2/4 | Video player + chat sidebar layout breaks on mobile screens (< 768px), squeezing video view or occluding playback controls |
| 6 | Anti-patterns | 2/4 | Tracked `.agents` directory, scaffolding dependency bloat, and `dangerouslySetInnerHTML` |
| | **Total** | **12/24** | **Acceptable** |

**Legal & compliance flags:** Privacy Policy [missing — addressed via PRIVACY.md] · Terms [missing — addressed via TERMS.md] · Cookie consent [n-a — local storage / session based] · GDPR signals [missing — IP transmission disclosure needed] · COPPA [missing — general audience streaming platform]

---

## Executive Summary
WatchParty delivers powerful synchronized media playback and virtual browser co-watching capabilities with low-latency WebSocket signaling. However, it harbors a high-risk security vulnerability in its `/api/proxy` route (an open, unauthenticated reverse HTTP proxy susceptible to SSRF and third-party abuse), previously committed hundreds of AI agent trace files, lacks mobile responsive optimizations for room chat, and operates without terms of service or copyright DMCA safe harbor disclosures. Securing the proxy route and establishing clear legal terms are immediate launch priorities.

Total findings by severity: P0 [1] · P1 [3] · P2 [4] · P3 [3]

---

## Quick Wins
1. **Restrict `/api/proxy` to Authenticated Room Sessions with Domain Whitelisting** (`src/app/api/proxy/route.ts:83-168`) (P0) — Prevent external abuse of the server as an open HTTP proxy.
2. **Purge Tracked `.agents` Directory from Git History** (P1) — Remove 232 AI session files and update `.gitignore`.
3. **Add Mobile Sheet Drawer for Chat Sidebar** (`src/components/room/ChatSidebar.tsx`) (P1) — Move chat to a collapsible sheet on screens under 768px so the video remains large.
4. **Remove Unused Boilerplate Packages** (`package.json`) (P2) — Remove `@dnd-kit`, `@mdxeditor/editor`, `next-auth`, `recharts` to trim bundle by ~4MB.

---

## Findings

### P0 — Blocking

#### Unauthenticated Open Reverse HTTP Proxy & SSRF Exposure
- **Category:** Security
- **Location:** `src/app/api/proxy/route.ts:83-168`
- **Issue:** The `GET /api/proxy?url=<url>` route fetches arbitrary internet URLs, strips security headers (`Content-Security-Policy`, `X-Frame-Options`), injects `X-Frame-Options: ALLOWALL`, rewrites HTML links, and streams the body back to the caller. The endpoint has **zero authentication**, **zero rate limiting**, and relies solely on a static hostname blocklist (`isBlockedHost`).
- **User impact:** Anyone on the internet can abuse this server as an open proxy to scrape target websites, launch attacks anonymously using the host's IP address, or bypass local IP firewalls via DNS rebinding (e.g., pointing a custom domain to `127.0.0.1` or internal cloud metadata services like `169.254.169.254`).
- **Fix:** Require an active room session token in request headers/cookies, enforce strict per-IP rate limiting, perform post-DNS IP resolution checking prior to connecting, and restrict proxying to approved video streaming hostnames.

---

### P1 — Major

#### Tracked AI Session Handoff Files in Repository Tree
- **Category:** Code Hygiene & Repository Integrity
- **Location:** `.agents/` (232 files), `CLAUDE.md`, `AGENTS.md`, `ORIGINAL_REQUEST.md`
- **Issue:** Over 230 internal AI agent dispatch records, challenger briefings, and progress logs are tracked in Git, cluttering repository search, bloating clone sizes, and leaving explicit AI generation traces.
- **User impact:** Contributor confusion, compromised professional codebase presentation, and slowed git operations.
- **Fix:** Untrack all `.agents/` files via `git rm -r --cached .agents/`, delete the residue, and add `.agents/` and `*.handoff.md` to `.gitignore`.

#### Video Player Layout Destruction on Mobile Viewports
- **Category:** Responsive Design
- **Location:** `src/components/room/RoomLayout.tsx`
- **Issue:** The room layout uses a static flex-row split dividing screen width 70/30 between video player and chat sidebar. On viewports below 768px, the video player shrinks to an unwatchable height while video controls overflow horizontally.
- **User impact:** Mobile viewers cannot read subtitles or tap pause/play buttons without accidentally clicking chat elements.
- **Fix:** Implement a responsive stacked layout with a collapsible drawer or bottom sheet for chat on mobile devices.

#### Missing DMCA Copyright & Third-Party Content Safe Harbor
- **Category:** Legal & Compliance
- **Location:** `TERMS.md` (formerly missing)
- **Issue:** Users can synchronize and stream copyrighted third-party video content through custom URLs and remote browser sessions without clear DMCA safe harbor procedures or notice-and-takedown designations.
- **User impact:** Significant legal liability under the Digital Millennium Copyright Act (DMCA) for secondary copyright infringement.
- **Fix:** Publish formal `TERMS.md` establishing a DMCA takedown procedure, user warranty of content rights, and prohibition of pirated media rebroadcasting.

---

### P2 — Minor

#### Missing ARIA Attributes on Custom Scrub Bar
- **Category:** Accessibility
- **Location:** `src/components/player/ScrubBar.tsx`
- **Issue:** The custom video progress bar is implemented using a styled `<div>` rather than an `<input type="range">` or element with `role="slider"`, `aria-valuenow`, `aria-valuemin`, and `aria-valuemax`.
- **User impact:** Screen reader users cannot seek forward or backward in the media stream using keyboard navigation.
- **Fix:** Add `role="slider"`, `tabIndex={0}`, ARIA range attributes, and arrow key handlers (Left/Right to seek 5s).

#### High-Frequency Chat Re-renders Starving Video Sync Loop
- **Category:** Performance
- **Location:** `src/components/room/ChatMessages.tsx`
- **Issue:** Every incoming chat message triggers state updates that re-evaluate the parent room component, occasionally dropping frames in the HTML5 video playback sync loop.
- **User impact:** Stuttering audio/video playback when chat rooms become active.
- **Fix:** Isolate chat state into a localized Zustand slice and wrap the video player container in `React.memo`.

#### Unescaped Dynamic Chart Styles Injection
- **Category:** Security
- **Location:** `src/components/ui/chart.tsx:83`
- **Issue:** CSS configuration styles are rendered using `dangerouslySetInnerHTML`.
- **User impact:** Potential DOM XSS if user-controlled strings ever enter chart color theme configs.
- **Fix:** Apply styles via standard React `style` attributes or validated CSS variable maps.

#### Missing Room Password Brute-Force Rate Limiting
- **Category:** Security
- **Location:** `src/app/api/rooms/route.ts`
- **Issue:** Password-protected private rooms do not rate-limit incorrect passcode attempts per IP or session.
- **User impact:** Automated scripts can brute-force 4-digit or 6-digit room PINs within seconds.
- **Fix:** Add in-memory sliding window rate limiting (max 5 failed attempts per minute per IP).

---

### P3 — Polish

#### Chat Auto-Scroll Snapping Glitch
- **Category:** Usability
- **Location:** `src/components/room/ChatMessages.tsx:120`
- **Issue:** When a user scrolls up to read past chat history, new incoming messages forcibly snap the scrollbar back to the bottom.
- **User impact:** Disruptive reading experience when chat volume is high.
- **Fix:** Only auto-scroll to bottom if user is already within 50px of the bottom edge (`isNearBottom`).

#### Tracked Temporary Commit Note
- **Category:** Code Hygiene
- **Location:** `commit-msg.txt`
- **Issue:** Temporary text file left in root.
- **User impact:** Clutters repository root.
- **Fix:** Delete `commit-msg.txt`.

---

## Systemic Patterns
1. **Unprotected Public Endpoints:** Backend routes (proxying, room generation) lack baseline token-bucket rate limiting and authentication gates.
2. **Desktop-First Architectural Bias:** Split-screen multi-pane views were authored assuming wide landscape monitors without adapting to portrait touch devices.
3. **Template Residuals:** Unused dependencies and subagent scratch files remained committed across multiple features.

---

## Strengths
1. **Precise Multi-Client Synchronization:** Drift compensation logic accurately keeps media timestamps aligned across varying network latencies.
2. **Flexible Dual-Engine Architecture:** Seamless switching between direct HLS/MP4 playback and remote headless browser rendering via NoVNC.
3. **Responsive Socket Infrastructure:** Clean event separation for play/pause/seek synchronization across isolated room namespaces.

---

## Recommended Priority Order
1. **Harden Reverse Proxy Route:** Implement session authentication and SSRF defenses on `/api/proxy` to eliminate open proxy exposure.
2. **Purge AI Artifacts:** Untrack and delete `.agents/` and legacy AI handoff files.
3. **Publish Legal Compliance Suite:** Commit `PRIVACY.md` and `TERMS.md` (with DMCA copyright safe harbor).
4. **Mobile Layout Overhaul:** Move the chat sidebar into a responsive sheet for mobile devices.
5. **Accessibility Enhancements:** Implement keyboard slider navigation on the custom video scrubber.
