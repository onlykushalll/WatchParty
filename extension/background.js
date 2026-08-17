/**
 * WatchParty Sync — background service worker
 * Minimal: just handles extension install + keeps storage.session available.
 * The content scripts do all the work directly.
 */

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[WatchParty] extension installed:", details.reason);
});

// Service workers in MV3 can be killed when idle. Our WebSocket lives in the
// content script (not the SW), so this is fine — the SW only handles events
// that need extension-level APIs, which we currently don't use beyond install.
