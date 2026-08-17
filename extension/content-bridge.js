/**
 * WatchParty Bridge — content-bridge.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Injected into the WatchParty app (localhost:3000 or *.space-z.ai).
 * Exposes a window API that the app calls to pass room context to the extension.
 * The context is written to chrome.storage.session, which content-cinevo.js
 * reads when it loads on cinevo.nl.
 *
 * Also listens for messages from the page via window.postMessage (the app sends
 * these to tell the extension "start syncing this room on cinevo.nl").
 */

// Listen for messages from the WatchParty app page
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  if (event.data && event.data.type === "WP_START_SYNC") {
    const ctx = event.data.payload;
    if (!ctx || !ctx.roomId || !ctx.userId) return;

    // Write to chrome.storage.session so content-cinevo.js can read it
    await chrome.storage.session.set({
      "wp:roomId": ctx.roomId,
      "wp:userId": ctx.userId,
      "wp:userName": ctx.userName || "Guest",
      "wp:syncUrl": ctx.syncUrl || "http://localhost:3003",
      "wp:cinevoUrl": ctx.cinevoUrl || "",
      "wp:color": ctx.color || "#a78bfa",
    });

    // Acknowledge
    window.postMessage({ type: "WP_START_SYNC_ACK", ok: true }, "*");

    // If a cinevoUrl was provided, open it in a new tab
    if (ctx.cinevoUrl && ctx.autoOpen !== false) {
      window.open(ctx.cinevoUrl, "_blank");
    }
  }

  if (event.data && event.data.type === "WP_CHECK_INSTALLED") {
    // The app pings to check if the extension is installed
    window.postMessage({ type: "WP_INSTALLED", version: "1.0.0" }, "*");
  }
});

// Announce presence on load
window.postMessage({ type: "WP_INSTALLED", version: "1.0.0" }, "*");
