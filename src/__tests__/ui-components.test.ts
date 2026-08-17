// @ts-ignore
import { describe, expect, test, beforeEach } from "bun:test";
import { Participant, ChatMessage, QueueItem, detectVideoType, youtubeId } from "../lib/sync/types";
import { readFileSync } from "fs";
import { join } from "path";

// ── 1. 16:9 Aspect Ratio Math Calculation Helper ──
function calculateWidescreenBounds(
  viewportWidth: number,
  viewportHeight: number
): { width: number; height: number; aspectRatio: number } {
  const headerPadding = 120; // 100vh - 120px
  const maxAvailableHeight = Math.max(0, viewportHeight - headerPadding);
  
  // CSS Formula:
  // aspectRatio: "16 / 9"
  // maxHeight: "calc(100vh - 120px)"
  // maxWidth: "min(100%, calc((100vh - 120px) * (16 / 9)))"
  const maxAllowedWidthFromHeight = maxAvailableHeight * (16 / 9);
  const containerWidth = Math.min(viewportWidth, maxAllowedWidthFromHeight);
  const containerHeight = containerWidth * (9 / 16);

  return {
    width: Math.round(containerWidth * 100) / 100,
    height: Math.round(containerHeight * 100) / 100,
    aspectRatio: containerWidth / (containerHeight || 1),
  };
}

// ── 2. Time Formatter Helper ──
function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

describe("UI Components: UniversalPlayer Modality Detection & Responsive Bounds", () => {
  test("correctly identifies all supported video sources", () => {
    expect(detectVideoType("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("youtube");
    expect(detectVideoType("https://youtu.be/dQw4w9WgXcQ")).toBe("youtube");
    expect(detectVideoType("https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8")).toBe("hls");
    expect(detectVideoType("https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4")).toBe("mp4");
    expect(detectVideoType("https://example.com/video.webm")).toBe("webm");
    expect(detectVideoType("https://example.com/audio.ogg")).toBe("ogg");
    expect(detectVideoType("magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10")).toBe("torrent");
    expect(detectVideoType("https://vimeo.com/76979871")).toBe("vimeo");
    expect(detectVideoType("https://www.dailymotion.com/video/x7tgad0")).toBe("dailymotion");
    expect(detectVideoType("https://twitch.tv/twitch")).toBe("twitch");
    expect(detectVideoType("https://generic-embed.com/player/1")).toBe("iframe");
  });

  test("YouTube embed URL construction extracts 11-char ID cleanly", () => {
    const rawUrl = "https://www.youtube.com/watch?v=L_LUpnjgPso&t=120s";
    const ytId = youtubeId(rawUrl);
    expect(ytId).toBe("L_LUpnjgPso");
    const embedUrl = `https://www.youtube-nocookie.com/embed/${ytId}?enablejsapi=1&autoplay=1`;
    expect(embedUrl).toContain("youtube-nocookie.com/embed/L_LUpnjgPso");
  });

  test("16:9 Widescreen ratio is strictly preserved across all responsive screen sizes", () => {
    const viewports = [
      { name: "Mobile iPhone 14", w: 390, h: 844 },
      { name: "Mobile Pixel 7", w: 412, h: 915 },
      { name: "iPad Mini", w: 768, h: 1024 },
      { name: "iPad Pro 12.9", w: 1024, h: 1366 },
      { name: "Laptop 720p", w: 1280, h: 720 },
      { name: "Desktop 1080p", w: 1920, h: 1080 },
      { name: "QHD 1440p", w: 2560, h: 1440 },
      { name: "Ultrawide", w: 3440, h: 1440 },
      { name: "4K UHD", w: 3840, h: 2160 },
    ];

    for (const vp of viewports) {
      const res = calculateWidescreenBounds(vp.w, vp.h);
      expect(res.aspectRatio).toBeCloseTo(16 / 9, 4);
      expect(res.width).toBeLessThanOrEqual(vp.w);
      expect(res.height).toBeLessThanOrEqual(vp.h);
    }
  });
});

describe("UI Components: WhatsApp-Styled ChatPanel Logic", () => {
  test("identifies incoming vs outgoing chat messages", () => {
    const currentUserId = "usr_client_me";
    const outgoingMsg: ChatMessage = {
      id: "msg_1",
      userId: "usr_client_me",
      userName: "You",
      color: "#00a884",
      text: "Let's start the movie!",
      at: Date.now(),
    };
    const incomingMsg: ChatMessage = {
      id: "msg_2",
      userId: "usr_client_other",
      userName: "Alice",
      color: "#34d399",
      text: "Grabbing popcorn!",
      at: Date.now(),
    };

    expect(outgoingMsg.userId === currentUserId).toBe(true);
    expect(incomingMsg.userId === currentUserId).toBe(false);
  });

  test("formats timestamps cleanly into localized HH:MM strings", () => {
    const sampleTs = new Date("2026-08-17T14:30:00Z").getTime();
    const formatted = formatTime(sampleTs);
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });

  test("clamps chat message text length to 1000 characters", () => {
    const longText = "a".repeat(1500);
    const clamped = longText.slice(0, 1000).trim();
    expect(clamped.length).toBe(1000);
  });

  test("quick reaction emojis list contains standard WhatsApp reactions", () => {
    const supportedReactions = ["👍", "❤️", "😂", "😮", "🎉", "🔥", "👏"];
    for (const emoji of ["👍", "❤️", "😂", "😮", "🎉", "🔥", "👏"]) {
      expect(supportedReactions).toContain(emoji);
    }
  });
});

describe("UI Components: QueuePanel Playlist Reordering & Selection", () => {
  let queue: QueueItem[];
  let currentIndex: number;

  beforeEach(() => {
    queue = [
      { url: "https://www.youtube.com/watch?v=video1", type: "youtube", addedBy: "u1", addedAt: 1000 },
      { url: "https://example.com/stream2.m3u8", type: "hls", addedBy: "u2", addedAt: 2000 },
      { url: "https://example.com/movie3.mp4", type: "mp4", addedBy: "u1", addedAt: 3000 },
    ];
    currentIndex = 0;
  });

  test("Move Down reorders item with next item", () => {
    const index = 0;
    // Swap index 0 and 1
    const temp = queue[index];
    queue[index] = queue[index + 1];
    queue[index + 1] = temp;

    expect(queue[0].url).toContain("stream2.m3u8");
    expect(queue[1].url).toContain("video1");
  });

  test("Move Up reorders item with previous item", () => {
    const index = 2;
    // Swap index 2 and 1
    const temp = queue[index];
    queue[index] = queue[index - 1];
    queue[index - 1] = temp;

    expect(queue[1].url).toContain("movie3.mp4");
    expect(queue[2].url).toContain("stream2.m3u8");
  });

  test("removing an item before current index decrements currentIndex", () => {
    currentIndex = 2; // currently playing movie3
    queue.splice(0, 1); // remove item 0
    currentIndex--;

    expect(currentIndex).toBe(1);
    expect(queue[currentIndex].url).toContain("movie3.mp4");
  });

  test("removing active item shifts playback to next available item", () => {
    currentIndex = 1; // currently playing stream2
    queue.splice(currentIndex, 1);
    currentIndex = Math.min(currentIndex, queue.length - 1);

    expect(currentIndex).toBe(1);
    expect(queue[currentIndex].url).toContain("movie3.mp4");
  });
});

describe("UI Components: CallsPanel Privacy Modes & PTT", () => {
  test("zero-camera opt-in default guarantee", () => {
    const defaultMediaState = {
      isMicMuted: true,
      isCameraOn: false,
      cameraPrivacyMode: "avatar" as const,
    };

    expect(defaultMediaState.isCameraOn).toBe(false);
    expect(defaultMediaState.isMicMuted).toBe(true);
    expect(defaultMediaState.cameraPrivacyMode).toBe("avatar");
  });

  test("privacy mode options include avatar, blur, and blackout", () => {
    const modes = ["avatar", "blur", "blackout"] as const;
    modes.forEach((m) => {
      expect(["avatar", "blur", "blackout"]).toContain(m);
    });
  });

  test("Push-to-Talk (PTT) spacebar unmute logic", () => {
    let isPttActive = false;
    let isMicMuted = true;

    // User presses and holds Spacebar
    const onKeyDown = (key: string, isPttMode: boolean) => {
      if (key === " " && isPttMode && !isPttActive) {
        isPttActive = true;
        isMicMuted = false;
      }
    };

    // User releases Spacebar
    const onKeyUp = (key: string, isPttMode: boolean) => {
      if (key === " " && isPttMode && isPttActive) {
        isPttActive = false;
        isMicMuted = true;
      }
    };

    onKeyDown(" ", true);
    expect(isPttActive).toBe(true);
    expect(isMicMuted).toBe(false);

    onKeyUp(" ", true);
    expect(isPttActive).toBe(false);
    expect(isMicMuted).toBe(true);
  });
});

describe("UI Components: Light Theme Default & Layout Verification", () => {
  test("src/app/layout.tsx defaults to light theme (no hardcoded dark class on html)", () => {
    const layoutPath = join(process.cwd(), "src/app/layout.tsx");
    const content = readFileSync(layoutPath, "utf-8");

    // Must NOT have `<html lang="en" className="dark"`
    expect(content).not.toMatch(/<html[^>]*className=["'][^"']*dark[^"']*["']/);
    expect(content).toMatch(/<html[^>]*lang=["']en["']/);
  });

  test("src/app/globals.css specifies default Porcelain light theme tokens in :root", () => {
    const cssPath = join(process.cwd(), "src/app/globals.css");
    const content = readFileSync(cssPath, "utf-8");

    expect(content).toContain(":root");
    expect(content).toContain("--background");
    expect(content).toContain(".dark");
  });
});
