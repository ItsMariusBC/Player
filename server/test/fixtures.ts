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
