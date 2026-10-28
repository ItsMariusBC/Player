// lib/quality.ts
// Playback quality setting: pure helpers plus a protected localStorage read/write.
export type QualitySetting = "auto" | "max" | "light";

export const QUALITY_KEY = "player.quality.v1";

export interface QualityEnv {
  saveData: boolean;
  effectiveType: string | null;
  coarsePointer: boolean;
  viewportWidth: number;
}

const SETTINGS: readonly QualitySetting[] = ["auto", "max", "light"];
const SLOW_TYPES = new Set(["slow-2g", "2g", "3g"]);
const LABELS: Record<QualitySetting, string> = { auto: "Auto", max: "Max", light: "Allégée" };

export function parseQualitySetting(raw: unknown): QualitySetting {
  return SETTINGS.find((setting) => setting === raw) ?? "auto";
}

/** The quality to load: auto picks light on data saver, slow networks, or a small touch screen. */
export function resolveQuality(setting: QualitySetting, env: QualityEnv): "max" | "light" {
  if (setting !== "auto") return setting;
  if (env.saveData) return "light";
  if (env.effectiveType !== null && SLOW_TYPES.has(env.effectiveType)) return "light";
  if (env.coarsePointer && env.viewportWidth <= 768) return "light";
  return "max";
}

export const nextQualitySetting = (setting: QualitySetting): QualitySetting =>
  SETTINGS[(SETTINGS.indexOf(setting) + 1) % SETTINGS.length]!;

export const qualityLabel = (setting: QualitySetting): string => LABELS[setting];

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

export function readQualityEnv(): QualityEnv {
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  return {
    saveData: connection?.saveData === true,
    effectiveType: connection?.effectiveType ?? null,
    coarsePointer:
      typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches,
    viewportWidth: window.innerWidth,
  };
}

export function readQualitySetting(): QualitySetting {
  try {
    return parseQualitySetting(localStorage.getItem(QUALITY_KEY));
  } catch {
    return "auto";
  }
}

export function writeQualitySetting(setting: QualitySetting): void {
  try {
    localStorage.setItem(QUALITY_KEY, setting);
  } catch {
    // Storage unavailable (private mode, quota): the setting just lasts for the session.
  }
}
