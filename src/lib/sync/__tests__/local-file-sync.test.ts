import { describe, expect, it } from "bun:test";
import {
  computeFastFileFingerprint,
  evaluateFileMatch,
  FileFingerprint,
} from "../file-fingerprint";
import {
  parseSRT,
  mountSubtitleTrack,
  applyLiveSubtitleOffset,
} from "../subtitle-engine";

describe("Requirement: Local File Synchronization & Fingerprinting", () => {
  it("computes deterministic fingerprint from file slices", async () => {
    const dummyContent = new Uint8Array(200 * 1024); // 200KB dummy buffer
    for (let i = 0; i < dummyContent.length; i++) {
      dummyContent[i] = (i * 17) % 256;
    }
    const file = new File([dummyContent], "Interstellar.2014.1080p.mkv", {
      type: "video/x-matroska",
    });

    const fp = await computeFastFileFingerprint(file);
    expect(fp.name).toBe("Interstellar.2014.1080p.mkv");
    expect(fp.size).toBe(200 * 1024);
    expect(typeof fp.hash).toBe("string");
    expect(fp.hash.length).toBeGreaterThan(0);
  });

  it("evaluates exact file match for identical hash and size", () => {
    const hostFp: FileFingerprint = {
      hash: "abc123def456",
      size: 104857600,
      name: "Dune.2.2024.mp4",
      duration: 9960.5,
    };
    const peerFp: FileFingerprint = {
      hash: "abc123def456",
      size: 104857600,
      name: "Dune.Part.Two.mp4",
      duration: 9960.5,
    };

    const status = evaluateFileMatch(hostFp, peerFp);
    expect(status).toBe("MATCHED");
  });

  it("detects release variant cut when duration matches within 0.5s but hash differs", () => {
    const hostFp: FileFingerprint = {
      hash: "hash_bluray_remux",
      size: 35000000000,
      name: "Oppenheimer.2023.2160p.mkv",
      duration: 10800.0,
    };
    const peerFp: FileFingerprint = {
      hash: "hash_webrip_1080p",
      size: 4500000000,
      name: "Oppenheimer.2023.1080p.mp4",
      duration: 10800.2, // within 0.5s tolerance
    };

    const status = evaluateFileMatch(hostFp, peerFp);
    expect(status).toBe("DIFFERENT_RELEASE");
  });

  it("detects completely different file when duration differs >0.5s", () => {
    const hostFp: FileFingerprint = {
      hash: "hash_movie_a",
      size: 2000000000,
      name: "Spiderman.1.mp4",
      duration: 7200.0,
    };
    const peerFp: FileFingerprint = {
      hash: "hash_movie_b",
      size: 2000000000,
      name: "Spiderman.2.mp4",
      duration: 7800.0,
    };

    const status = evaluateFileMatch(hostFp, peerFp);
    expect(status).toBe("DIFFERENT_FILE");
  });

  it("returns FILE_MISSING when peer has not selected a file", () => {
    const hostFp: FileFingerprint = {
      hash: "hash_movie_a",
      size: 2000000000,
      name: "Movie.mp4",
    };

    const status = evaluateFileMatch(hostFp, null);
    expect(status).toBe("FILE_MISSING");
  });
});

describe("Requirement: In-Browser Subtitle Parser & Real-Time Offset Shifter", () => {
  const sampleSRT = `
1
00:00:01,000 --> 00:00:04,500
Look to my coming at first light on the fifth day.

2
00:00:05,200 --> 00:00:08,900
At dawn, look to the East.
`;

  it("parses SRT content into structured cues with millisecond accuracy", () => {
    const cues = parseSRT(sampleSRT);
    expect(cues.length).toBe(2);

    expect(cues[0].startTime).toBe(1.0);
    expect(cues[0].endTime).toBe(4.5);
    expect(cues[0].text).toBe("Look to my coming at first light on the fifth day.");

    expect(cues[1].startTime).toBe(5.2);
    expect(cues[1].endTime).toBe(8.9);
    expect(cues[1].text).toBe("At dawn, look to the East.");
  });

  it("handles malformed newlines and trailing whitespace safely", () => {
    const messySRT = "\r\n1\r\n00:01:10,500 --> 00:01:15,000\r\nHello World!\r\n\r\n";
    const cues = parseSRT(messySRT);
    expect(cues.length).toBe(1);
    expect(cues[0].startTime).toBe(70.5);
    expect(cues[0].endTime).toBe(75.0);
    expect(cues[0].text).toBe("Hello World!");
  });
});
