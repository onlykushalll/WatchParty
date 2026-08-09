/**
 * CDP Virtual Browser Service
 * ----------------------------
 * Controls a dedicated Chrome instance via Chrome DevTools Protocol (CDP).
 * Uses Page.startScreencast for efficient frame capture (much faster than
 * page.screenshot). Forwards mouse/keyboard input via Input.dispatchMouseEvent
 * and Input.dispatchKeyEvent.
 *
 * This is the "OS in the web" approach — a real Chromium browser controlled
 * remotely, with its framebuffer streamed to a canvas in the browser.
 *
 * Architecture:
 *   Chrome (--remote-debugging-port=9222)
 *     ↕ CDP WebSocket
 *   Node.js service (port 3004)
 *     ↕ WebSocket (binary frames)
 *   Browser canvas (noVNC-like client)
 *
 * Key optimizations from the research report:
 *   - Low-RAM Chrome flags (--renderer-process-limit=2, --js-flags=--max-old-space-size=512)
 *   - Stealth flags (--disable-blink-features=AutomationControlled)
 *   - Screencast (not screenshot) for 20-30fps with minimal CPU
 *   - Normalized cursor coordinates for multi-user
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import puppeteer, { Browser, Page } from "puppeteer-core";

const PORT = 3004;
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 24;
const JPEG_QUALITY = 75;
const USER_DATA_DIR = "C:\\Users\\Default.L-HCG-9FVVGS3\\vm-chrome-profile";

// ─── State ───
let browser: Browser | null = null;
let page: Page | null = null;
let cdpSession: any = null;
const clients = new Set<WebSocket>();
let lastFrame: Buffer | null = null;
let screencasting = false;

// ─── Browser launch ───
async function launchBrowser() {
  console.log("[vm] Launching dedicated Chrome with CDP…");

  browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    userDataDir: USER_DATA_DIR,
    args: [
      `--window-size=${WIDTH},${HEIGHT}`,
      `--window-position=0,0`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-popup-blocking",
      "--disable-translate",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-default-apps",
      "--metrics-recording-only",
      "--no-sandbox",
      // Low-RAM optimization flags from research report
      "--renderer-process-limit=2",
      "--js-flags=--max-old-space-size=512",
      "--memory-pressure-off",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=Translate,BackForwardCache,MediaRouter",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
      // Stealth: avoid bot detection
      "--disable-blink-features=AutomationControlled",
      "--exclude-switches=enable-automation",
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ],
    defaultViewport: { width: WIDTH, height: HEIGHT },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  page = (await browser.pages())[0] || (await browser.newPage());
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  // Anti-detection
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
  }).catch(() => {});

  // Get CDP session for screencast + input dispatch
  cdpSession = await page.target().createCDPSession();

  // Start screencast — this is MUCH faster than page.screenshot()
  // It captures only changed regions and sends JPEG frames directly
  await cdpSession.send("Page.startScreencast", {
    format: "jpeg",
    quality: JPEG_QUALITY,
    maxWidth: WIDTH,
    maxHeight: HEIGHT,
    everyNthFrame: Math.max(1, Math.floor(60 / FPS)),
  });

  cdpSession.on("Page.screencastFrame", async (event: any) => {
    const frameData = Buffer.from(event.data, "base64");
    lastFrame = frameData;

    // Broadcast to all WS clients
    const msg = Buffer.concat([Buffer.from([1]), frameData]);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }

    // Acknowledge the frame so Chrome sends the next one
    try {
      await cdpSession.send("Page.screencastFrameAck", {
        sessionId: event.sessionId,
      });
    } catch {}
  });

  await page.goto("https://www.google.com", { waitUntil: "domcontentloaded" }).catch(() => {});
  console.log("[vm] Chrome launched with CDP screencast — streaming", WIDTH, "x", HEIGHT);
}

// ─── HTTP server ───
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "vm-cdp", clients: clients.size }));
    return;
  }

  if (url.pathname === "/url") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ url: page?.url() || "" }));
    return;
  }

  if (url.pathname === "/navigate" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { url: navUrl } = JSON.parse(body);
        if (navUrl && page) {
          await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, url: page.url() }));
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false }));
        }
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML_UI);
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

// ─── WebSocket server ───
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WebSocket) => {
  clients.add(ws);
  console.log(`[vm] WS client connected (${clients.size} total)`);

  // Send last frame immediately
  if (lastFrame) {
    ws.send(Buffer.concat([Buffer.from([1]), lastFrame]));
  }

  ws.on("message", async (data: Buffer) => {
    if (!page || !cdpSession) return;
    try {
      const type = data[0];
      const payload = JSON.parse(data.slice(1).toString("utf-8"));

      if (type === 2) {
        // Mouse move — normalized coordinates → absolute
        const x = Math.round(payload.x * WIDTH);
        const y = Math.round(payload.y * HEIGHT);
        await cdpSession.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y,
        });
      } else if (type === 3) {
        // Mouse click
        const x = Math.round(payload.x * WIDTH);
        const y = Math.round(payload.y * HEIGHT);
        const button = payload.button === "right" ? "right" : "left";
        await cdpSession.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button,
          clickCount: 1,
        });
        await cdpSession.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button,
          clickCount: 1,
        });
      } else if (type === 4) {
        // Scroll
        await cdpSession.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: WIDTH / 2,
          y: HEIGHT / 2,
          deltaX: payload.deltaX || 0,
          deltaY: payload.deltaY || 0,
        });
      } else if (type === 5) {
        // Key press (special keys)
        const keyMap: Record<string, string> = {
          "Enter": "Enter",
          "Backspace": "Backspace",
          "Tab": "Tab",
          "Escape": "Escape",
          "ArrowUp": "ArrowUp",
          "ArrowDown": "ArrowDown",
          "ArrowLeft": "ArrowLeft",
          "ArrowRight": "ArrowRight",
          " ": "Space",
        };
        const key = keyMap[payload.key] || payload.key;
        await cdpSession.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: payload.key,
          code: key,
        });
        await cdpSession.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: payload.key,
          code: key,
        });
      } else if (type === 6) {
        // Type text (single characters) — use page.evaluate for reliability
        // CDP's char event doesn't work on all sites, but direct DOM manipulation does
        const script = `(function(){var el=document.activeElement;if(el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.isContentEditable)){if(el.isContentEditable){document.execCommand('insertText',false,${JSON.stringify(payload.text)})}else{el.value+=(${JSON.stringify(payload.text)});el.dispatchEvent(new Event('input',{bubbles:true}))}}})()`;
        await page.evaluate(script).catch(() => {});
      } else if (type === 7) {
        // Navigate
        await page.goto(payload.url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      } else if (type === 8) {
        await page.goBack().catch(() => {});
      } else if (type === 9) {
        await page.goForward().catch(() => {});
      } else if (type === 10) {
        await page.reload().catch(() => {});
      } else if (type === 11) {
        // Evaluate JS
        await page.evaluate(payload.script).catch(() => {});
      }
    } catch (e) {
      // Ignore input errors (page might be navigating)
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[vm] WS client disconnected (${clients.size} total)`);
  });
});

// ─── Web UI ───
const HTML_UI = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Virtual Browser</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; font-family: -apple-system, sans-serif; background: #0a0a0a; }
  body { display: flex; flex-direction: column; }
  #toolbar { display: flex; gap: 4px; padding: 6px 8px; background: #181818; border-bottom: 1px solid #272727; align-items: center; }
  #toolbar button { padding: 6px 10px; border: none; border-radius: 6px; background: #272727; color: #e0e0e0; cursor: pointer; font-size: 13px; }
  #toolbar button:hover { background: #383838; }
  #toolbar input { flex: 1; padding: 6px 12px; border: 1px solid #333; border-radius: 6px; background: #0e0e0e; color: #e0e0e0; font-size: 13px; outline: none; }
  #stage { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  #screen { max-width: 100%; max-height: 100%; object-fit: contain; cursor: crosshair; background: #000; }
</style>
</head>
<body>
<div id="toolbar">
  <button onclick="goBack()">&#8592;</button>
  <button onclick="goFwd()">&#8594;</button>
  <button onclick="reload()">&#10227;</button>
  <input id="urlbar" placeholder="Enter URL..." onkeydown="if(event.key==='Enter')navigate(this.value)" spellcheck="false">
  <button onclick="navigate(document.getElementById('urlbar').value)" style="background:#7c3aed;color:#fff;">Go</button>
</div>
<div id="stage">
  <canvas id="screen"></canvas>
</div>
<script>
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
const ws = new WebSocket((location.protocol==='https:'?'wss:':'ws:') + '//' + location.host + '/ws');
ws.binaryType = 'arraybuffer';
ws.onmessage = (e) => {
  const data = new Uint8Array(e.data);
  if (data[0] === 1) {
    const blob = new Blob([data.slice(1)], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      if (canvas.width !== img.width) canvas.width = img.width;
      if (canvas.height !== img.height) canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
};
function getCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
}
canvas.addEventListener('mousemove', (e) => {
  const c = getCoords(e);
  ws.send(new Uint8Array([2, ...new TextEncoder().encode(JSON.stringify(c))]));
});
canvas.addEventListener('mousedown', (e) => {
  const c = getCoords(e);
  ws.send(new Uint8Array([3, ...new TextEncoder().encode(JSON.stringify({x:c.x,y:c.y,button:e.button===2?'right':'left'}))]));
  e.preventDefault();
});
canvas.addEventListener('wheel', (e) => {
  ws.send(new Uint8Array([4, ...new TextEncoder().encode(JSON.stringify({deltaX:e.deltaX,deltaY:e.deltaY}))]));
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (document.activeElement === document.getElementById('urlbar')) return;
  if (e.key.length === 1) {
    ws.send(new Uint8Array([6, ...new TextEncoder().encode(JSON.stringify({text:e.key}))]));
  } else {
    ws.send(new Uint8Array([5, ...new TextEncoder().encode(JSON.stringify({key:e.key}))]));
  }
  e.preventDefault();
});
function navigate(url) { url=url.trim(); if(!url) return; if(!url.match(/^https?:\\/\\//)) url='https://'+url; document.getElementById('urlbar').value=url; ws.send(new Uint8Array([7, ...new TextEncoder().encode(JSON.stringify({url}))])); }
function goBack() { ws.send(new Uint8Array([8])); }
function goFwd() { ws.send(new Uint8Array([9])); }
function reload() { ws.send(new Uint8Array([10])); }
setInterval(() => { if(ws.readyState===1) fetch('/url').then(r=>r.json()).then(d=>{if(d.url&&d.url!==document.getElementById('urlbar').value)document.getElementById('urlbar').value=d.url;}).catch(()=>{}); }, 3000);
</script>
</body>
</html>`;

// ─── Start ───
server.listen(PORT, async () => {
  console.log(`[vm] HTTP server on port ${PORT}`);
  try {
    await launchBrowser();
    console.log(`[vm] CDP Virtual Browser ready at http://localhost:${PORT}`);
  } catch (e) {
    console.error("[vm] Failed:", e);
  }
});

process.on("SIGINT", async () => {
  if (cdpSession) {
    try { await cdpSession.send("Page.stopScreencast"); } catch {}
  }
  if (browser) await browser.close();
  process.exit(0);
});
