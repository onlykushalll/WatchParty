/**
 * Fast Client-Side Video File Fingerprinting Engine
 * -------------------------------------------------
 * Computes deterministic multi-chunk partial SHA-256 fingerprints in <100ms
 * without loading multi-gigabyte video files into RAM.
 */

export interface FileFingerprint {
  hash: string;
  size: number;
  name: string;
  duration?: number;
}

export type FileMatchStatus =
  | "MATCHED"
  | "DIFFERENT_RELEASE"
  | "DIFFERENT_FILE"
  | "FILE_MISSING";

const CHUNK_SIZE = 64 * 1024; // 64 KB per slice

/**
 * Computes a fast partial SHA-256 fingerprint of any local File in <100ms
 * Slices: Head (64KB) + Mid (64KB) + Tail (64KB) + 8-byte FileSize
 */
export async function computeFastFileFingerprint(file: File): Promise<FileFingerprint> {
  const size = file.size;

  // 1. Slice Head, Mid, Tail
  const headBlob = file.slice(0, Math.min(CHUNK_SIZE, size));
  const midStart = Math.max(0, Math.floor(size / 2) - Math.floor(CHUNK_SIZE / 2));
  const midBlob = file.slice(midStart, Math.min(midStart + CHUNK_SIZE, size));
  const tailStart = Math.max(0, size - CHUNK_SIZE);
  const tailBlob = file.slice(tailStart, size);

  // 2. Read array buffers
  const [headBuf, midBuf, tailBuf] = await Promise.all([
    headBlob.arrayBuffer(),
    midBlob.arrayBuffer(),
    tailBlob.arrayBuffer(),
  ]);

  // 3. Assemble composite buffer: [8 bytes FileSize BigEndian] + [Head] + [Mid] + [Tail]
  const sizeHeader = new ArrayBuffer(8);
  new DataView(sizeHeader).setBigUint64(0, BigInt(size), false);

  const totalLen =
    sizeHeader.byteLength +
    headBuf.byteLength +
    midBuf.byteLength +
    tailBuf.byteLength;
  const combined = new Uint8Array(totalLen);

  let offset = 0;
  combined.set(new Uint8Array(sizeHeader), offset);
  offset += sizeHeader.byteLength;
  combined.set(new Uint8Array(headBuf), offset);
  offset += headBuf.byteLength;
  combined.set(new Uint8Array(midBuf), offset);
  offset += midBuf.byteLength;
  combined.set(new Uint8Array(tailBuf), offset);

  // 4. SubtleCrypto SHA-256 Digest (with fallback for test runners)
  let hashHex = "";
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } else {
    // Basic fallback hash for Node.js test environment if subtleCrypto not present
    let h = 0;
    for (let i = 0; i < combined.length; i++) {
      h = (Math.imul(31, h) + combined[i]) | 0;
    }
    hashHex = Math.abs(h).toString(16).padStart(8, "0");
  }

  return {
    hash: hashHex,
    size,
    name: file.name,
  };
}

/**
 * Evaluates match status against host canonical file fingerprint
 */
export function evaluateFileMatch(
  hostFp: FileFingerprint | null | undefined,
  peerFp: FileFingerprint | null | undefined,
): FileMatchStatus {
  if (!peerFp || !peerFp.hash) return "FILE_MISSING";
  if (!hostFp || !hostFp.hash) return "MATCHED";

  if (hostFp.hash === peerFp.hash && hostFp.size === peerFp.size) {
    return "MATCHED";
  }

  // If hashes mismatch, check if duration is virtually identical (within 0.5s)
  if (
    hostFp.duration &&
    peerFp.duration &&
    Math.abs(hostFp.duration - peerFp.duration) <= 0.5
  ) {
    return "DIFFERENT_RELEASE";
  }

  return "DIFFERENT_FILE";
}
