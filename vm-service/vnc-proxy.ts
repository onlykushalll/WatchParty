/**
 * WebSocket-to-VNC proxy (replaces websockify)
 * ---------------------------------------------
 * Takes WebSocket connections from noVNC clients and forwards
 * them to a VNC server's TCP port. This is a simple bidirectional
 * TCP relay — no protocol translation needed (noVNC speaks RFB
 * over WebSocket, and VNC servers speak RFB over TCP).
 *
 * On Render/cloud: replace this with KasmVNC (has WebSocket built in).
 */

import { createServer } from "http";
import { connect as tcpConnect, Socket } from "net";
import { WebSocketServer, WebSocket } from "ws";

const PORT = 3004;
const VNC_HOST = "127.0.0.1";
const VNC_PORT = 5900;

const server = createServer((req, res) => {
  // Health check
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "vnc-proxy", vnc: `${VNC_HOST}:${VNC_PORT}` }));
    return;
  }
  // Serve a simple status page
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!DOCTYPE html><html><body style="background:#0a0a0a;color:#888;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>VNC Proxy</h2><p>WebSocket endpoint: <code>ws://${req.headers.host}/websockify</code></p><p>VNC target: <code>${VNC_HOST}:${VNC_PORT}</code></p></div></body></html>`);
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server, path: "/websockify" });

wss.on("connection", (ws: WebSocket) => {
  console.log(`[vnc-proxy] WebSocket client connected, bridging to ${VNC_HOST}:${VNC_PORT}`);

  const vnc = tcpConnect(VNC_PORT, VNC_HOST);

  vnc.on("connect", () => {
    console.log("[vnc-proxy] Connected to VNC server");
  });

  // VNC → WebSocket
  vnc.on("data", (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  vnc.on("error", (err: Error) => {
    console.error("[vnc-proxy] VNC error:", err.message);
    ws.close();
  });

  vnc.on("close", () => {
    console.log("[vnc-proxy] VNC connection closed");
    ws.close();
  });

  // WebSocket → VNC
  ws.on("message", (data: Buffer) => {
    if (!vnc.destroyed) {
      vnc.write(data);
    }
  });

  ws.on("close", () => {
    console.log("[vnc-proxy] WebSocket client disconnected");
    vnc.destroy();
  });

  ws.on("error", () => {
    vnc.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`[vnc-proxy] Listening on port ${PORT} → ${VNC_HOST}:${VNC_PORT}`);
  console.log(`[vnc-proxy] noVNC URL: ws://localhost:${PORT}/websockify`);
});
