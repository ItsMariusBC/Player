export type ByteRange = { start: number; end: number };

/**
 * Parses a single `Range: bytes=...` header against a resource size.
 * Returns null when the header is absent or unusable (serve the full body),
 * "unsatisfiable" when no byte can be served, otherwise an inclusive range.
 * Only the first range of a multi-range header is honoured.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.split(",")[0]?.trim() ?? "");
  if (!match || !header.startsWith("bytes=")) return null;
  const [, rawStart = "", rawEnd = ""] = match;
  if (rawStart === "" && rawEnd === "") return null;
  if (size <= 0) return "unsatisfiable";

  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
