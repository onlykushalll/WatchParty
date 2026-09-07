# Privacy Policy — WatchParty

**Last Updated:** September 7, 2026

WatchParty ("we", "our", or "the platform") is dedicated to protecting your privacy while enabling synchronized media viewing experiences with your peers.

---

## 1. Data Collection & Processing

WatchParty is built around privacy-conscious principles:
- **No Mandatory Account Registration:** Users can join rooms using temporary display nicknames without creating permanent accounts or providing email addresses.
- **Room Media State:** Playhead position, play/pause states, and playback rates are broadcast ephemerally across active WebSocket connections solely to keep room participants synchronized.
- **Chat Messages:** Text messages sent in room chat are relayed ephemerally to room members and are not archived permanently or used for profiling.
- **Video Content:** WatchParty does not host, store, or record video streams on our servers. Media is either streamed directly from third-party CDNs (e.g., YouTube, HLS feeds) or rendered via isolated virtual browser sandboxes.

---

## 2. Remote Browser Streaming & Proxy Services

When utilizing the Remote Browser (NoVNC) or Web Proxy features:
- Sessions are isolated in containerized virtual environments.
- Browser cache, cookies, and browsing history generated within the remote sandbox are destroyed when the room closes.
- We do not intercept, record, or store passwords or credit card information entered into remote browser sessions.

---

## 3. Local Browser Storage

We use HTML5 `localStorage` exclusively for essential local UI state:
- Audio volume and mute settings
- Dark mode preferences
- Recent room codes for reconnect convenience

No tracking cookies or marketing beacons are used.

---

## 4. Compliance with Copyright & DMCA

WatchParty respects intellectual property rights. Users are solely responsible for ensuring they possess the right to view and share media URLs synchronized within rooms. For DMCA takedown requests, please consult our `TERMS.md`.

---

## 5. Contact

For inquiries regarding this Privacy Policy, please open an issue on our GitHub repository:
https://github.com/onlykushalll/WatchParty
