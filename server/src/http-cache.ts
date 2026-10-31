/** True when an If-None-Match header lists the current strong ETag (or `*`). Exact comparison. */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((part) => {
    const candidate = part.trim();
    return candidate === "*" || candidate === etag;
  });
}

/** HTTP-date (IMF-fixdate) of a millisecond timestamp. */
export function httpDate(ms: number): string {
  return new Date(ms).toUTCString();
}
