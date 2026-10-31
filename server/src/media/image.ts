import type { CoverExt } from "./storage.ts";

export const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** Detects the image type from its signature; the client's filename and type are ignored. */
export function sniffImage(head: Buffer): CoverExt | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length >= 8 && png.every((byte, i) => head[i] === byte)) return "png";
  if (
    head.length >= 12 &&
    head.toString("latin1", 0, 4) === "RIFF" &&
    head.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}
