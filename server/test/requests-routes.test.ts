import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { MetadataProvider, ProposalInput } from "../src/metadata/search.ts";
import { createTestApp } from "./helpers.ts";

let t: ReturnType<typeof createTestApp>;
afterEach(() => t?.cleanup());

const CSRF = { "X-Requested-With": "player" };
const COVER = "https://cdn-images.dzcdn.net/images/cover/abc/500x500-000000-80-0-0.jpg";

function call(cookie: string, method: string, url: string, body?: unknown, csrf = true) {
  return t.app.request(url, {
    method,
    headers: {
      cookie,
      ...(csrf ? CSRF : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const errorCode = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

const HIT: ProposalInput = {
  source: "deezer",
  title: "Clair de lune",
  artist: "Claude Debussy",
  album: "Suite bergamasque",
  year: 1905,
  coverUrl: COVER,
};

const provider = (answer: ProposalInput[] | Error): MetadataProvider => ({
  name: "deezer",
  async search() {
    if (answer instanceof Error) throw answer;
    return answer;
  },
});

function setup(answer: ProposalInput[] | Error = [HIT]) {
  t = createTestApp({ metadata: { providers: [provider(answer)] } });
  return { user: t.loginAs("user"), admin: t.loginAs("admin") };
}

type Dto = { id: string; status: string; source: string; coverUrl: string | null };
const created = async (res: Response) => ((await res.json()) as { request: Dto }).request;

describe("GET /api/requests/search", () => {
  it("answers any session and validates q", async () => {
    const { user } = setup();
    const res = await call(user, "GET", "/api/requests/search?q=clair");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { proposals: { id: string; title: string }[] };
    assert.equal(body.proposals[0]?.title, "Clair de lune");
    assert.equal((await call(user, "GET", "/api/requests/search?q=a")).status, 400);
    assert.equal(
      (await call(user, "GET", `/api/requests/search?q=${"a".repeat(201)}`)).status,
      400,
    );
    assert.equal(
      (await t.app.request("/api/requests/search?q=clair", { headers: CSRF })).status,
      401,
    );
  });

  it("answers 502 provider_error when every provider fails", async () => {
    const { user } = setup(new Error("down"));
    const res = await call(user, "GET", "/api/requests/search?q=clair");
    assert.equal(res.status, 502);
    assert.equal(await errorCode(res), "provider_error");
  });

  it("is not mounted without metadata, and a proposalId is a bad request", async () => {
    t = createTestApp({ withoutMetadata: true });
    const user = t.loginAs("user");
    const res = await call(user, "GET", "/api/requests/search?q=clair");
    assert.equal(res.status, 404);
    assert.equal(await errorCode(res), "not_found");
    assert.equal((await call(user, "POST", "/api/requests", { proposalId: "x" })).status, 400);
    assert.equal((await call(user, "POST", "/api/requests", { title: "Ok" })).status, 201);
  });
});

describe("POST /api/requests", () => {
  it("creates a manual request", async () => {
    const { user } = setup();
    const res = await call(user, "POST", "/api/requests", { title: "  Gymnopédie  " });
    assert.equal(res.status, 201);
    const request = await created(res);
    assert.equal(request.status, "pending");
    assert.equal(request.source, "manual");
    assert.equal(request.coverUrl, null);
    const list = await call(user, "GET", "/api/requests");
    const body = (await list.json()) as { requests: { title: string; artist: string }[] };
    assert.deepEqual(
      body.requests.map((r) => [r.title, r.artist]),
      [["Gymnopédie", ""]],
    );
  });

  it("creates from a proposal and copies the cover from the cache", async () => {
    const { user } = setup();
    const search = (await (await call(user, "GET", "/api/requests/search?q=clair")).json()) as {
      proposals: { id: string }[];
    };
    const res = await call(user, "POST", "/api/requests", { proposalId: search.proposals[0]?.id });
    assert.equal(res.status, 201);
    const request = await created(res);
    assert.equal(request.source, "deezer");
    assert.equal(request.coverUrl, COVER);
  });

  it("answers 404 proposal_expired for an unknown proposal", async () => {
    const { user } = setup();
    const res = await call(user, "POST", "/api/requests", { proposalId: "nope" });
    assert.equal(res.status, 404);
    assert.equal(await errorCode(res), "proposal_expired");
  });

  it("rejects malformed bodies with 400", async () => {
    const { user } = setup();
    const bodies: unknown[] = [
      {},
      { title: "" },
      { title: "   " },
      { title: "a".repeat(201) },
      { title: "A", artist: "b".repeat(201) },
      { title: "A", artist: 3 },
      { title: "A", extra: 1 },
      { title: "A", proposalId: "x" },
      { proposalId: 3 },
      { proposalId: "x", artist: "y" },
      [],
    ];
    for (const body of bodies) {
      const res = await call(user, "POST", "/api/requests", body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(await errorCode(res), "bad_request");
    }
    const notJson = await t.app.request("/api/requests", {
      method: "POST",
      headers: { cookie: user, ...CSRF, "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(notJson.status, 400);
  });

  it("answers 409 request_duplicate on a normalized title and artist", async () => {
    const { user } = setup();
    await call(user, "POST", "/api/requests", { title: "Clair de Lune", artist: "Debussy" });
    const res = await call(user, "POST", "/api/requests", {
      title: " clair  DE lune ",
      artist: "debussy",
    });
    assert.equal(res.status, 409);
    assert.equal(await errorCode(res), "request_duplicate");
  });

  it("answers 409 request_limit after 20 pending requests", async () => {
    const { user } = setup();
    for (let i = 0; i < 20; i++) {
      assert.equal((await call(user, "POST", "/api/requests", { title: `T${i}` })).status, 201);
    }
    const res = await call(user, "POST", "/api/requests", { title: "One more" });
    assert.equal(res.status, 409);
    assert.equal(await errorCode(res), "request_limit");
  });

  it("requires CSRF and a session", async () => {
    const { user } = setup();
    assert.equal((await call(user, "POST", "/api/requests", { title: "A" }, false)).status, 403);
    const res = await t.app.request("/api/requests", {
      method: "POST",
      headers: { ...CSRF, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "A" }),
    });
    assert.equal(res.status, 401);
  });
});

describe("GET and DELETE /api/requests", () => {
  it("lists only the caller's requests, most recent first", async () => {
    const { user, admin } = setup();
    await call(user, "POST", "/api/requests", { title: "First" });
    t.advance(1000);
    await call(user, "POST", "/api/requests", { title: "Second" });
    await call(admin, "POST", "/api/requests", { title: "Admin's" });
    const body = (await (await call(user, "GET", "/api/requests")).json()) as {
      requests: { title: string; requestedBy?: unknown }[];
    };
    assert.deepEqual(
      body.requests.map((r) => r.title),
      ["Second", "First"],
    );
    assert.equal(body.requests[0]?.requestedBy, undefined);
  });

  it("deletes the caller's pending request with 204", async () => {
    const { user } = setup();
    const request = await created(await call(user, "POST", "/api/requests", { title: "A" }));
    assert.equal((await call(user, "DELETE", `/api/requests/${request.id}`)).status, 204);
    const again = await call(user, "DELETE", `/api/requests/${request.id}`);
    assert.equal(again.status, 404);
    assert.equal(await errorCode(again), "request_not_found");
  });

  it("answers 404 when the request belongs to someone else", async () => {
    const { user, admin } = setup();
    const request = await created(await call(admin, "POST", "/api/requests", { title: "A" }));
    const res = await call(user, "DELETE", `/api/requests/${request.id}`);
    assert.equal(res.status, 404);
    assert.equal(await errorCode(res), "request_not_found");
    const left = (await (await call(admin, "GET", "/api/requests")).json()) as {
      requests: unknown[];
    };
    assert.equal(left.requests.length, 1);
  });

  it("answers 404 for an accepted request", async () => {
    const { user, admin } = setup();
    const request = await created(await call(user, "POST", "/api/requests", { title: "A" }));
    await call(admin, "POST", `/api/admin/requests/${request.id}/accept`);
    assert.equal((await call(user, "DELETE", `/api/requests/${request.id}`)).status, 404);
  });

  it("requires CSRF on delete", async () => {
    const { user } = setup();
    const request = await created(await call(user, "POST", "/api/requests", { title: "A" }));
    assert.equal(
      (await call(user, "DELETE", `/api/requests/${request.id}`, undefined, false)).status,
      403,
    );
  });
});

describe("admin request routes", () => {
  it("refuses a plain user on every route", async () => {
    const { user } = setup();
    const request = await created(await call(user, "POST", "/api/requests", { title: "A" }));
    assert.equal((await call(user, "GET", "/api/admin/requests")).status, 403);
    assert.equal(
      (await call(user, "POST", `/api/admin/requests/${request.id}/accept`)).status,
      403,
    );
    assert.equal((await call(user, "DELETE", `/api/admin/requests/${request.id}`)).status, 403);
  });

  it("lists pending before accepted, with the requester", async () => {
    const { user, admin } = setup();
    const first = await created(await call(user, "POST", "/api/requests", { title: "First" }));
    t.advance(1000);
    await call(admin, "POST", "/api/requests", { title: "Second" });
    await call(admin, "POST", `/api/admin/requests/${first.id}/accept`);
    const res = await call(admin, "GET", "/api/admin/requests");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      requests: { title: string; status: string; requestedBy: { displayName: string } }[];
    };
    assert.deepEqual(
      body.requests.map((r) => [r.title, r.status]),
      [
        ["Second", "pending"],
        ["First", "accepted"],
      ],
    );
    assert.equal(body.requests[1]?.requestedBy.displayName, "User Test");
  });

  it("accepts once, then answers 409 request_not_pending, recording one event", async () => {
    const { user, admin } = setup();
    const request = await created(await call(user, "POST", "/api/requests", { title: "A" }));
    const res = await call(admin, "POST", `/api/admin/requests/${request.id}/accept`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { request: Dto };
    assert.equal(body.request.status, "accepted");
    const again = await call(admin, "POST", `/api/admin/requests/${request.id}/accept`);
    assert.equal(again.status, 409);
    assert.equal(await errorCode(again), "request_not_pending");
    const events = t.db
      .prepare("SELECT action FROM admin_events WHERE action = 'request_accept'")
      .all();
    assert.equal(events.length, 1);
  });

  it("answers 404 request_not_found for an unknown id", async () => {
    const { admin } = setup();
    const accept = await call(admin, "POST", "/api/admin/requests/nope/accept");
    assert.equal(accept.status, 404);
    assert.equal(await errorCode(accept), "request_not_found");
    const del = await call(admin, "DELETE", "/api/admin/requests/nope");
    assert.equal(del.status, 404);
    assert.equal(await errorCode(del), "request_not_found");
  });

  it("deletes any request with 204 and records an event", async () => {
    const { user, admin } = setup();
    const request = await created(await call(user, "POST", "/api/requests", { title: "A" }));
    await call(admin, "POST", `/api/admin/requests/${request.id}/accept`);
    assert.equal((await call(admin, "DELETE", `/api/admin/requests/${request.id}`)).status, 204);
    const events = t.db
      .prepare("SELECT action FROM admin_events WHERE action = 'request_delete'")
      .all();
    assert.equal(events.length, 1);
    const list = (await (await call(admin, "GET", "/api/admin/requests")).json()) as {
      requests: unknown[];
    };
    assert.equal(list.requests.length, 0);
  });

  it("requires CSRF on admin mutations", async () => {
    const { user, admin } = setup();
    const request = await created(await call(user, "POST", "/api/requests", { title: "A" }));
    assert.equal(
      (await call(admin, "POST", `/api/admin/requests/${request.id}/accept`, undefined, false))
        .status,
      403,
    );
    assert.equal(
      (await call(admin, "DELETE", `/api/admin/requests/${request.id}`, undefined, false)).status,
      403,
    );
  });
});
