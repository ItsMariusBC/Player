// Aggregated metadata search: providers in order, one request per second per provider,
// de-duplication by (title, artist, album), proposals cached for 15 minutes behind an opaque
// id so the apply route never takes a URL from the client.
import { randomUUID } from "node:crypto";
import { MAX_COVER_BYTES } from "../media/image.ts";
import type { CoverExt } from "../media/storage.ts";
import { COVER_HOSTS, guardedFetchImage, resolveHost } from "./fetch-guard.ts";

export interface Proposal {
  id: string;
  source: "musicbrainz" | "deezer" | "itunes";
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  coverUrl: string | null;
}

export type ProposalInput = Omit<Proposal, "id">;

export interface MetadataProvider {
  name: Proposal["source"];
  search(q: string, signal: AbortSignal): Promise<ProposalInput[]>;
}

export interface SearchResult {
  proposals: Proposal[];
  /** True when a provider was skipped (rate limit) or failed. */
  partial: boolean;
  /** Present (true) only when every provider was skipped by the rate limit: retry shortly. */
  skipped?: true;
}

export interface MetadataSearch {
  search(q: string): Promise<SearchResult>;
  getProposal(id: string): Proposal | null;
  /** Downloads the proposal's cover through the guard; throws CoverRejected. */
  fetchCover(proposal: Proposal): Promise<{ data: Buffer; ext: CoverExt }>;
}

/** Every provider was tried and none answered. */
export class MetadataUnavailable extends Error {}

export const PROPOSAL_TTL_MS = 15 * 60_000;
export const PROVIDER_INTERVAL_MS = 1000;
export const PROVIDER_TIMEOUT_MS = 5000;
const MAX_PROPOSALS = 30;
const MAX_CACHED = 2000;

const normalize = (text: string | null) =>
  (text ?? "").normalize("NFKC").toLocaleLowerCase("fr").replace(/\s+/g, " ").trim();

export const proposalKey = (p: ProposalInput) =>
  JSON.stringify([normalize(p.title), normalize(p.artist), normalize(p.album)]);

/** Keeps the first proposal of each key; a later duplicate only fills a missing cover or year. */
export function dedupeProposals(inputs: ProposalInput[]): ProposalInput[] {
  const byKey = new Map<string, ProposalInput>();
  for (const input of inputs) {
    const key = proposalKey(input);
    const kept = byKey.get(key);
    if (!kept) {
      byKey.set(key, { ...input });
      continue;
    }
    kept.coverUrl ??= input.coverUrl;
    kept.year ??= input.year;
  }
  return [...byKey.values()];
}

/** Name, message and HTTP status of a provider failure; a response body is never logged. */
function describeFailure(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: "unknown" };
  const status = (error as { status?: unknown }).status;
  return {
    error: error.name,
    message: error.message,
    ...(typeof status === "number" ? { status } : {}),
  };
}

export function createMetadataSearch(deps: {
  providers: MetadataProvider[];
  now: () => Date;
  log?: (event: string, data?: Record<string, unknown>) => void;
  /** Injected into the cover guard; the pinned node:https fetch and DNS lookup by default. */
  fetch?: typeof globalThis.fetch;
  resolve?: (host: string) => Promise<string[]>;
  userAgent?: string;
  timeoutMs?: number;
}): MetadataSearch {
  const lastRequest = new Map<string, number>();
  const cache = new Map<string, { proposal: Proposal; expiresAt: number }>();

  const prune = (now: number) => {
    for (const [id, entry] of cache) if (entry.expiresAt <= now) cache.delete(id);
    // Oldest first (insertion order): a burst of searches cannot grow the cache without bound.
    for (const id of cache.keys()) {
      if (cache.size <= MAX_CACHED) break;
      cache.delete(id);
    }
  };

  async function ask(provider: MetadataProvider, q: string): Promise<ProposalInput[]> {
    const signal = AbortSignal.timeout(deps.timeoutMs ?? PROVIDER_TIMEOUT_MS);
    // A provider that ignores its signal still cannot hold the search past the timeout.
    const timeout = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    });
    return Promise.race([provider.search(q, signal), timeout]);
  }

  return {
    async search(q) {
      const startedAt = deps.now().getTime();
      const attempts = deps.providers.map(async (provider) => {
        const last = lastRequest.get(provider.name);
        if (last !== undefined && startedAt - last < PROVIDER_INTERVAL_MS) {
          deps.log?.("metadata.provider_skipped", { provider: provider.name });
          return { skipped: true, failed: false, results: [] as ProposalInput[] };
        }
        lastRequest.set(provider.name, startedAt);
        try {
          return { skipped: false, failed: false, results: await ask(provider, q) };
        } catch (error) {
          deps.log?.("metadata.provider_failed", {
            provider: provider.name,
            ...describeFailure(error),
          });
          return { skipped: false, failed: true, results: [] as ProposalInput[] };
        }
      });
      const outcomes = await Promise.all(attempts);
      if (outcomes.length > 0 && outcomes.every((o) => o.failed)) throw new MetadataUnavailable();
      if (outcomes.length > 0 && outcomes.every((o) => o.skipped)) {
        return { proposals: [], partial: true, skipped: true };
      }
      const partial = outcomes.some((o) => o.skipped || o.failed);
      const now = deps.now().getTime();
      prune(now);
      const proposals = dedupeProposals(outcomes.flatMap((o) => o.results))
        .slice(0, MAX_PROPOSALS)
        .map((input) => ({ id: randomUUID(), ...input }));
      for (const proposal of proposals) {
        cache.set(proposal.id, { proposal, expiresAt: now + PROPOSAL_TTL_MS });
      }
      return { proposals, partial };
    },

    getProposal(id) {
      const entry = cache.get(id);
      if (!entry) return null;
      if (entry.expiresAt <= deps.now().getTime()) {
        cache.delete(id);
        return null;
      }
      return entry.proposal;
    },

    fetchCover(proposal) {
      if (!proposal.coverUrl) return Promise.reject(new Error("proposal without cover"));
      return guardedFetchImage(new URL(proposal.coverUrl), {
        allowedHosts: COVER_HOSTS,
        maxBytes: MAX_COVER_BYTES,
        resolve: deps.resolve ?? resolveHost,
        fetch: deps.fetch,
        userAgent: deps.userAgent,
        timeoutMs: deps.timeoutMs ?? PROVIDER_TIMEOUT_MS,
      });
    },
  };
}
