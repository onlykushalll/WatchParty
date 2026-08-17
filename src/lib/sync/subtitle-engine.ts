/**
 * Client-Side Subtitle Ingestion & Dynamic Offset Shifter
 * --------------------------------------------------------
 * Parses .srt and .vtt files locally in the browser with zero uploads,
 * mounting onto HTMLVideoElement TextTrack API with live offset tuning.
 */

export interface SubtitleCue {
  id: string;
  startTime: number; // in seconds
  endTime: number;   // in seconds
  text: string;
}

/**
 * Parses raw SRT string into array of normalized SubtitleCue objects
 */
export function parseSRT(srtContent: string): SubtitleCue[] {
  const normalized = srtContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const rawBlocks = normalized.split(/\n\n+/);
  const cues: SubtitleCue[] = [];

  const timeRegex =
    /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

  for (const block of rawBlocks) {
    const lines = block.split("\n");
    if (lines.length < 2) continue;

    let timeLineIdx = 0;
    if (!timeRegex.test(lines[0]) && lines.length >= 2 && timeRegex.test(lines[1])) {
      timeLineIdx = 1;
    }

    const match = lines[timeLineIdx].match(timeRegex);
    if (!match) continue;

    const startSec =
      parseInt(match[1], 10) * 3600 +
      parseInt(match[2], 10) * 60 +
      parseInt(match[3], 10) +
      parseInt(match[4], 10) / 1000;

    const endSec =
      parseInt(match[5], 10) * 3600 +
      parseInt(match[6], 10) * 60 +
      parseInt(match[7], 10) +
      parseInt(match[8], 10) / 1000;

    const textLines = lines.slice(timeLineIdx + 1).join("\n").trim();
    if (!textLines) continue;

    cues.push({
      id: lines[0] || String(cues.length + 1),
      startTime: startSec,
      endTime: endSec,
      text: textLines,
    });
  }

  return cues;
}

/**
 * Mounts parsed cues into HTMLVideoElement's native TextTrack with active offset
 */
export function mountSubtitleTrack(
  videoEl: HTMLVideoElement,
  cues: SubtitleCue[],
  label: string = "Local Subtitles",
  offsetSec: number = 0,
): TextTrack | null {
  if (typeof window === "undefined" || !videoEl || typeof (videoEl as any).addTextTrack !== "function") {
    return null;
  }

  // Disable existing custom subtitle tracks
  for (let i = videoEl.textTracks.length - 1; i >= 0; i--) {
    const tr = videoEl.textTracks[i];
    if (tr.label === label) {
      tr.mode = "disabled";
    }
  }

  const track = videoEl.addTextTrack("subtitles", label, "en");
  track.mode = "showing";

  for (const c of cues) {
    if (typeof VTTCue !== "undefined") {
      const cue = new VTTCue(
        Math.max(0, c.startTime + offsetSec),
        Math.max(0.1, c.endTime + offsetSec),
        c.text,
      );
      track.addCue(cue);
    }
  }

  return track;
}

/**
 * Live adjusts offset on an active TextTrack without re-parsing
 */
export function applyLiveSubtitleOffset(
  track: TextTrack,
  originalCues: SubtitleCue[],
  deltaSec: number,
): void {
  if (!track || !track.cues || typeof VTTCue === "undefined") return;

  // Clear existing active cues from track
  for (let i = track.cues.length - 1; i >= 0; i--) {
    track.removeCue(track.cues[i]);
  }

  // Re-insert with shifted boundaries
  for (const c of originalCues) {
    const shiftedStart = Math.max(0, c.startTime + deltaSec);
    const shiftedEnd = Math.max(shiftedStart + 0.1, c.endTime + deltaSec);
    track.addCue(new VTTCue(shiftedStart, shiftedEnd, c.text));
  }
}
