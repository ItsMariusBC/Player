// Free, keyless metadata providers, queried in this order: MusicBrainz (recording search,
// covers from the Cover Art Archive), Deezer (public search, 500 px covers), iTunes Search.
import { COVER_HOSTS, hostAllowed, readLimited } from "./fetch-guard.ts";
import type { MetadataProvider, Proposal, ProposalInput } from "./search.ts";

export type ProviderName = Proposal["source"];

const LIMIT = 10;
/** Ten results never come near it; a larger answer is refused rather than parsed. */
export const MAX_PROVIDER_BYTES = 1024 * 1024;

/** A non-2xx answer; only the status is kept, never the body. */
export class ProviderHttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = "ProviderHttpError";
    this.status = status;
  }
}

interface ProviderDeps {
  fetch: typeof globalThis.fetch;
  /** `Player/<version> (<APP_URL>)`: MusicBrainz refuses anonymous clients. */
  userAgent: string;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const yearOf = (value: unknown): number | null => {
  const match = typeof value === "string" ? /^(\d{4})/.exec(value) : null;
  return match ? Number(match[1]) : null;
};

/** Only an HTTPS URL on an allowed cover host is kept; anything else becomes null. */
function coverUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && hostAllowed(url.hostname, COVER_HOSTS) ? url.href : null;
  } catch {
    return null;
  }
}

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    : [];

async function getJson(deps: ProviderDeps, url: URL, signal: AbortSignal): Promise<unknown> {
  const res = await deps.fetch(url, {
    signal,
    redirect: "error",
    headers: { "user-agent": deps.userAgent, accept: "application/json" },
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new ProviderHttpError(res.status);
  }
  const body = await readLimited(res, MAX_PROVIDER_BYTES);
  return JSON.parse(body.toString("utf8"));
}

function proposal(
  source: ProviderName,
  fields: { title: unknown; artist: unknown; album: unknown; year: number | null; cover: unknown },
): ProposalInput | null {
  const title = text(fields.title);
  const artist = text(fields.artist);
  if (!title || !artist) return null;
  return {
    source,
    title: title.slice(0, 200),
    artist: artist.slice(0, 200),
    album: text(fields.album)?.slice(0, 200) ?? null,
    year: fields.year,
    coverUrl: coverUrl(fields.cover),
  };
}

const present = (p: ProposalInput | null): p is ProposalInput => p !== null;

/** Lucene special characters are escaped so free text never becomes query syntax. */
export const escapeLucene = (q: string) => q.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");

export function musicBrainzProvider(deps: ProviderDeps): MetadataProvider {
  return {
    name: "musicbrainz",
    async search(q, signal) {
      const url = new URL("https://musicbrainz.org/ws/2/recording");
      url.searchParams.set("query", escapeLucene(q));
      url.searchParams.set("fmt", "json");
      url.searchParams.set("limit", String(LIMIT));
      const body = (await getJson(deps, url, signal)) as Record<string, unknown> | null;
      return records(body?.["recordings"])
        .map((rec) => {
          const artist = records(rec["artist-credit"])
            .map(
              (credit) =>
                `${text(credit["name"]) ?? ""}${typeof credit["joinphrase"] === "string" ? credit["joinphrase"] : ""}`,
            )
            .join("");
          const release = records(rec["releases"])[0];
          const releaseId = text(release?.["id"]);
          return proposal("musicbrainz", {
            title: rec["title"],
            artist,
            album: release?.["title"],
            year: yearOf(release?.["date"]) ?? yearOf(rec["first-release-date"]),
            cover: releaseId
              ? `https://coverartarchive.org/release/${encodeURIComponent(releaseId)}/front-500`
              : null,
          });
        })
        .filter(present);
    },
  };
}

export function deezerProvider(deps: ProviderDeps): MetadataProvider {
  return {
    name: "deezer",
    async search(q, signal) {
      const url = new URL("https://api.deezer.com/search");
      url.searchParams.set("q", q);
      url.searchParams.set("limit", String(LIMIT));
      const body = (await getJson(deps, url, signal)) as Record<string, unknown> | null;
      // Deezer reports quota and query errors with a 200 and an error object.
      if (!body || body["error"]) throw new Error("Deezer error");
      return records(body["data"])
        .map((item) => {
          const artist = records([item["artist"]])[0];
          const album = records([item["album"]])[0];
          return proposal("deezer", {
            title: item["title"],
            artist: artist?.["name"],
            album: album?.["title"],
            year: null,
            cover: album?.["cover_big"],
          });
        })
        .filter(present);
    },
  };
}

export function itunesProvider(deps: ProviderDeps): MetadataProvider {
  return {
    name: "itunes",
    async search(q, signal) {
      const url = new URL("https://itunes.apple.com/search");
      url.searchParams.set("term", q);
      url.searchParams.set("media", "music");
      url.searchParams.set("entity", "song");
      url.searchParams.set("limit", String(LIMIT));
      const body = (await getJson(deps, url, signal)) as Record<string, unknown> | null;
      return records(body?.["results"])
        .map((item) => {
          const artwork = text(item["artworkUrl100"]);
          return proposal("itunes", {
            title: item["trackName"],
            artist: item["artistName"],
            album: item["collectionName"],
            year: yearOf(item["releaseDate"]),
            cover: artwork?.replace(/\/100x100bb\./, "/600x600bb.") ?? null,
          });
        })
        .filter(present);
    },
  };
}

export function createProviders(deps: ProviderDeps): MetadataProvider[] {
  return [musicBrainzProvider(deps), deezerProvider(deps), itunesProvider(deps)];
}
