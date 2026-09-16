/**
 * Shared WebRTC ICE server configuration for WatchParty.
 * Uses public STUN relays for NAT traversal.
 */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

export function getIceServers(): RTCIceServer[] {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_ICE_SERVERS) {
    try {
      return JSON.parse(process.env.NEXT_PUBLIC_ICE_SERVERS);
    } catch {
      // fallback to default
    }
  }
  return DEFAULT_ICE_SERVERS;
}
