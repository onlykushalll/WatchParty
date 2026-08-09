// @ts-ignore
import { describe, expect, test, beforeEach } from "bun:test";
import { FloorControlManager, normalizeCoordinates, sanitizeUrl, sanitizeUnit } from "../../vm-service/index";

describe("Requirement R3 Challenge 1: Coordinate Bounds Clamping & Special Floats", () => {
  test("sanitizeUnit handles NaN, Infinity, -Infinity, strings, null, undefined, objects", () => {
    expect(sanitizeUnit(0.5)).toBe(0.5);
    expect(sanitizeUnit(0.0)).toBe(0.0);
    expect(sanitizeUnit(1.0)).toBe(1.0);
    
    // Out-of-bounds clamping
    expect(sanitizeUnit(-0.5)).toBe(0.0);
    expect(sanitizeUnit(-100)).toBe(0.0);
    expect(sanitizeUnit(1.5)).toBe(1.0);
    expect(sanitizeUnit(999.9)).toBe(1.0);

    // Infinity handling
    expect(sanitizeUnit(Infinity)).toBe(1.0);
    expect(sanitizeUnit(-Infinity)).toBe(0.0);

    // NaN and non-numeric type safety
    expect(sanitizeUnit(NaN)).toBe(0.0);
    expect(sanitizeUnit("0.5" as any)).toBe(0.0);
    expect(sanitizeUnit(null as any)).toBe(0.0);
    expect(sanitizeUnit(undefined as any)).toBe(0.0);
    expect(sanitizeUnit({} as any)).toBe(0.0);
    expect(sanitizeUnit([] as any)).toBe(0.0);
  });

  test("normalizeCoordinates maps correctly to pixel bounds [0, width-1] x [0, height-1]", () => {
    // Normal cases
    expect(normalizeCoordinates(0.5, 0.5, 1920, 1080)).toEqual({ x: 960, y: 540 });
    expect(normalizeCoordinates(0.0, 0.0, 1920, 1080)).toEqual({ x: 0, y: 0 });
    expect(normalizeCoordinates(1.0, 1.0, 1920, 1080)).toEqual({ x: 1919, y: 1079 });

    // Negative out-of-bounds
    expect(normalizeCoordinates(-1.5, -99, 1920, 1080)).toEqual({ x: 0, y: 0 });
    expect(normalizeCoordinates(-Infinity, -Infinity, 1920, 1080)).toEqual({ x: 0, y: 0 });

    // Positive out-of-bounds
    expect(normalizeCoordinates(2.5, 100, 1920, 1080)).toEqual({ x: 1919, y: 1079 });
    expect(normalizeCoordinates(Infinity, Infinity, 1920, 1080)).toEqual({ x: 1919, y: 1079 });

    // NaN inputs
    expect(normalizeCoordinates(NaN, NaN, 1920, 1080)).toEqual({ x: 0, y: 0 });

    // Non-numeric inputs
    expect(normalizeCoordinates("abc" as any, null as any, 1920, 1080)).toEqual({ x: 0, y: 0 });
  });
});

describe("Requirement R3 Challenge 2: Floor Control Security & Single-Writer Invariant", () => {
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

  test("Single-Writer Invariant: denies input execution when state is IDLE", () => {
    expect(floorManager.getState()).toBe("IDLE");
    expect(floorManager.isController(socket1)).toBe(false);
    expect(floorManager.isController(socket2)).toBe(false);
  });

  test("Single-Writer Invariant: denies input execution to non-controller sockets when state is OCCUPIED", () => {
    floorManager.requestControl("user_1", "Alice", socket1);
    floorManager.requestControl("user_2", "Bob", socket2);

    expect(floorManager.isController(socket1)).toBe(true);
    expect(floorManager.isController(socket2)).toBe(false);
    expect(floorManager.isController(socket3)).toBe(false);
  });

  test("SECURITY FINDING: Unauthorized socket spoofing floor release for active controller", () => {
    // User 1 on socket 1 requests control and becomes active controller
    floorManager.requestControl("user_1", "Alice", socket1);
    // User 2 on socket 2 requests control and gets queued
    floorManager.requestControl("user_2", "Bob", socket2);

    expect(floorManager.getActiveControllerId()).toBe("user_1");
    expect(floorManager.isController(socket1)).toBe(true);
    expect(floorManager.isController(socket2)).toBe(false);

    // Simulate WebSocket handler logic for type 17 (release-control):
    // Handler receives message from sendingSocket containing { userId: targetUserId }
    // and invokes floorManager.releaseControl(targetUserId, sendingSocket)
    const simulateWsReleaseHandler = (sendingSocket: any, targetUserId: string) => {
      return floorManager.releaseControl(targetUserId, sendingSocket);
    };

    // Socket 2 (User 2 - unauthorized to release User 1's floor) sends release message targeting user_1
    const releaseRes = simulateWsReleaseHandler(socket2, "user_1");

    // VERIFIED FIX:
    // Unauthorized release is rejected with 'unauthorized', User 1 retains control
    expect(releaseRes.status).toBe("unauthorized");
    expect(floorManager.getActiveControllerId()).toBe("user_1");
    expect(floorManager.isController(socket1)).toBe(true);
    expect(floorManager.isController(socket2)).toBe(false);

    // Legitimate release from User 1 on socket 1 succeeds and promotes User 2
    const legitReleaseRes = simulateWsReleaseHandler(socket1, "user_1");
    expect(legitReleaseRes.status).toBe("promoted");
    expect(floorManager.getActiveControllerId()).toBe("user_2");
    expect(floorManager.isController(socket1)).toBe(false);
    expect(floorManager.isController(socket2)).toBe(true);
  });
});

describe("Requirement R3 Challenge 3: Address Bar Navigation URL Sanitization", () => {
  test("Sanitizes and preserves valid HTTP/HTTPS URLs", () => {
    expect(sanitizeUrl("http://example.com")).toBe("http://example.com/");
    expect(sanitizeUrl("https://domain.org/path?a=1")).toBe("https://domain.org/path?a=1");
  });

  test("Auto-prefixes missing protocol scheme", () => {
    expect(sanitizeUrl("example.com")).toBe("https://example.com/");
    expect(sanitizeUrl("sub.domain.co.uk/page")).toBe("https://sub.domain.co.uk/page");
  });

  test("Rejects dangerous/forbidden schemes with case insensitivity and whitespace handling", () => {
    expect(() => sanitizeUrl("file:///etc/passwd")).toThrow();
    expect(() => sanitizeUrl("FILE:///C:/secret.txt")).toThrow();
    expect(() => sanitizeUrl("  file:///etc/hosts  ")).toThrow();

    expect(() => sanitizeUrl("chrome://settings")).toThrow();
    expect(() => sanitizeUrl("CHROME://downloads")).toThrow();

    expect(() => sanitizeUrl("chrome-extension://abc/popup.html")).toThrow();
    expect(() => sanitizeUrl("Chrome-Extension://abc/popup.html")).toThrow();

    expect(() => sanitizeUrl("javascript:alert(document.cookie)")).toThrow();
    expect(() => sanitizeUrl("JAVASCRIPT:alert(1)")).toThrow();
    expect(() => sanitizeUrl("  javascript:void(0)")).toThrow();

    expect(() => sanitizeUrl("data:text/html,<script>alert(1)</script>")).toThrow();
    expect(() => sanitizeUrl("DATA:text/html;base64,AAA")).toThrow();

    expect(() => sanitizeUrl("about:blank")).toThrow();
    expect(() => sanitizeUrl("ABOUT:CONFIG")).toThrow();
  });

  test("Rejects empty or whitespace-only inputs", () => {
    expect(() => sanitizeUrl("")).toThrow("URL string cannot be empty");
    expect(() => sanitizeUrl("   \t\n  ")).toThrow("URL string cannot be empty");
  });
});
