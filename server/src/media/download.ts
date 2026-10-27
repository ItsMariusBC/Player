// Server-side download of a file an admin pointed at by URL. The URL is hostile input: HTTPS
// only, no IP-literal host, every resolved address public (checked before each hop and again
// by pinnedFetch at connection time), redirects followed manually, size capped by header and
// by stream, connection and total deadlines. There is deliberately no host allow-list.
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { isIP } from "node:net";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { isPublicAddress, pinnedFetch } from "../metadata/fetch-guard.ts";

export type DownloadDetail =
  | "forbidden_host"
  | "unreachable"
  | "too_large"
  | "timeout"
  | "redirect"
  | `http_${number}`;

export type DownloadResult = { ok: true; bytes: number } | { ok: false; detail: DownloadDetail };

export interface DownloadOptions {
  maxBytes: number;
  /** Every address of the host; one non-public address refuses the download. */
  resolve: (host: string) => Promise<string[]>;
  fetch?: typeof globalThis.fetch;
  /** Until the response headers arrive (default 20 s). */
  connectTimeoutMs?: number;
  /** Whole download, redirects included (default 15 min). */
  timeoutMs?: number;
  maxRedirects?: number;
  /** Abort when no body chunk arrives for this long (default 30 s). */
  idleTimeoutMs?: number;
  userAgent?: string;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

class Refused extends Error {
  detail: DownloadDetail;
  constructor(detail: DownloadDetail) {
    super(`download refused: ${detail}`);
    this.name = "DownloadRefused";
    this.detail = detail;
  }
}

async function checkTarget(
  url: URL,
  resolve: DownloadOptions["resolve"],
  signal: AbortSignal,
): Promise<void> {
  if (url.protocol !== "https:") throw new Refused("forbidden_host");
  if (url.port !== "" && url.port !== "443") throw new Refused("forbidden_host");
  if (url.username || url.password) throw new Refused("forbidden_host");
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0) throw new Refused("forbidden_host");
  let addresses: string[];
  try {
    // A resolver that hangs must not outlive the deadline: race it against the abort signal.
    addresses = await Promise.race([
      resolve(url.hostname),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error("aborted"));
        else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    ]);
  } catch {
    // An abort is reported by the caller (timeout), not as an unreachable host.
    if (signal.aborted) throw new Error("aborted");
    throw new Refused("unreachable");
  }
  if (addresses.length === 0) throw new Refused("unreachable");
  if (addresses.some((address) => !isPublicAddress(address))) throw new Refused("forbidden_host");
}

/** Streams the body to dest, failing once it passes maxBytes. */
async function streamToFile(
  res: Response,
  dest: string,
  maxBytes: number,
  idleMs: number,
  onIdle: () => void,
  signal: AbortSignal,
): Promise<number> {
  const announced = Number(res.headers.get("content-length"));
  if (res.headers.has("content-length") && Number.isFinite(announced) && announced > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new Refused("too_large");
  }
  if (!res.body) throw new Refused("unreachable");
  let total = 0;
  let idle = setTimeout(onIdle, idleMs);
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      clearTimeout(idle);
      idle = setTimeout(onIdle, idleMs);
      total += chunk.length;
      if (total > maxBytes) callback(new Refused("too_large"));
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(res.body as NodeWebStream<Uint8Array>),
      counter,
      createWriteStream(dest),
      { signal },
    );
  } finally {
    clearTimeout(idle);
  }
  return total;
}

/**
 * Downloads url to dest (the caller owns the directory). Never throws: a refusal or failure is
 * `{ ok: false, detail }` and leaves no partial file behind.
 */
export async function downloadToFile(
  url: URL | string,
  dest: string,
  opts: DownloadOptions,
): Promise<DownloadResult> {
  const fetchImpl = opts.fetch ?? pinnedFetch;
  const maxRedirects = opts.maxRedirects ?? 2;
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => {
    timedOut = true;
    controller.abort();
  };
  const total = setTimeout(abort, opts.timeoutMs ?? 15 * 60_000);
  let connect: NodeJS.Timeout | undefined;
  const headers: Record<string, string> = { accept: "*/*" };
  if (opts.userAgent) headers["user-agent"] = opts.userAgent;
  try {
    let current: URL;
    try {
      current = new URL(url);
    } catch {
      return { ok: false, detail: "forbidden_host" };
    }
    let redirects = 0;
    for (;;) {
      await checkTarget(current, opts.resolve, controller.signal);
      connect = setTimeout(abort, opts.connectTimeoutMs ?? 20_000);
      let res: Response;
      try {
        res = await fetchImpl(current, { redirect: "manual", signal: controller.signal, headers });
      } finally {
        clearTimeout(connect);
      }
      if (REDIRECTS.has(res.status)) {
        await res.body?.cancel().catch(() => {});
        const location = res.headers.get("location");
        if (!location || redirects >= maxRedirects) throw new Refused("redirect");
        redirects += 1;
        try {
          current = new URL(location, current);
        } catch {
          throw new Refused("redirect");
        }
        if (current.protocol !== "https:") throw new Refused("redirect");
        continue;
      }
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => {});
        throw new Refused(`http_${res.status}`);
      }
      return {
        ok: true,
        bytes: await streamToFile(
          res,
          dest,
          opts.maxBytes,
          opts.idleTimeoutMs ?? 30_000,
          abort,
          controller.signal,
        ),
      };
    }
  } catch (error) {
    await rm(dest, { force: true }).catch(() => {});
    if (error instanceof Refused) return { ok: false, detail: error.detail };
    return { ok: false, detail: timedOut ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(total);
    clearTimeout(connect);
  }
}
