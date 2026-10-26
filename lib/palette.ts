// lib/palette.ts
// Derives the background gradient of a song from its cover art, unless the
// song declares an explicit `gradient` in the catalogue.
import { Song } from "@/music/data";

export type GradientColors = [string, string, string];

export const DEFAULT_GRADIENT: GradientColors = ["#606080", "#8d7dca", "#212121"];

const SAMPLE_SIZE = 48;
const cache = new Map<string, Promise<GradientColors>>();

export function getSongGradient(song: Song | undefined): Promise<GradientColors> {
  if (!song) return Promise.resolve(DEFAULT_GRADIENT);
  if (song.gradient) return Promise.resolve(song.gradient);
  if (!song.picture) return Promise.resolve(DEFAULT_GRADIENT);

  let pending = cache.get(song.picture);
  if (!pending) {
    pending = extractGradient(song.picture).catch(() => DEFAULT_GRADIENT);
    cache.set(song.picture, pending);
  }
  return pending;
}

type Hsl = { h: number; s: number; l: number };
type Bucket = { r: number; g: number; b: number; weight: number };

async function extractGradient(src: string): Promise<GradientColors> {
  const pixels = await samplePixels(src);
  const buckets = new Map<number, Bucket>();

  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha < 128) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const { s, l } = rgbToHsl(r, g, b);
    // Favour saturated mid-tones; near-black and near-white pixels say little.
    const weight = (0.15 + s) * (1 - Math.abs(l - 0.5) * 1.2);
    if (weight <= 0) continue;

    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 };
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
    bucket.weight += weight;
    buckets.set(key, bucket);
  }

  const ranked = [...buckets.values()]
    .sort((a, b) => b.weight - a.weight)
    .map((bucket) => rgbToHsl(bucket.r / bucket.weight, bucket.g / bucket.weight, bucket.b / bucket.weight));

  if (ranked.length === 0) return DEFAULT_GRADIENT;

  const primary = ranked[0];
  const accent =
    ranked.find((c) => hueDistance(c.h, primary.h) > 35 || Math.abs(c.l - primary.l) > 0.25) ??
    { ...primary, h: (primary.h + 30) % 360 };

  return [
    hslToHex(tune(accent, 0.28, 0.5, MAX_LUMINANCE_ACCENT)),
    hslToHex(tune(primary, 0.3, 0.55, MAX_LUMINANCE_PRIMARY)),
    hslToHex({ ...primary, s: Math.min(primary.s, 0.5), l: 0.09 }),
  ];
}

// The shader lights the scene, so colours end up brighter than specified.
// Relative luminance caps keep white text readable whatever the hue (yellow
// and cyan are far brighter than purple at the same HSL lightness).
const MAX_LUMINANCE_PRIMARY = 0.14;
const MAX_LUMINANCE_ACCENT = 0.2;

/** Keeps a colour readable behind light text: clamps lightness, floors saturation, caps luminance. */
function tune(color: Hsl, minL: number, maxL: number, maxLuminance: number): Hsl {
  const grayscale = color.s < 0.08;
  const tuned: Hsl = {
    h: color.h,
    s: grayscale ? color.s : Math.max(color.s, 0.3),
    l: Math.max(minL, Math.min(maxL, color.l)),
  };
  while (tuned.l > 0.08 && relativeLuminance(tuned) > maxLuminance) tuned.l -= 0.02;
  return tuned;
}

export function relativeLuminance({ h, s, l }: Hsl): number {
  const hex = hslToHex({ h, s, l });
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function samplePixels(src: string): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return reject(new Error("2D context unavailable"));
      ctx.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      try {
        resolve(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error(`Cannot load cover ${src}`));
    image.src = src;
  });
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const toHex = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Linear RGB blend of two gradients, t in 0..1. */
export function interpolateGradient(from: GradientColors, to: GradientColors, t: number): GradientColors {
  const k = Math.max(0, Math.min(1, t));
  const mix = (a: string, b: string) => {
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    return rgbToHex([ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k]);
  };
  return [mix(from[0], to[0]), mix(from[1], to[1]), mix(from[2], to[2])];
}

export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}
