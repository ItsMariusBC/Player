import fs from "node:fs";

/** Writes a mono 8 kHz 16-bit PCM WAV of silence. */
export function writeWav(path: string, seconds: number): void {
  const rate = 8000;
  const dataBytes = rate * 2 * seconds;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  fs.writeFileSync(path, Buffer.concat([header, Buffer.alloc(dataBytes)]));
}

/** Writes an ID3v2.3 header followed by silent MPEG-1 Layer III frames (128 kbps, 44.1 kHz). */
export function writeMp3(path: string): void {
  const id3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x00], 0);
  fs.writeFileSync(path, Buffer.concat([id3, ...Array.from({ length: 8 }, () => frame)]));
}

/** Writes a frameless FLAC: the marker and a single 44.1 kHz mono 16-bit STREAMINFO block. */
export function writeFlac(path: string): void {
  const info = Buffer.alloc(34);
  info.writeUInt16BE(4096, 0);
  info.writeUInt16BE(4096, 2);
  // Sample rate (20 bits), channels - 1 (3 bits), bits per sample - 1 (5 bits), total samples (36 bits).
  info.writeBigUInt64BE((44100n << 44n) | (15n << 36n), 10);
  const header = Buffer.from([0x80, 0x00, 0x00, 34]);
  fs.writeFileSync(path, Buffer.concat([Buffer.from("fLaC", "latin1"), header, info]));
}

/** A tiny image whose first bytes carry the signature of the given format. */
export function imageBytes(ext: "jpg" | "png" | "webp", size = 64): Buffer {
  const body = Buffer.alloc(size, 0x11);
  if (ext === "jpg") body.set([0xff, 0xd8, 0xff, 0xe0], 0);
  if (ext === "png") body.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  if (ext === "webp") {
    body.write("RIFF", 0, "latin1");
    body.writeUInt32LE(size - 8, 4);
    body.write("WEBP", 8, "latin1");
  }
  return body;
}
