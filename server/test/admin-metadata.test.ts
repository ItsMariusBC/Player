import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import NodeID3 from "node-id3";
import { getTrack } from "../src/catalog/tracks.ts";
import type { MetadataProvider, ProposalInput } from "../src/metadata/search.ts";
import { createTestApp } from "./helpers.ts";
import { imageBytes, writeMp3 } from "./fixtures.ts";

let t: ReturnType<typeof createTestApp>;
let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "admin-metadata-"));
});
afterEach(() => {
  t?.cleanup();
  rmSync(scratch, { recursive: true, force: true });
});

const CSRF = { "X-Requested-With": "player" };
const COVER = "https://cdn-images.dzcdn.net/images/cover/abc/500x500-000000-80-0-0.jpg";

function call(cookie: string, method: string, url: string, body?: unknown) {
  return t.app.request(url, {
    method,
    headers: {
      cookie,
      ...CSRF,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

const provider = (
  name: MetadataProvider["name"],
  answer: ProposalInput[] | Error,
): MetadataProvider => ({
  name,
  async search() {
    if (answer instanceof Error) throw answer;
    return answer;
  },
});

const DEEZER_HIT: ProposalInput = {
  source: "deezer",
  title: "Clair de lune",
  artist: "Claude Debussy",
  album: "Suite bergamasque",
  year: null,
  coverUrl: COVER,
};

/** Cover fetch stub: answers the Deezer cover URL with the given body, records requests. */
function coverFetch(body: Buffer | string) {
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    if (String(input) !== COVER) throw new Error("unexpected url");
    return new Response(typeof body === "string" ? body : new Uint8Array(body), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, urls };
}

function setup(opts: { providers?: MetadataProvider[]; cover?: Buffer | string } = {}) {
  const cover = coverFetch(opts.cover ?? imageBytes("png"));
  t = createTestApp({
    metadata: {
      providers: opts.providers ?? [provider("deezer", [DEEZER_HIT])],
      fetch: cover.fetch,
      resolve: async () => ["93.184.216.34"],
    },
  });
  return cover;
}

async function importMp3(cookie: string): Promise<string> {
  const file = path.join(scratch, `${crypto.randomUUID()}.mp3`);
  writeMp3(file);
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(readFileSync(file))]), "song.mp3");
  const res = await t.app.request("/api/admin/imports", {
    method: "POST",
    body: form,
    headers: { cookie, ...CSRF },
  });
  const { importId } = (await res.json()) as { importId: string };
  await t.imports.idle();
  const row = t.db.prepare("SELECT track_id FROM imports WHERE id = ?").get(importId) as {
    track_id: string;
  };
  return row.track_id;
}

async function searchFirst(cookie: string) {
  const res = await call(cookie, "GET", "/api/admin/metadata/search?q=clair%20de%20lune");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { proposals: { id: string }[]; partial: boolean };
  return body.proposals[0]!.id;
}

const actions = () =>
  (
    t.db.prepare("SELECT action, detail FROM admin_events ORDER BY rowid").all() as {
      action: string;
      detail: string;
    }[]
  ).filter((r) => r.action !== "import");

describe("GET /api/admin/metadata/search", () => {
  it("returns the proposals with an opaque id, for admins only", async () => {
    setup();
    const res = await call(t.loginAs("admin"), "GET", "/api/admin/metadata/search?q=clair");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { proposals: Record<string, unknown>[]; partial: boolean };
    assert.equal(body.partial, false);
    assert.equal(body.proposals.length, 1);
    const { id, ...rest } = body.proposals[0]!;
    assert.equal(typeof id, "string");
    assert.deepEqual(rest, DEEZER_HIT);
    const user = await call(t.loginAs("user"), "GET", "/api/admin/metadata/search?q=clair");
    assert.equal(user.status, 403);
  });

  it("rejects a query outside 2..200 characters with 400", async () => {
    setup();
    const cookie = t.loginAs("admin");
    for (const query of ["", "?q=", "?q=a", "?q=%20%20a%20", `?q=${"x".repeat(201)}`]) {
      const res = await call(cookie, "GET", `/api/admin/metadata/search${query}`);
      assert.equal(res.status, 400, query);
      assert.equal(await errorCode(res), "bad_request");
    }
  });

  it("waits for the provider's next slot when called again within a second", async () => {
    setup();
    const cookie = t.loginAs("admin");
    await call(cookie, "GET", "/api/admin/metadata/search?q=clair");
    const before = t.now().getTime();
    const again = await call(cookie, "GET", "/api/admin/metadata/search?q=clair");
    const body = (await again.json()) as { proposals: unknown[]; partial: boolean; skipped?: true };
    assert.equal(body.partial, false);
    assert.equal(body.skipped, undefined);
    assert.equal(body.proposals.length, 1);
    // The injected sleep advanced the test clock by the whole window.
    assert.equal(t.now().getTime() - before, 1000);
  });

  it("answers skipped when every provider already has a request waiting", async () => {
    let release = () => {};
    const cookieSetup = () => t.loginAs("admin");
    setup();
    t.cleanup();
    const cover = coverFetch(imageBytes("png"));
    t = createTestApp({
      metadata: {
        providers: [provider("deezer", [DEEZER_HIT])],
        fetch: cover.fetch,
        resolve: async () => ["93.184.216.34"],
        sleep: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      },
    });
    const cookie = cookieSetup();
    await call(cookie, "GET", "/api/admin/metadata/search?q=clair");
    const waiting = call(cookie, "GET", "/api/admin/metadata/search?q=clair");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const skipped = await call(cookie, "GET", "/api/admin/metadata/search?q=clair");
    assert.deepEqual(await skipped.json(), { proposals: [], partial: true, skipped: true });
    release();
    const answered = (await (await waiting).json()) as { proposals: unknown[] };
    assert.equal(answered.proposals.length, 1);
  });

  it("answers 502 provider_error when every provider failed, partial when one did", async () => {
    setup({
      providers: [provider("musicbrainz", new Error("x")), provider("deezer", new Error("y"))],
    });
    const res = await call(t.loginAs("admin"), "GET", "/api/admin/metadata/search?q=clair");
    assert.equal(res.status, 502);
    assert.equal(await errorCode(res), "provider_error");
    t.cleanup();
    setup({
      providers: [provider("musicbrainz", new Error("x")), provider("deezer", [DEEZER_HIT])],
    });
    const some = await call(t.loginAs("admin"), "GET", "/api/admin/metadata/search?q=clair");
    assert.equal(some.status, 200);
    assert.equal(((await some.json()) as { partial: boolean }).partial, true);
  });
});

describe("POST /api/admin/tracks/:id/metadata", () => {
  it("applies title, artist, album and the cover to the MP3", async () => {
    const cover = setup();
    const cookie = t.loginAs("admin");
    const id = await importMp3(cookie);
    const before = getTrack(t.db, id)!;
    const proposalId = await searchFirst(cookie);
    t.advance(60_000);
    const res = await call(cookie, "POST", `/api/admin/tracks/${id}/metadata`, {
      proposalId,
      applyCover: true,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.tagsWritten, true);
    assert.equal(body.coverApplied, true);
    assert.equal(body.coverError, undefined);
    assert.equal(body.track.title, "Clair de lune");
    assert.equal(body.track.artist, "Claude Debussy");
    assert.equal(body.track.album, "Suite bergamasque");
    assert.equal(body.track.hasCover, true);
    assert.equal(body.track.updatedAt, t.now().toISOString());
    assert.deepEqual(cover.urls, [COVER]);

    const dir = path.join(t.tempDir, "media", id);
    const tags = NodeID3.read(path.join(dir, "original.mp3"));
    assert.equal(tags.title, "Clair de lune");
    assert.equal(tags.artist, "Claude Debussy");
    const after = getTrack(t.db, id)!;
    assert.notEqual(after.sha256, before.sha256);
    assert.equal(after.coverExt, "png");
    assert.deepEqual(readFileSync(path.join(dir, "cover.png")), imageBytes("png"));
    assert.deepEqual(readdirSync(dir).sort(), ["cover.png", "original.mp3"]);

    const events = actions();
    assert.deepEqual(
      events.map((e) => e.action),
      ["metadata_apply", "cover_replace"],
    );
    assert.deepEqual(JSON.parse(events[0]!.detail), {
      proposalId,
      source: "deezer",
      applyCover: true,
      tagsWritten: true,
    });
  });

  it("leaves the cover alone when applyCover is false", async () => {
    const cover = setup();
    const cookie = t.loginAs("admin");
    const id = await importMp3(cookie);
    const proposalId = await searchFirst(cookie);
    const res = await call(cookie, "POST", `/api/admin/tracks/${id}/metadata`, {
      proposalId,
      applyCover: false,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.coverApplied, false);
    assert.equal(body.track.hasCover, false);
    assert.equal(body.track.title, "Clair de lune");
    assert.deepEqual(cover.urls, []);
  });

  it("applies the text and answers 422 cover_rejected when the image is refused", async () => {
    setup({ cover: "<html>not an image</html>" });
    const cookie = t.loginAs("admin");
    const id = await importMp3(cookie);
    const proposalId = await searchFirst(cookie);
    const res = await call(cookie, "POST", `/api/admin/tracks/${id}/metadata`, {
      proposalId,
      applyCover: true,
    });
    assert.equal(res.status, 422);
    const body = (await res.json()) as any;
    assert.equal(body.error.code, "cover_rejected");
    assert.equal(body.coverApplied, false);
    assert.equal(body.coverError, "cover_rejected");
    assert.equal(body.tagsWritten, true);
    assert.equal(body.track.title, "Clair de lune");
    assert.equal(getTrack(t.db, id)!.coverExt, null);
    assert.deepEqual(readdirSync(path.join(t.tempDir, "media", id)), ["original.mp3"]);
    assert.ok(t.log.some((entry) => entry.event === "metadata.cover_rejected"));
  });

  it("answers 422 cover_rejected, never 500, when storing the cover fails after the text", async () => {
    setup();
    const cookie = t.loginAs("admin");
    const id = await importMp3(cookie);
    const proposalId = await searchFirst(cookie);
    t.storage.replaceCover = async () => {
      throw new Error("disk full");
    };
    const res = await call(cookie, "POST", `/api/admin/tracks/${id}/metadata`, {
      proposalId,
      applyCover: true,
    });
    assert.equal(res.status, 422);
    const body = (await res.json()) as any;
    assert.equal(body.error.code, "cover_rejected");
    assert.equal(body.coverApplied, false);
    assert.equal(body.coverError, "cover_rejected");
    assert.equal(body.track.title, "Clair de lune");
    assert.equal(body.track.hasCover, false);
    assert.equal(getTrack(t.db, id)!.title, "Clair de lune");
    assert.deepEqual(readdirSync(path.join(t.tempDir, "media", id)), ["original.mp3"]);
    const failed = t.log.find((entry) => entry.event === "metadata.cover_failed");
    assert.deepEqual(failed?.data, { trackId: id, error: "Error", message: "disk full" });
  });

  it("answers 404 proposal_expired for an unknown or expired proposal", async () => {
    setup();
    const cookie = t.loginAs("admin");
    const id = await importMp3(cookie);
    const unknown = await call(cookie, "POST", `/api/admin/tracks/${id}/metadata`, {
      proposalId: "nope",
      applyCover: false,
    });
    assert.equal(unknown.status, 404);
    assert.equal(await errorCode(unknown), "proposal_expired");
    const proposalId = await searchFirst(cookie);
    t.advance(15 * 60_000);
    const expired = await call(cookie, "POST", `/api/admin/tracks/${id}/metadata`, {
      proposalId,
      applyCover: false,
    });
    assert.equal(expired.status, 404);
    assert.equal(await errorCode(expired), "proposal_expired");
    assert.equal(getTrack(t.db, id)!.title === "Clair de lune", false);
  });

  it("answers 404 not_found for an unknown track and 400 for a bad body", async () => {
    setup();
    const cookie = t.loginAs("admin");
    const id = await importMp3(cookie);
    const proposalId = await searchFirst(cookie);
    const missing = await call(cookie, "POST", "/api/admin/tracks/nope/metadata", {
      proposalId,
      applyCover: false,
    });
    assert.equal(missing.status, 404);
    assert.equal(await errorCode(missing), "not_found");
    for (const body of [
      {},
      { proposalId },
      { proposalId, applyCover: "yes" },
      { proposalId: 3, applyCover: true },
      { proposalId, applyCover: true, url: COVER },
      [],
    ]) {
      const res = await call(cookie, "POST", `/api/admin/tracks/${id}/metadata`, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(await errorCode(res), "bad_request");
    }
    assert.equal(existsSync(path.join(t.tempDir, "media", id, "cover.png")), false);
  });
});
