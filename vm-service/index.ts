/**
 * Virtual Browser Service for WatchParty
 * ---------------------------------------
 * Runs on port 3004. Uses puppeteer-core to control the user's existing
 * Chrome installation, streams screenshots as MJPEG over HTTP, and accepts
 * mouse/keyboard input over WebSocket.
 *
 * Works through Cloudflare Tunnel (HTTP + WebSocket, no UDP/WebRTC needed).
 *
 * Usage: bun run dev  (or node index.js)
 * Access: http://localhost:3004 or https://vm.kushalneedsmcp.online
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import puppeteer, { Browser, Page } from "puppeteer-core";
import { join } from "path";

const PORT = 3004;
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 12; // screenshots per second
const JPEG_QUALITY = 60;

// ─── State ───
let browser: Browser | null = null;
let page: Page | null = null;
let lastFrame: Buffer | null = null;
let capturing = false;

// Connected WS clients (for input + frame distribution)
const clients = new Set<WebSocket>();

// ─── Browser launch ───
async function launchBrowser() {
  console.log("[vm] Launching Chrome…");
  browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: "new",
    args: [
      `--window-size=${WIDTH},${HEIGHT}`,
      "--no-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-dev-shm-usage",
      "--mute-audio",
      "--autoplay-policy=no-user-gesture-required",
    ],
    defaultViewport: { width: WIDTH, height: HEIGHT },
  });

  page = (await browser.pages())[0] || (await browser.newPage());
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  // Navigate to a default page
  await page.goto("https://www.google.com", { waitUntil: "domcontentloaded" }).catch(() => {});

  console.log("[vm] Chrome launched, starting capture loop");

  // Screenshot capture loop
  capturing = true;
  const captureLoop = async () => {
    while (capturing && page) {
      try {
        const frame = await page.screenshot({
          type: "jpeg",
          quality: JPEG_QUALITY,
          clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
        });
        lastFrame = frame as Buffer;
        // Broadcast to all WS clients
        const msg = Buffer.concat([
          Buffer.from([1]), // type=1 (frame)
          lastFrame,
        ]);
        for (const ws of clients) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(msg);
          }
        }
      } catch (e) {
        // Page might be navigating, skip this frame
      }
      await new Promise((r) => setTimeout(r, 1000 / FPS));
    }
  };
  captureLoop();
}

// ─── HTTP server (MJPEG stream + web UI) ───
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // CORS + no-cache headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  // Health check
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "vm-browser", clients: clients.size }));
    return;
  }

  // MJPEG stream endpoint (fallback for non-WS clients)
  if (url.pathname === "/stream") {
    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=frame",
      "Cache-Control": "no-store",
    });
    const interval = setInterval(() => {
      if (lastFrame) {
        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${lastFrame.length}\r\n\r\n`);
        res.write(lastFrame);
        res.write("\r\n");
      }
    }, 1000 / FPS);
    req.on("close", () => clearInterval(interval));
    return;
  }

  // Get current URL
  if (url.pathname === "/url") {
    const currentUrl = page?.url() || "";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ url: currentUrl }));
    return;
  }

  // Navigate to a new URL (POST)
  if (url.pathname === "/navigate" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { url: navUrl } = JSON.parse(body);
        if (navUrl && page) {
          await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, url: page.url() }));
        } else {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: "Missing url" }));
        }
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  // Serve the web UI (HTML page with canvas + input handlers)
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML_UI);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ─── WebSocket server (input + frame streaming) ───
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WebSocket) => {
  clients.add(ws);
  console.log(`[vm] WS client connected (${clients.size} total)`);

  // Send the latest frame immediately
  if (lastFrame) {
    ws.send(Buffer.concat([Buffer.from([1]), lastFrame]));
  }

  ws.on("message", async (data: Buffer) => {
    if (!page) return;
    try {
      const type = data[0]; // message type
      const payload = data.slice(1).toString("utf-8");

      if (type === 2) {
        // Mouse move
        const { x, y } = JSON.parse(payload);
        await page.mouse.move(x, y);
      } else if (type === 3) {
        // Mouse click
        const { x, y, button } = JSON.parse(payload);
        await page.mouse.click(x, y, { button: button || "left" });
      } else if (type === 4) {
        // Mouse scroll
        const { deltaX, deltaY } = JSON.parse(payload);
        await page.mouse.wheel({ deltaX, deltaY });
      } else if (type === 5) {
        // Keyboard input
        const { key } = JSON.parse(payload);
        await page.keyboard.press(key);
      } else if (type === 6) {
        // Type text
        const { text } = JSON.parse(payload);
        await page.keyboard.type(text);
      } else if (type === 7) {
        // Navigate
        const { url } = JSON.parse(payload);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      } else if (type === 8) {
        // Go back
        await page.goBack();
      } else if (type === 9) {
        // Go forward
        await page.goForward();
      } else if (type === 10) {
        // Reload
        await page.reload();
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

// ─── Web UI (HTML + JS) ───
const HTML_UI = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Virtual Browser</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #000; overflow: hidden; font-family: -apple-system, sans-serif; }
  #toolbar { display: flex; gap: 4px; padding: 4px; background: #1a1a1a; }
  #toolbar input { flex: 1; padding: 4px 8px; border: 1px solid #333; border-radius: 4px; background: #222; color: #eee; font-size: 12px; }
  #toolbar button { padding: 4px 8px; border: 1px solid #333; border-radius: 4px; background: #222; color: #eee; cursor: pointer; font-size: 12px; }
  #toolbar button:hover { background: #333; }
  #screen { display: block; width: 100%; height: calc(100vh - 36px); image-rendering: auto; cursor: crosshair; }
</style>
</head>
<body>
<div id="toolbar">
  <button onclick="goBack()">←</button>
  <button onclick="goFwd()">→</button>
  <button onclick="reload()">⟳</button>
  <input id="urlbar" placeholder="Enter URL…" onkeydown="if(event.key==='Enter')navigate(this.value)">
  <button onclick="navigate(document.getElementById('urlbar').value)">Go</button>
</div>
<canvas id="screen"></canvas>
<script>
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const wsHost = location.host;
const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(wsProto + '//' + wsHost + '/ws');
ws.binaryType = 'arraybuffer';

ws.onmessage = (e) => {
  const data = new Uint8Array(e.data);
  if (data[0] === 1) {
    // Frame
    const blob = new Blob([data.slice(1)], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
};

// Mouse input
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  ws.send(new Uint8Array([2, ...new TextEncoder().encode(JSON.stringify({x, y}))]));
});
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  ws.send(new Uint8Array([3, ...new TextEncoder().encode(JSON.stringify({x, y, button: 'left'}))]));
});
canvas.addEventListener('wheel', (e) => {
  ws.send(new Uint8Array([4, ...new TextEncoder().encode(JSON.stringify({deltaX: e.deltaX, deltaY: e.deltaY}))]));
  e.preventDefault();
}, { passive: false });

// Keyboard input
document.addEventListener('keydown', (e) => {
  if (document.activeElement.tagName === 'INPUT') return;
  ws.send(new Uint8Array([5, ...new TextEncoder().encode(JSON.stringify({key: e.key}))]));
});

function navigate(url) {
  if (!url.startsWith('http')) url = 'https://' + url;
  ws.send(new Uint8Array([7, ...new TextEncoder().encode(JSON.stringify({url}))]));
}
function goBack() { ws.send(new Uint8Array([8])); }
function goFwd() { ws.send(new Uint8Array([9])); }
function reload() { ws.send(new Uint8Array([10])); }
</script>
</body>
</html>`;

// ─── Start ───
server.listen(PORT, async () => {
  console.log(`[vm] HTTP server on port ${PORT}`);
  try {
    await launchBrowser();
    console.log(`[vm] Virtual browser ready at http://localhost:${PORT}`);
  } catch (e) {
    console.error("[vm] Failed to launch Chrome:", e);
    console.error("[vm] Make sure Chrome is installed at:", CHROME_PATH);
  }
});

// Graceful shutdown
process.on("SIGINT", async () => {
  capturing = false;
  if (browser) await browser.close();
  process.exit(0);
});
