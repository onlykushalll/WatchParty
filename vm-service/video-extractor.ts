/**
 * Video URL Extractor Service
 * --------------------------------
 * Uses CDP Chrome to navigate to a video site (cinevo.nl, netmirror, etc.),
 * pass Cloudflare bot protection, and extract the actual video stream URL
 * (.m3u8 or .mp4) by intercepting network requests.
 *
 * Once extracted, the URL is sent back to the WatchParty app where it plays
 * NATIVELY in the HLS/MP4 player with perfect sync (<100ms).
 *
 * This is the key insight: use the real Chrome just to UNLOCK the video URL,
 * then play it natively — no streaming needed.
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import puppeteer, { Browser, Page } from "puppeteer-core";

const PORT = 3005;
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const USER_DATA_DIR = "C:\\Users\\Default.L-HCG-9FVVGS3\\vm-chrome-profile";

let browser: Browser | null = null;
let page: Page | null = null;
let cdpSession: any = null;

async function launchBrowser() {
  console.log("[extract] Launching Chrome…");
  browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    userDataDir: USER_DATA_DIR,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "--disable-extensions",
      "--no-sandbox",
      "--renderer-process-limit=2",
      "--js-flags=--max-old-space-size=512",
    ],
    defaultViewport: { width: 1280, height: 720 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  page = (await browser.pages())[0] || (await browser.newPage());
  cdpSession = await page.target().createCDPSession();

  console.log("[extract] Chrome ready");
}

/**
 * Navigate to a URL, wait for Cloudflare, and extract video stream URLs.
 */
async function extractVideoUrl(targetUrl: string): Promise<{
  videoUrls: string[];
  pageUrl: string;
  title: string;
}> {
  if (!page) throw new Error("Browser not ready");
  const p = page;

  const foundUrls: string[] = [];

  // Enable network interception to catch .m3u8 and .mp4 requests
  await cdpSession.send("Network.enable");

  // Listen for network requests
  const networkHandler = (event: any) => {
    const url = event.request?.url || "";
    if (
      url.includes(".m3u8") ||
      url.includes(".mp4") ||
      url.includes(".webm") ||
      url.includes("video") && url.includes("stream") ||
      url.includes("playlist") && url.includes(".m3u8") ||
      url.match(/\.(m3u8|mp4|webm)(\?|$)/i)
    ) {
      if (!foundUrls.includes(url)) {
        foundUrls.push(url);
        console.log("[extract] Found video URL:", url.slice(0, 100));
      }
    }
  };

  cdpSession.on("Network.requestWillBeSent", networkHandler);

  // Also check for video src in the page
  const checkVideoSrc = async () => {
    try {
      const srcs = await p.evaluate(() => {
        const videos = document.querySelectorAll("video");
        const sources = document.querySelectorAll("source");
        const all = [...videos, ...sources];
        return all.map((el) => el.src || el.getAttribute("src") || "").filter(Boolean);
      });
      for (const src of srcs) {
        if (src && !foundUrls.includes(src)) {
          foundUrls.push(src);
          console.log("[extract] Found video src:", src.slice(0, 100));
        }
      }
    } catch {}
  };

  // Navigate to the target URL
  console.log("[extract] Navigating to:", targetUrl);
  await p.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});

  // Wait for Cloudflare check to pass (up to 20s)
  console.log("[extract] Waiting for Cloudflare / page load…");
  await new Promise((r) => setTimeout(r, 5000));

  // Check if we're still on Cloudflare challenge
  const isCloudflare = await p.evaluate(() => {
    return document.title.includes("Just a moment") || document.body?.textContent?.includes("Verifying") || false;
  }).catch(() => false);

  if (isCloudflare) {
    console.log("[extract] Cloudflare challenge detected — waiting 15s for auto-pass…");
    await new Promise((r) => setTimeout(r, 15000));
  }

  // Check video src
  await checkVideoSrc();

  // Try clicking play button to trigger video loading
  console.log("[extract] Looking for play button…");
  try {
    await p.evaluate(() => {
      // Try various play button selectors
      const selectors = [
        ".play", ".vjs-big-play-button", "[class*=play]", "button[class*=Play]",
        ".jw-icon-playback", ".play-button", "[data-play]", ".vjs-poster",
        "button[aria-label*=Play]", ".mejs-overlay-play", ".plyr__control--overlaid",
        ".video-play", ".play-btn", ".watch-play"
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) { (el as HTMLElement).click(); console.log("Clicked:", sel); break; }
      }
      // Also try clicking the video element itself
      const video = document.querySelector("video");
      if (video) { (video as HTMLElement).click(); }
    });
  } catch {}

  // Wait for video to start loading (network requests)
  console.log("[extract] Waiting for video stream to load…");
  await new Promise((r) => setTimeout(r, 10000));
  await checkVideoSrc();

  // Wait more — some players load video lazily
  await new Promise((r) => setTimeout(r, 5000));
  await checkVideoSrc();

  // Also intercept XHR/fetch responses for m3u8 content
  try {
    const scripts = await p.evaluate(() => {
      // Look for any data attributes or script content containing m3u8
      const html = document.documentElement.innerHTML;
      const matches = html.match(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/gi);
      return matches || [];
    });
    for (const s of scripts) {
      if (!foundUrls.includes(s)) {
        foundUrls.push(s);
        console.log("[extract] Found m3u8 in page source:", s.slice(0, 100));
      }
    }
  } catch {}

  // Get page title
  const title = await p.title().catch(() => "");

  // Clean up
  cdpSession.off("Network.requestWillBeSent", networkHandler);

  console.log("[extract] Found", foundUrls.length, "video URLs");
  return {
    videoUrls: foundUrls,
    pageUrl: p.url(),
    title,
  };
}

// ─── HTTP server ───
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "video-extractor" }));
    return;
  }

  // POST /extract — extract video URL from a page
  if (req.url === "/extract" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { url } = JSON.parse(body);
        if (!url) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: "Missing url" }));
          return;
        }
        console.log("[extract] Extract request:", url);
        const result = await extractVideoUrl(url);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (e) {
        console.error("[extract] Error:", e);
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, async () => {
  console.log(`[extract] Video URL extractor on port ${PORT}`);
  try {
    await launchBrowser();
    console.log("[extract] Ready — POST /extract with { url } to extract video URLs");
  } catch (e) {
    console.error("[extract] Failed to launch:", e);
  }
});

process.on("SIGINT", async () => {
  if (browser) await browser.close();
  process.exit(0);
});
