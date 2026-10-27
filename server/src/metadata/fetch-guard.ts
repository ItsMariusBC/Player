// Server-side download of a proposed cover. The URL comes from the proposal cache, never from
// the client, and is still treated as hostile: HTTPS only, explicit host list, every resolved
// address public, manual redirects re-validated at each hop, size cap, image signature.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { lookup as dnsLookupAsync } from "node:dns/promises";
import { request } from "node:https";
import { isIPv4, isIPv6, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { sniffImage } from "../media/image.ts";
import type { CoverExt } from "../media/storage.ts";

/**
 * Hosts the providers' cover URLs point to. An entry starting with "." matches subdomains.
 * - Cover Art Archive: coverartarchive.org redirects to archive.org/download/…, which
 *   redirects to a storage node such as ia800100.us.archive.org.
 * - Deezer: album.cover_big on cdn-images.dzcdn.net (e-cdns-images.dzcdn.net on older rows).
 * - iTunes: artworkUrl100 on is1-ssl … is5-ssl.mzstatic.com.
 */
export const COVER_HOSTS: readonly string[] = [
  "coverartarchive.org",
  "archive.org",
  ".archive.org",
  "cdn-images.dzcdn.net",
  "e-cdns-images.dzcdn.net",
  "is1-ssl.mzstatic.com",
  "is2-ssl.mzstatic.com",
  "is3-ssl.mzstatic.com",
  "is4-ssl.mzstatic.com",
  "is5-ssl.mzstatic.com",
];

export type CoverRejectReason =
  | "bad_url"
  | "host_not_allowed"
  | "dns_failed"
  | "private_address"
  | "fetch_failed"
  | "bad_redirect"
  | "too_many_redirects"
  | "bad_status"
  | "too_large"
  | "not_an_image";

export class CoverRejected extends Error {
  reason: CoverRejectReason;
  constructor(reason: CoverRejectReason) {
    super(`cover rejected: ${reason}`);
    this.name = "CoverRejected";
    this.reason = reason;
  }
}

export interface GuardOptions {
  allowedHosts: readonly string[];
  maxBytes: number;
  /** Every address of the host; one non-public address refuses the download. */
  resolve: (host: string) => Promise<string[]>;
  fetch?: typeof globalThis.fetch;
  maxRedirects?: number;
  timeoutMs?: number;
  userAgent?: string;
}

export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return allowed.some((entry) =>
    entry.startsWith(".") ? name.endsWith(entry) && name.length > entry.length : name === entry,
  );
}

function ipv4Public(a: number, b: number, c: number): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this net, private, loopback, multicast, reserved
  if (a === 100 && b >= 64 && b < 128) return false; // CGNAT
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b < 32) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  return true;
}

function parseIpv4(ip: string): number[] {
  return ip.split(".").map(Number);
}

/** The eight 16-bit groups of an IPv6 address (embedded IPv4 tail and :: expanded). */
function parseIpv6(ip: string): number[] | null {
  let text = ip.replace(/%.*$/, "");
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = parseIpv4(tail[1]!) as [number, number, number, number];
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  const values = groups.map((g) => Number.parseInt(g, 16));
  return values.length === 8 && values.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffff)
    ? values
    : null;
}

/** False for loopback, private, link-local, CGNAT, reserved, unique-local and mapped forms. */
export function isPublicAddress(ip: string): boolean {
  if (isIPv4(ip)) {
    const [a, b, c] = parseIpv4(ip) as [number, number, number];
    return ipv4Public(a, b, c);
  }
  if (!isIPv6(ip)) return false;
  const g = parseIpv6(ip);
  if (!g) return false;
  const embedded = () => ipv4Public(g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8);
  const zeroPrefix = g.slice(0, 5).every((v) => v === 0);
  if (zeroPrefix && g[5] === 0xffff) return embedded(); // IPv4-mapped
  if (zeroPrefix && g[5] === 0) return false; // ::, ::1, IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((v) => v === 0)) return embedded(); // NAT64
  if ((g[0]! & 0xe000) !== 0x2000) return false; // only global unicast 2000::/3
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0)) return false; // documentation, Teredo
  if (g[0] === 0x2002) return false; // 6to4 embeds an arbitrary IPv4
  return true;
}

/** dns.lookup that fails when any address of the host is not public: the socket is pinned. */
const checkedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const list = addresses as unknown as LookupAddress[];
    const first = list[0];
    if (!first || list.some((entry) => !isPublicAddress(entry.address))) {
      return callback(new Error("refused address"), "", 0);
    }
    if (options.all) return (callback as (e: null, a: LookupAddress[]) => void)(null, list);
    return callback(null, first.address, first.family);
  });
};

/**
 * A minimal fetch over node:https whose connection goes through checkedLookup, so a DNS
 * answer that changed after the pre-check still cannot reach a private address.
 */
export const pinnedFetch = ((input: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((resolve, reject) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const req = request(
      url,
      {
        method: "GET",
        headers: (init?.headers ?? {}) as Record<string, string>,
        lookup: checkedLookup,
        signal: init?.signal ?? undefined,
      },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined)
            headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const status = res.statusCode ?? 502;
        const empty = status < 200 || (status >= 300 && status < 400) || status === 204;
        if (empty) res.resume();
        const body = empty ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>);
        resolve(new Response(body, { status: status < 200 ? 502 : status, headers }));
      },
    );
    req.on("error", reject);
    req.end();
  })) as typeof globalThis.fetch;

export async function resolveHost(host: string): Promise<string[]> {
  const entries = await dnsLookupAsync(host, { all: true, verbatim: true });
  return entries.map((entry) => entry.address);
}

async function checkTarget(url: URL, opts: GuardOptions): Promise<void> {
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new CoverRejected("bad_url");
  }
  if (!hostAllowed(url.hostname, opts.allowedHosts)) throw new CoverRejected("host_not_allowed");
  let addresses: string[];
  try {
    addresses = await opts.resolve(url.hostname);
  } catch {
    throw new CoverRejected("dns_failed");
  }
  if (addresses.length === 0) throw new CoverRejected("dns_failed");
  if (addresses.some((address) => !isPublicAddress(address))) {
    throw new CoverRejected("private_address");
  }
}

async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const announced = Number(res.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new CoverRejected("too_large");
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new CoverRejected("too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof CoverRejected) throw error;
    throw new CoverRejected("fetch_failed");
  }
  return Buffer.concat(chunks);
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export async function guardedFetchImage(
  url: URL,
  opts: GuardOptions,
): Promise<{ data: Buffer; ext: CoverExt }> {
  const fetchImpl = opts.fetch ?? pinnedFetch;
  const maxRedirects = opts.maxRedirects ?? 2;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 5000);
  const headers: Record<string, string> = { accept: "image/*" };
  if (opts.userAgent) headers["user-agent"] = opts.userAgent;
  let current = url;
  let redirects = 0;
  for (;;) {
    await checkTarget(current, opts);
    let res: Response;
    try {
      res = await fetchImpl(current, { redirect: "manual", signal, headers });
    } catch {
      throw new CoverRejected("fetch_failed");
    }
    if (REDIRECTS.has(res.status)) {
      await res.body?.cancel().catch(() => {});
      const location = res.headers.get("location");
      if (!location) throw new CoverRejected("bad_redirect");
      if (redirects >= maxRedirects) throw new CoverRejected("too_many_redirects");
      redirects += 1;
      try {
        current = new URL(location, current);
      } catch {
        throw new CoverRejected("bad_redirect");
      }
      continue;
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      throw new CoverRejected("bad_status");
    }
    const data = await readLimited(res, opts.maxBytes);
    const ext = sniffImage(data);
    if (!ext) throw new CoverRejected("not_an_image");
    return { data, ext };
  }
}
