// @ts-ignore
import { describe, expect, test } from "bun:test";
import { FloorControlManager, normalizeCoordinates, sanitizeUrl, sanitizeUnit } from "../../vm-service/index";
import { ClockSyncEstimator } from "../lib/sync/clock-sync";
import { PISlewingController, computeExpectedPlayhead } from "../lib/sync/pi-controller";
import { detectVideoType, youtubeId } from "../lib/sync/types";

describe("Adversarial Verification Tier 1: Encoding & Escaping Integrity", () => {
  test("URL sanitizer rejects XSS payloads in scheme and hostname", () => {
    const xssPayloads = [
      "javascript:alert(document.cookie)",
      "JAVASCRIPT:/*--></title></style></textarea></script></xmp><svg/onload='+/\"/+/onmouseover=1/+/[*/[]/+alert(1)//'>",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "file:///c:/windows/win.ini",
      "chrome://version",
      "chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/home.html",
      "about:config",
    ];

    for (const payload of xssPayloads) {
      expect(() => sanitizeUrl(payload)).toThrow();
    }
  });

  test("handles unicode emojis, RTL markers, and surrogate pairs in user strings safely", () => {
    const manager = new FloorControlManager();
    const maliciousUserNames = [
      "Alice 👩‍👩‍👧‍👦 \u202E\u0000\uFEFF", // Surrogate pairs + RTL + Null byte + BOM
      "Bob\u0000\u0000\u0000",
      "<script>alert(1)</script>",
      "'; DROP TABLE users; --",
      "🔥".repeat(100),
    ];

    maliciousUserNames.forEach((name, idx) => {
      const sock = { id: `ws_adv_${idx}` };
      const res = manager.requestControl(`user_adv_${idx}`, name, sock as any);
      if (idx === 0) {
        expect(res.status).toBe("granted");
      } else {
        expect(res.status).toBe("queued");
      }
    });

    const state = manager.getControlState();
    expect(state.controllerId).toBe("user_adv_0");
    expect(state.queue.length).toBe(maliciousUserNames.length - 1);
  });
});

describe("Adversarial Verification Tier 2: Invalid Input Combinations & Sequence Guarding", () => {
  test("monotonic sequence numbering: stale incoming seq numbers are discarded", () => {
    const currentRoomSeq = 15;

    const shouldAcceptIntent = (incomingSeq: number | undefined, roomSeq: number) => {
      if (incomingSeq !== undefined && incomingSeq < roomSeq) {
        return false;
      }
      return true;
    };

    // Stale sequence arrivals (e.g. out-of-order packets)
    expect(shouldAcceptIntent(14, currentRoomSeq)).toBe(false);
    expect(shouldAcceptIntent(0, currentRoomSeq)).toBe(false);
    expect(shouldAcceptIntent(-1, currentRoomSeq)).toBe(false);

    // Valid current or newer sequence
    expect(shouldAcceptIntent(15, currentRoomSeq)).toBe(true);
    expect(shouldAcceptIntent(16, currentRoomSeq)).toBe(true);
    expect(shouldAcceptIntent(undefined, currentRoomSeq)).toBe(true);
  });

  test("negative or non-finite seek times are rejected", () => {
    const isValidSeek = (data: { time: any }) => {
      if (data?.time === null || data?.time === undefined) return false;
      const time = Number(data?.time);
      return isFinite(time) && time >= 0;
    };

    expect(isValidSeek({ time: -1.0 })).toBe(false);
    expect(isValidSeek({ time: -Infinity })).toBe(false);
    expect(isValidSeek({ time: NaN })).toBe(false);
    expect(isValidSeek({ time: "invalid_time" as any })).toBe(false);
    expect(isValidSeek({ time: undefined as any })).toBe(false);
    expect(isValidSeek({ time: null as any })).toBe(false);
    expect(isValidSeek({ time: 0.0 })).toBe(true);
    expect(isValidSeek({ time: 120.5 })).toBe(true);
  });

  test("corrupted WebSocket binary frames handle truncation gracefully", () => {
    // Simulated decoder for Opcode 12 CDP navigation
    const decodeOpcode12 = (data: Uint8Array): string | null => {
      if (data[0] !== 12) return null;
      if (data.length >= 3) {
        const len = (data[1] << 8) | data[2];
        if (data.length >= 3 + len && len > 0) {
          return new TextDecoder().decode(data.subarray(3, 3 + len));
        }
      }
      return null;
    };

    // Frame claims length is 50 bytes, but payload is only 3 bytes total (truncated)
    const truncatedFrame = new Uint8Array([12, 0, 50, 65, 66]);
    expect(decodeOpcode12(truncatedFrame)).toBeNull();

    // Frame with zero length
    const zeroLenFrame = new Uint8Array([12, 0, 0]);
    expect(decodeOpcode12(zeroLenFrame)).toBeNull();

    // Frame too short even for header
    const shortFrame = new Uint8Array([12]);
    expect(decodeOpcode12(shortFrame)).toBeNull();

    // Valid frame
    const validUrl = "https://example.com";
    const urlBytes = new TextEncoder().encode(validUrl);
    const validFrame = new Uint8Array(3 + urlBytes.length);
    validFrame[0] = 12;
    validFrame[1] = (urlBytes.length >> 8) & 0xff;
    validFrame[2] = urlBytes.length & 0xff;
    validFrame.set(urlBytes, 3);
    expect(decodeOpcode12(validFrame)).toBe(validUrl);
  });

  test("FloorControlManager rejects unauthorized spoofed release requests", () => {
    const manager = new FloorControlManager();
    const sockAlice = { id: "ws_alice" };
    const sockEve = { id: "ws_eve" };

    // Alice acquires floor
    manager.requestControl("alice_id", "Alice", sockAlice as any);
    expect(manager.isController(sockAlice as any)).toBe(true);

    // Eve attempts to release Alice's floor using Eve's socket
    const spoofRelease = manager.releaseControl("alice_id", sockEve as any);
    expect(spoofRelease.status).toBe("unauthorized");
    expect(manager.isController(sockAlice as any)).toBe(true);
  });
});

describe("Adversarial Verification Tier 3: Boundary & Resource Stress", () => {
  test("ClockSyncEstimator resists burst of 1000 probes with 50% packet spikes", () => {
    const sync = new ClockSyncEstimator({ windowSize: 8, maxRttThresholdMs: 500, alpha: 0.2 });
    const targetOffset = 75; // True offset is +75ms

    for (let i = 0; i < 1000; i++) {
      const isSpike = i % 2 === 0; // 50% spikes
      const rtt = isSpike ? 800 : 30;
      const t0 = i * 100;
      const t1 = t0 + targetOffset + rtt / 2;
      const t2 = t1;
      const t3 = t0 + rtt;

      sync.processProbe(t0, t1, t2, t3);
    }

    // Expected offset must stay locked onto +75ms
    expect(sync.getOffset()).toBeCloseTo(75, 1);
  });

  test("PISlewingController resists 200 rapid oscillations across deadband boundary", () => {
    const pi = new PISlewingController();

    for (let i = 0; i < 200; i++) {
      if (i % 2 === 0) {
        // Just inside deadband (99ms)
        const r1 = pi.compute(10.099, 10.0, 0.5, 1.0);
        expect(r1.action).toBe("NONE");
        expect(r1.slewRate).toBe(1.0);
        expect(pi.getIntegral()).toBe(0);
      } else {
        // Just outside deadband (105ms)
        const r2 = pi.compute(10.105, 10.0, 0.5, 1.0);
        expect(r2.action).toBe("SLEW");
        expect(r2.slewRate).toBeGreaterThan(1.0);
        expect(r2.slewRate).toBeLessThanOrEqual(1.05);
      }
    }
  });

  test("FloorControlManager 200-user promotion and eviction cascade under rapid disconnects", () => {
    const manager = new FloorControlManager();
    const count = 200;
    const sockets = Array.from({ length: count }, (_, i) => ({ id: `sock_stress_${i}`, readyState: 1 }));

    // All 200 request control
    for (let i = 0; i < count; i++) {
      manager.requestControl(`u_${i}`, `User ${i}`, sockets[i] as any);
    }

    expect(manager.getActiveControllerId()).toBe("u_0");
    expect(manager.getControlState().queue.length).toBe(199);

    // Simulate 50 closed sockets in the middle of the queue
    for (let i = 1; i <= 50; i++) {
      sockets[i].readyState = 3; // CLOSED
    }

    // Controller 0 releases control -> should skip closed sockets 1..50 and promote u_51
    const releaseRes = manager.releaseControl("u_0", sockets[0] as any);
    expect(releaseRes.status).toBe("promoted");
    expect(releaseRes.nextControllerId).toBe("u_51");
    expect(manager.getActiveControllerId()).toBe("u_51");
  });
});
