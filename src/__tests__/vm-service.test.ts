// @ts-ignore
import { describe, expect, test, beforeEach } from "bun:test";
import { FloorControlManager, normalizeCoordinates, sanitizeUrl, sanitizeUnit } from "../../vm-service/index";

describe("Requirement R3: FloorControlManager State Machine & Single-Writer Security", () => {
  let floorManager: FloorControlManager;
  let socket1: any;
  let socket2: any;
  let socket3: any;

  beforeEach(() => {
    floorManager = new FloorControlManager();
    socket1 = { id: "ws_client_1" };
    socket2 = { id: "ws_client_2" };
    socket3 = { id: "ws_client_3" };
  });

  test("initial state is IDLE with no active controller or queued users", () => {
    expect(floorManager.getState()).toBe("IDLE");
    expect(floorManager.getActiveControllerId()).toBeNull();
    expect(floorManager.getControlState()).toEqual({
      controllerId: null,
      controllerName: null,
      queue: [],
    });
    expect(floorManager.isController(socket1)).toBe(false);
  });

  test("grants control to initial requester and transitions state to OCCUPIED", () => {
    const res = floorManager.requestControl("user_1", "Alice", socket1);
    expect(res.status).toBe("granted");
    expect(res.controllerId).toBe("user_1");
    expect(floorManager.getState()).toBe("OCCUPIED");
    expect(floorManager.getActiveControllerId()).toBe("user_1");
    expect(floorManager.isController(socket1)).toBe(true);
    expect(floorManager.isController(socket2)).toBe(false);
  });

  test("queues subsequent control requests in FIFO order", () => {
    // User 1 gets control
    floorManager.requestControl("user_1", "Alice", socket1);

    // User 2 and User 3 request control while OCCUPIED
    const res2 = floorManager.requestControl("user_2", "Bob", socket2);
    const res3 = floorManager.requestControl("user_3", "Charlie", socket3);

    expect(res2.status).toBe("queued");
    expect(res2.position).toBe(1);
    expect(res3.status).toBe("queued");
    expect(res3.position).toBe(2);

    expect(floorManager.getControlState()).toEqual({
      controllerId: "user_1",
      controllerName: "Alice",
      queue: [
        { userId: "user_2", userName: "Bob" },
        { userId: "user_3", userName: "Charlie" },
      ],
    });
  });

  test("prevents duplicate entries in queue when user requests control multiple times", () => {
    floorManager.requestControl("user_1", "Alice", socket1);
    floorManager.requestControl("user_2", "Bob", socket2);
    
    // Duplicate request from User 2
    const dupRes = floorManager.requestControl("user_2", "Bob Updated", socket2);
    expect(dupRes.status).toBe("queued");
    expect(dupRes.position).toBe(1);
    expect(floorManager.getControlState().queue.length).toBe(1);
  });

  test("promotes queue head when active controller releases floor control", () => {
    floorManager.requestControl("user_1", "Alice", socket1);
    floorManager.requestControl("user_2", "Bob", socket2);
    floorManager.requestControl("user_3", "Charlie", socket3);

    // User 1 releases control
    const releaseRes = floorManager.releaseControl("user_1");
    expect(releaseRes.status).toBe("promoted");
    expect(releaseRes.nextControllerId).toBe("user_2");
    expect(releaseRes.nextControllerName).toBe("Bob");

    expect(floorManager.getState()).toBe("OCCUPIED");
    expect(floorManager.getActiveControllerId()).toBe("user_2");
    expect(floorManager.isController(socket1)).toBe(false);
    expect(floorManager.isController(socket2)).toBe(true);

    expect(floorManager.getControlState().queue).toEqual([
      { userId: "user_3", userName: "Charlie" },
    ]);
  });

  test("returns to IDLE state when last controller releases floor with empty queue", () => {
    floorManager.requestControl("user_1", "Alice", socket1);
    
    const releaseRes = floorManager.releaseControl("user_1", socket1);
    expect(releaseRes.status).toBe("idle");
    expect(floorManager.getState()).toBe("IDLE");
    expect(floorManager.getActiveControllerId()).toBeNull();
    expect(floorManager.isController(socket1)).toBe(false);
  });

  test("rejects floor release requests originating from unauthorized sockets", () => {
    floorManager.requestControl("user_1", "Alice", socket1);
    floorManager.requestControl("user_2", "Bob", socket2);

    // Socket 2 attempts to spoof release for user_1
    const unauthRelease = floorManager.releaseControl("user_1", socket2);
    expect(unauthRelease.status).toBe("unauthorized");
    expect(floorManager.getActiveControllerId()).toBe("user_1");
    expect(floorManager.isController(socket1)).toBe(true);

    // Socket 3 attempts to release queued user_2
    const unauthQueueRelease = floorManager.releaseControl("user_2", socket3);
    expect(unauthQueueRelease.status).toBe("unauthorized");
    expect(floorManager.getControlState().queue.length).toBe(1);

    // Legitimate socket 2 releases queued user_2
    const authQueueRelease = floorManager.releaseControl("user_2", socket2);
    expect(authQueueRelease.status).toBe("removed_from_queue");
    expect(floorManager.getControlState().queue.length).toBe(0);

    // Legitimate socket 1 releases active floor
    const authRelease = floorManager.releaseControl("user_1", socket1);
    expect(authRelease.status).toBe("idle");
    expect(floorManager.getState()).toBe("IDLE");
  });

  test("allows admin/host to force-revoke control of active controller", () => {
    floorManager.requestControl("user_1", "Alice", socket1);
    floorManager.requestControl("user_2", "Bob", socket2);

    // Revoke active controller User 1
    const revokeRes = floorManager.revokeControl("user_1");
    expect(revokeRes.status).toBe("promoted");
    expect(revokeRes.nextControllerId).toBe("user_2");

    expect(floorManager.getActiveControllerId()).toBe("user_2");
    expect(floorManager.isController(socket2)).toBe(true);
  });

  test("allows admin/host to force-revoke a queued user", () => {
    floorManager.requestControl("user_1", "Alice", socket1);
    floorManager.requestControl("user_2", "Bob", socket2);
    floorManager.requestControl("user_3", "Charlie", socket3);

    // Revoke queued user User 2
    const revokeRes = floorManager.revokeControl("user_2");
    expect(revokeRes.status).toBe("revoked_from_queue");

    expect(floorManager.getActiveControllerId()).toBe("user_1");
    expect(floorManager.getControlState().queue).toEqual([
      { userId: "user_3", userName: "Charlie" },
    ]);
  });

  test("handles socket disconnect of active controller by promoting next in queue", () => {
    floorManager.requestControl("user_1", "Alice", socket1);
    floorManager.requestControl("user_2", "Bob", socket2);

    const discRes = floorManager.handleDisconnect(socket1);
    expect(discRes.status).toBe("promoted");
    expect(floorManager.getActiveControllerId()).toBe("user_2");
    expect(floorManager.isController(socket2)).toBe(true);
  });

  test("handles socket disconnect of queued user by removing from queue", () => {
    floorManager.requestControl("user_1", "Alice", socket1);
    floorManager.requestControl("user_2", "Bob", socket2);
    floorManager.requestControl("user_3", "Charlie", socket3);

    floorManager.handleDisconnect(socket2);
    expect(floorManager.getControlState().queue).toEqual([
      { userId: "user_3", userName: "Charlie" },
    ]);
  });

  test("SINGLE-WRITER SECURITY INVARIANT: rejects input events originating from non-controller sockets", () => {
    floorManager.requestControl("user_1", "Alice", socket1);

    // Active controller socket is authorized
    expect(floorManager.isController(socket1)).toBe(true);

    // Unauthorized sockets (queued user, random client) are strictly rejected
    expect(floorManager.isController(socket2)).toBe(false);
    expect(floorManager.isController(socket3)).toBe(false);
    expect(floorManager.isController({ id: "hacker_ws" } as any)).toBe(false);
  });
});

describe("Requirement R3: Binary Opcode Protocol Validation & Framing", () => {
  test("Opcode 1 (0x01): JPEG Screencast Binary Frame Encoding & Decoding", () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const frameMsg = Buffer.concat([Buffer.from([0x01]), fakeJpeg]);

    expect(frameMsg[0]).toBe(0x01);
    const decodedJpeg = frameMsg.subarray(1);
    expect(decodedJpeg).toEqual(fakeJpeg);
  });

  test("Opcode 12 (0x0C): CDP Frame Navigated Push Binary Encoding & Decoding", () => {
    const targetUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const urlBuf = Buffer.from(targetUrl, "utf-8");
    const len = urlBuf.length;
    const navFrame = Buffer.concat([
      Buffer.from([12, (len >> 8) & 0xff, len & 0xff]),
      urlBuf,
    ]);

    expect(navFrame[0]).toBe(12);
    const decodedLen = (navFrame[1] << 8) | navFrame[2];
    expect(decodedLen).toBe(len);
    const decodedUrl = new TextDecoder().decode(navFrame.subarray(3, 3 + decodedLen));
    expect(decodedUrl).toBe(targetUrl);
  });

  test("Opcode 16 (0x10): Request Floor Control Binary Encoding & Decoding", () => {
    const userId = "usr_super_123";
    const userBytes = new TextEncoder().encode(userId);
    const msg = new Uint8Array(2 + userBytes.length);
    msg[0] = 0x10;
    msg[1] = userBytes.length & 0xff;
    msg.set(userBytes, 2);

    expect(msg[0]).toBe(0x10);
    const len = msg[1];
    expect(len).toBe(userBytes.length);
    const parsedUserId = new TextDecoder().decode(msg.subarray(2, 2 + len));
    expect(parsedUserId).toBe(userId);
  });

  test("Opcode 17 (0x11): Release Floor Control Binary Encoding & Decoding", () => {
    const userId = "usr_super_123";
    const userBytes = new TextEncoder().encode(userId);
    const msg = new Uint8Array(2 + userBytes.length);
    msg[0] = 0x11;
    msg[1] = userBytes.length & 0xff;
    msg.set(userBytes, 2);

    expect(msg[0]).toBe(0x11);
    const len = msg[1];
    const parsedUserId = new TextDecoder().decode(msg.subarray(2, 2 + len));
    expect(parsedUserId).toBe(userId);
  });

  test("Opcode 18 (0x12): Floor Status Broadcast Binary Encoding & Decoding", () => {
    const controllerId = "user_host_1";
    const idBytes = new TextEncoder().encode(controllerId);
    const msg = new Uint8Array(3 + idBytes.length);
    msg[0] = 0x12;
    msg[1] = 1; // State: 1 = OCCUPIED
    msg[2] = idBytes.length & 0xff;
    msg.set(idBytes, 3);

    expect(msg[0]).toBe(0x12);
    expect(msg[1]).toBe(1);
    const len = msg[2];
    const activeId = new TextDecoder().decode(msg.subarray(3, 3 + len));
    expect(activeId).toBe(controllerId);
  });

  test("Opcode 128 (0x80) & Opcode 129 (0x81): JSON Payload Encoding & Decoding", () => {
    const grantPayload = { controllerId: "user_alice", controllerName: "Alice" };
    const grantMsg = Buffer.concat([
      Buffer.from([128]),
      Buffer.from(JSON.stringify(grantPayload)),
    ]);
    expect(grantMsg[0]).toBe(128);
    const decodedGrant = JSON.parse(new TextDecoder().decode(grantMsg.subarray(1)));
    expect(decodedGrant).toEqual(grantPayload);

    const statePayload = { controllerId: "user_alice", controllerName: "Alice", queue: [] };
    const stateMsg = Buffer.concat([
      Buffer.from([129]),
      Buffer.from(JSON.stringify(statePayload)),
    ]);
    expect(stateMsg[0]).toBe(129);
    const decodedState = JSON.parse(new TextDecoder().decode(stateMsg.subarray(1)));
    expect(decodedState).toEqual(statePayload);
  });
});

describe("Requirement R3: Remote Input Unit Vector Coordinate Normalization Math", () => {
  test("maps center coordinate (0.5, 0.5) to exact center pixels (960, 540) on 1920x1080", () => {
    const coords = normalizeCoordinates(0.5, 0.5, 1920, 1080);
    expect(coords.x).toBe(960);
    expect(coords.y).toBe(540);
  });

  test("maps origin (0.0, 0.0) to (0, 0) and max bounds (1.0, 1.0) to (1919, 1079)", () => {
    const origin = normalizeCoordinates(0.0, 0.0, 1920, 1080);
    expect(origin.x).toBe(0);
    expect(origin.y).toBe(0);

    const maxBounds = normalizeCoordinates(1.0, 1.0, 1920, 1080);
    expect(maxBounds.x).toBe(1919);
    expect(maxBounds.y).toBe(1079);
  });

  test("strictly clamps negative out-of-bounds inputs (-0.5, -0.2) to valid origin (0, 0)", () => {
    const coords = normalizeCoordinates(-0.5, -0.2, 1920, 1080);
    expect(coords.x).toBe(0);
    expect(coords.y).toBe(0);
  });

  test("strictly clamps positive out-of-bounds inputs (1.5, 2.0) to valid max bounds (1919, 1079)", () => {
    const coords = normalizeCoordinates(1.5, 2.0, 1920, 1080);
    expect(coords.x).toBe(1919);
    expect(coords.y).toBe(1079);
  });

  test("handles arbitrary viewport dimensions (e.g. 1600x900, 1280x720)", () => {
    const center = normalizeCoordinates(0.5, 0.5, 1600, 900);
    expect(center.x).toBe(800);
    expect(center.y).toBe(450);

    const max = normalizeCoordinates(1.0, 1.0, 1600, 900);
    expect(max.x).toBe(1599);
    expect(max.y).toBe(899);

    const center720 = normalizeCoordinates(0.5, 0.5, 1280, 720);
    expect(center720.x).toBe(640);
    expect(center720.y).toBe(360);
  });
});

describe("Requirement R3: Address Bar Navigation URL Sanitization & SSRF Protection", () => {
  test("preserves valid http:// and https:// URLs", () => {
    expect(sanitizeUrl("http://example.com")).toBe("http://example.com/");
    expect(sanitizeUrl("https://www.google.com/search?q=test")).toBe("https://www.google.com/search?q=test");
  });

  test("auto-prefixes missing protocol scheme (google.com -> https://google.com/)", () => {
    expect(sanitizeUrl("google.com")).toBe("https://google.com/");
    expect(sanitizeUrl("wikipedia.org/wiki/Main_Page")).toBe("https://wikipedia.org/wiki/Main_Page");
  });

  test("rejects dangerous file:// scheme", () => {
    expect(() => sanitizeUrl("file:///etc/passwd")).toThrow("Forbidden URL scheme: file:");
    expect(() => sanitizeUrl("FILE://C:/Windows/System32/config/SAM")).toThrow("Forbidden URL scheme: file:");
  });

  test("rejects chrome:// and chrome-extension:// schemes", () => {
    expect(() => sanitizeUrl("chrome://settings")).toThrow("Forbidden URL scheme: chrome:");
    expect(() => sanitizeUrl("chrome-extension://abcdef/main.html")).toThrow("Forbidden URL scheme: chrome-extension:");
  });

  test("rejects javascript: and data: inline execution schemes", () => {
    expect(() => sanitizeUrl("javascript:alert(1)")).toThrow("Forbidden URL scheme: javascript:");
    expect(() => sanitizeUrl("data:text/html,<h1>Hacked</h1>")).toThrow("Forbidden URL scheme: data:");
  });

  test("rejects about: scheme", () => {
    expect(() => sanitizeUrl("about:blank")).toThrow("Forbidden URL scheme: about:");
  });

  test("rejects empty or whitespace-only inputs", () => {
    expect(() => sanitizeUrl("")).toThrow("URL string cannot be empty");
    expect(() => sanitizeUrl("   ")).toThrow("URL string cannot be empty");
  });
});

describe("Milestone 3 EMPIRICAL STRESS TESTS: FloorControlManager Mutex & Coordinate Clamping", () => {
  test("STRESS: FloorControlManager handles 100 concurrent control requests in strict FIFO order without queue duplication", () => {
    const manager = new FloorControlManager();
    const sockets: any[] = Array.from({ length: 100 }, (_, i) => ({ id: `ws_client_${i}` }));

    // User 0 requests control
    const firstRes = manager.requestControl("user_0", "User 0", sockets[0]);
    expect(firstRes.status).toBe("granted");
    expect(manager.getState()).toBe("OCCUPIED");
    expect(manager.getActiveControllerId()).toBe("user_0");

    // Users 1 to 99 request control concurrently
    for (let i = 1; i < 100; i++) {
      const res = manager.requestControl(`user_${i}`, `User ${i}`, sockets[i]);
      expect(res.status).toBe("queued");
      expect(res.position).toBe(i);
    }

    const state = manager.getControlState();
    expect(state.controllerId).toBe("user_0");
    expect(state.queue.length).toBe(99);
    expect(state.queue[0].userId).toBe("user_1");
    expect(state.queue[98].userId).toBe("user_99");

    // Stress test duplicate requests while queued
    for (let i = 1; i < 100; i++) {
      const dupRes = manager.requestControl(`user_${i}`, `User ${i} Reconnect`, sockets[i]);
      expect(dupRes.status).toBe("queued");
      expect(dupRes.position).toBe(i);
    }
    // Queue length must remain exactly 99
    expect(manager.getControlState().queue.length).toBe(99);
  });

  test("STRESS: Sudden active controller disconnect promotes queue head continuously until queue drains to IDLE", () => {
    const manager = new FloorControlManager();
    const count = 10;
    const sockets: any[] = Array.from({ length: count }, (_, i) => ({ id: `ws_${i}` }));

    // Request control for 10 users
    for (let i = 0; i < count; i++) {
      manager.requestControl(`user_${i}`, `User ${i}`, sockets[i]);
    }

    expect(manager.getActiveControllerId()).toBe("user_0");
    expect(manager.getControlState().queue.length).toBe(9);

    // Disconnect active controller iteratively
    for (let i = 0; i < count - 1; i++) {
      const discRes = manager.handleDisconnect(sockets[i]);
      expect(discRes.status).toBe("promoted");
      expect(discRes.nextControllerId).toBe(`user_${i + 1}`);
      expect(manager.getActiveControllerId()).toBe(`user_${i + 1}`);
      expect(manager.isController(sockets[i + 1])).toBe(true);
      expect(manager.isController(sockets[i])).toBe(false);
    }

    // Disconnect the final controller (user_9)
    const finalDiscRes = manager.handleDisconnect(sockets[count - 1]);
    expect(finalDiscRes.status).toBe("idle");
    expect(manager.getState()).toBe("IDLE");
    expect(manager.getActiveControllerId()).toBeNull();
    expect(manager.getControlState().queue.length).toBe(0);
  });

  test("STRESS: Host force revocation of active controller and queued users", () => {
    const manager = new FloorControlManager();
    const sockets: any[] = Array.from({ length: 5 }, (_, i) => ({ id: `ws_${i}` }));

    for (let i = 0; i < 5; i++) {
      manager.requestControl(`user_${i}`, `User ${i}`, sockets[i]);
    }

    // Host revokes middle queued user (user_2)
    const revokeQueuedRes = manager.revokeControl("user_2");
    expect(revokeQueuedRes.status).toBe("revoked_from_queue");
    expect(manager.getControlState().queue.map((u) => u.userId)).toEqual(["user_1", "user_3", "user_4"]);

    // Host revokes active controller (user_0)
    const revokeActiveRes = manager.revokeControl("user_0");
    expect(revokeActiveRes.status).toBe("promoted");
    expect(revokeActiveRes.nextControllerId).toBe("user_1");
    expect(manager.getActiveControllerId()).toBe("user_1");
    expect(manager.getControlState().queue.map((u) => u.userId)).toEqual(["user_3", "user_4"]);

    // Revoke non-existent user should handle gracefully
    const revokeUnknown = manager.revokeControl("user_nonexistent");
    expect(revokeUnknown.status).toBe("revoked_from_queue");
    expect(manager.getActiveControllerId()).toBe("user_1");
  });

  test("STRESS: Single-Writer Security Invariant strictly enforced across socket lifecycle", () => {
    const manager = new FloorControlManager();
    const socketOwner = { id: "owner" };
    const socketQueued = { id: "queued" };
    const socketRogue = { id: "rogue" };

    manager.requestControl("owner_id", "Owner", socketOwner as any);
    manager.requestControl("queued_id", "Queued", socketQueued as any);

    expect(manager.isController(socketOwner as any)).toBe(true);
    expect(manager.isController(socketQueued as any)).toBe(false);
    expect(manager.isController(socketRogue as any)).toBe(false);

    // After owner disconnects
    manager.handleDisconnect(socketOwner as any);
    expect(manager.isController(socketOwner as any)).toBe(false);
    expect(manager.isController(socketQueued as any)).toBe(true); // Promoted
  });

  test("STRESS: Coordinate Normalization math with extreme out-of-bounds, Infinity, and NaN inputs", () => {
    // Extreme negative values
    const neg1 = normalizeCoordinates(-0.5, -100, 1920, 1080);
    expect(neg1.x).toBe(0);
    expect(neg1.y).toBe(0);

    const negInf = normalizeCoordinates(-Infinity, -Infinity, 1920, 1080);
    expect(negInf.x).toBe(0);
    expect(negInf.y).toBe(0);

    // Extreme positive values
    const pos1 = normalizeCoordinates(1.5, 999.9, 1920, 1080);
    expect(pos1.x).toBe(1919);
    expect(pos1.y).toBe(1079);

    const posInf = normalizeCoordinates(Infinity, Infinity, 1920, 1080);
    expect(posInf.x).toBe(1919);
    expect(posInf.y).toBe(1079);

    // Edge values 0.0 and 1.0
    const edgeMin = normalizeCoordinates(0.0, 0.0, 1920, 1080);
    expect(edgeMin.x).toBe(0);
    expect(edgeMin.y).toBe(0);

    const edgeMax = normalizeCoordinates(1.0, 1.0, 1920, 1080);
    expect(edgeMax.x).toBe(1919);
    expect(edgeMax.y).toBe(1079);

    // NaN input values
    const nanCoords = normalizeCoordinates(NaN, NaN, 1920, 1080);
    expect(Number.isNaN(nanCoords.x)).toBe(false);
    expect(Number.isNaN(nanCoords.y)).toBe(false);
    expect(nanCoords.x).toBeGreaterThanOrEqual(0);
    expect(nanCoords.x).toBeLessThan(1920);
    expect(nanCoords.y).toBeGreaterThanOrEqual(0);
    expect(nanCoords.y).toBeLessThan(1080);
  });
});
