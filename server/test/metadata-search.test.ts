import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createProviders, type ProviderName } from "../src/metadata/providers.ts";
import {
  createMetadataSearch,
  MetadataUnavailable,
  type MetadataProvider,
  type ProposalInput,
} from "../src/metadata/search.ts";

const UA = "Player/0.1.0 (http://localhost:3000)";

interface Call {
  url: URL;
  headers: Headers;
}

function jsonFetch(byHost: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    if (!(url.hostname in byHost)) throw new Error(`unexpected host ${url.hostname}`);
    const body = byHost[url.hostname];
    if (body instanceof Response) return body;
    return Response.json(body);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const MUSICBRAINZ = {
  recordings: [
    {
      id: "rec-1",
      title: "Clair de lune",
      "artist-credit": [
        { name: "Claude Debussy", joinphrase: " & " },
        { name: "Orchestre", joinphrase: "" },
      ],
      releases: [{ id: "rel-1", title: "Suite bergamasque", date: "1905-03-01" }],
    },
    { id: "rec-2", title: "Sans album", "artist-credit": [{ name: "X" }] },
  ],
};
const DEEZER = {
  data: [
    {
      title: "Clair de Lune",
      artist: { name: "Claude Debussy" },
      album: {
        title: "Debussy: Piano",
        cover_big: "https://cdn-images.dzcdn.net/images/cover/abc/500x500-000000-80-0-0.jpg",
      },
    },
    {
      title: "Bad cover",
      artist: { name: "Y" },
      album: { title: "Z", cover_big: "https://evil.example/x.jpg" },
    },
  ],
};
const ITUNES = {
  results: [
    {
      trackName: "Clair de lune",
      artistName: "Claude Debussy",
      collectionName: "Debussy: Piano",
      releaseDate: "2010-01-01T08:00:00Z",
      artworkUrl100: "https://is3-ssl.mzstatic.com/image/thumb/Music/x/100x100bb.jpg",
    },
  ],
};

describe("metadata providers", () => {
  it("query MusicBrainz, Deezer and iTunes with the User-Agent and map their answers", async () => {
    const { fetch, calls } = jsonFetch({
      "musicbrainz.org": MUSICBRAINZ,
      "api.deezer.com": DEEZER,
      "itunes.apple.com": ITUNES,
    });
    const providers = createProviders({ fetch, userAgent: UA });
    assert.deepEqual(
      providers.map((p) => p.name),
      ["musicbrainz", "deezer", "itunes"],
    );
    const signal = new AbortController().signal;
    const [mb, dz, it] = await Promise.all(providers.map((p) => p.search("clair de lune", signal)));

    assert.deepEqual(mb, [
      {
        source: "musicbrainz",
        title: "Clair de lune",
        artist: "Claude Debussy & Orchestre",
        album: "Suite bergamasque",
        year: 1905,
        coverUrl: "https://coverartarchive.org/release/rel-1/front-500",
      },
      {
        source: "musicbrainz",
        title: "Sans album",
        artist: "X",
        album: null,
        year: null,
        coverUrl: null,
      },
    ]);
    assert.deepEqual(dz, [
      {
        source: "deezer",
        title: "Clair de Lune",
        artist: "Claude Debussy",
        album: "Debussy: Piano",
        year: null,
        coverUrl: "https://cdn-images.dzcdn.net/images/cover/abc/500x500-000000-80-0-0.jpg",
      },
      // A cover outside the allowed hosts is dropped, the text is kept.
      { source: "deezer", title: "Bad cover", artist: "Y", album: "Z", year: null, coverUrl: null },
    ]);
    assert.deepEqual(it, [
      {
        source: "itunes",
        title: "Clair de lune",
        artist: "Claude Debussy",
        album: "Debussy: Piano",
        year: 2010,
        coverUrl: "https://is3-ssl.mzstatic.com/image/thumb/Music/x/600x600bb.jpg",
      },
    ]);

    for (const call of calls) {
      assert.equal(call.url.protocol, "https:");
      assert.equal(call.headers.get("user-agent"), UA);
    }
    const mbCall = calls.find((c) => c.url.hostname === "musicbrainz.org")!;
    assert.equal(mbCall.url.pathname, "/ws/2/recording");
    assert.equal(mbCall.url.searchParams.get("fmt"), "json");
    assert.equal(mbCall.url.searchParams.get("query"), "clair de lune");
    assert.equal(
      calls.find((c) => c.url.hostname === "api.deezer.com")!.url.searchParams.get("q"),
      "clair de lune",
    );
    const itCall = calls.find((c) => c.url.hostname === "itunes.apple.com")!;
    assert.equal(itCall.url.searchParams.get("term"), "clair de lune");
    assert.equal(itCall.url.searchParams.get("entity"), "song");
  });

  it("escape Lucene syntax for MusicBrainz and fail on an HTTP or API error", async () => {
    const { fetch, calls } = jsonFetch({
      "musicbrainz.org": { recordings: [] },
      "api.deezer.com": { error: { type: "Exception", message: "Quota limit exceeded" } },
      "itunes.apple.com": new Response("busy", { status: 503 }),
    });
    const [mb, dz, it] = createProviders({ fetch, userAgent: UA });
    const signal = new AbortController().signal;
    assert.deepEqual(await mb!.search('AC/DC: "Back" (live)', signal), []);
    assert.equal(calls[0]!.url.searchParams.get("query"), 'AC\\/DC\\: \\"Back\\" \\(live\\)');
    await assert.rejects(dz!.search("x y", signal));
    await assert.rejects(it!.search("x y", signal));
  });
});

function fakeProvider(
  name: ProviderName,
  answer: ProposalInput[] | Error,
): MetadataProvider & { calls: number } {
  const provider = {
    name,
    calls: 0,
    async search() {
      provider.calls += 1;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return provider;
}

const p = (
  source: ProviderName,
  title: string,
  artist: string,
  album: string | null,
  extra: Partial<ProposalInput> = {},
): ProposalInput => ({ source, title, artist, album, year: null, coverUrl: null, ...extra });

function clock() {
  let now = new Date("2026-10-27T10:00:00Z");
  return {
    now: () => now,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe("createMetadataSearch", () => {
  it("aggregates in provider order and de-duplicates by (title, artist, album)", async () => {
    const c = clock();
    const search = createMetadataSearch({
      now: c.now,
      providers: [
        fakeProvider("musicbrainz", [
          p("musicbrainz", "Clair de lune", "Claude Debussy", "Suite bergamasque", { year: 1905 }),
          p("musicbrainz", "Rêverie", "Claude Debussy", null),
        ]),
        fakeProvider("deezer", [
          p("deezer", "  CLAIR DE LUNE ", "claude  debussy", "Suite Bergamasque", {
            coverUrl: "https://cdn-images.dzcdn.net/images/cover/a/500x500.jpg",
          }),
          p("deezer", "Clair de lune", "Claude Debussy", "Autre album"),
        ]),
        fakeProvider("itunes", [p("itunes", "Rêverie", "Claude Debussy", null, { year: 1890 })]),
      ],
    });
    const { proposals, partial } = await search.search("debussy");
    assert.equal(partial, false);
    assert.deepEqual(
      proposals.map(({ id: _id, ...rest }) => rest),
      [
        {
          source: "musicbrainz",
          title: "Clair de lune",
          artist: "Claude Debussy",
          album: "Suite bergamasque",
          year: 1905,
          // The first proposal keeps its text and takes the cover of a duplicate.
          coverUrl: "https://cdn-images.dzcdn.net/images/cover/a/500x500.jpg",
        },
        {
          source: "musicbrainz",
          title: "Rêverie",
          artist: "Claude Debussy",
          album: null,
          year: 1890,
          coverUrl: null,
        },
        {
          source: "deezer",
          title: "Clair de lune",
          artist: "Claude Debussy",
          album: "Autre album",
          year: null,
          coverUrl: null,
        },
      ],
    );
    const ids = new Set(proposals.map((x) => x.id));
    assert.equal(ids.size, 3);
    for (const proposal of proposals) assert.deepEqual(search.getProposal(proposal.id), proposal);
  });

  it("allows one request per second per provider and skips the provider otherwise", async () => {
    const c = clock();
    const mb = fakeProvider("musicbrainz", [p("musicbrainz", "A", "B", null)]);
    const dz = fakeProvider("deezer", [p("deezer", "C", "D", null)]);
    const search = createMetadataSearch({ now: c.now, providers: [mb, dz] });

    assert.equal((await search.search("first")).partial, false);
    c.advance(999);
    const second = await search.search("second");
    assert.equal(second.partial, true);
    assert.deepEqual(second.proposals, []);
    assert.equal(mb.calls, 1);
    assert.equal(dz.calls, 1);

    c.advance(1);
    const third = await search.search("third");
    assert.equal(third.partial, false);
    assert.equal(third.proposals.length, 2);
    assert.equal(mb.calls, 2);
    assert.equal(dz.calls, 2);
  });

  it("marks a failed provider as partial and throws when every provider failed", async () => {
    const c = clock();
    const log: string[] = [];
    const ok = createMetadataSearch({
      now: c.now,
      log: (event) => log.push(event),
      providers: [
        fakeProvider("musicbrainz", new Error("down")),
        fakeProvider("deezer", [p("deezer", "C", "D", null)]),
      ],
    });
    const result = await ok.search("query");
    assert.equal(result.partial, true);
    assert.equal(result.proposals.length, 1);
    assert.deepEqual(log, ["metadata.provider_failed"]);

    const down = createMetadataSearch({
      now: c.now,
      providers: [
        fakeProvider("musicbrainz", new Error("a")),
        fakeProvider("deezer", new Error("b")),
      ],
    });
    await assert.rejects(down.search("query"), MetadataUnavailable);
  });

  it("keeps proposals for 15 minutes", async () => {
    const c = clock();
    const search = createMetadataSearch({
      now: c.now,
      providers: [fakeProvider("musicbrainz", [p("musicbrainz", "A", "B", null)])],
    });
    const [proposal] = (await search.search("query")).proposals;
    assert.ok(proposal);
    c.advance(15 * 60_000 - 1);
    assert.deepEqual(search.getProposal(proposal.id), proposal);
    c.advance(1);
    assert.equal(search.getProposal(proposal.id), null);
    assert.equal(search.getProposal("unknown"), null);
  });
});
