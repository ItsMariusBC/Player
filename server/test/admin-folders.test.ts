import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createTestApp } from "./helpers.ts";

let t: ReturnType<typeof createTestApp>;
afterEach(() => t?.cleanup());

const CSRF = { "X-Requested-With": "player" };

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

async function create(cookie: string, name: string, parentId: string | null = null) {
  const res = await call(cookie, "POST", "/api/admin/folders", { name, parentId });
  assert.equal(res.status, 201);
  return ((await res.json()) as { folder: { id: string } }).folder;
}

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

const events = () =>
  t.db.prepare("SELECT action, folder_id, detail FROM admin_events ORDER BY rowid").all() as {
    action: string;
    folder_id: string | null;
    detail: string;
  }[];

describe("admin folders", () => {
  it("creates folders and returns the tree", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const res = await call(cookie, "POST", "/api/admin/folders", { name: "Rock", parentId: null });
    assert.equal(res.status, 201);
    const { folder } = (await res.json()) as { folder: Record<string, unknown> };
    assert.deepEqual(Object.keys(folder).sort(), ["id", "name", "parentId", "position"]);
    assert.equal(folder["name"], "Rock");
    assert.equal(folder["parentId"], null);
    assert.equal(folder["position"], 0);
    const child = await create(cookie, "Punk", folder["id"] as string);
    const tree = await call(cookie, "GET", "/api/admin/folders");
    assert.equal(tree.status, 200);
    const body = (await tree.json()) as { folders: any[] };
    assert.equal(body.folders.length, 1);
    assert.equal(body.folders[0].name, "Rock");
    assert.equal(body.folders[0].children[0].id, child.id);
  });

  it("maps the repository errors to their codes", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const a = await create(cookie, "A");
    const b = await create(cookie, "B", a.id);

    const conflict = await call(cookie, "POST", "/api/admin/folders", {
      name: "A",
      parentId: null,
    });
    assert.equal(conflict.status, 409);
    assert.equal(await errorCode(conflict), "folder_conflict");

    const cycle = await call(cookie, "PATCH", `/api/admin/folders/${a.id}`, { parentId: b.id });
    assert.equal(cycle.status, 400);
    assert.equal(await errorCode(cycle), "folder_cycle");

    const notEmpty = await call(cookie, "DELETE", `/api/admin/folders/${a.id}`);
    assert.equal(notEmpty.status, 409);
    assert.equal(await errorCode(notEmpty), "folder_not_empty");

    const missing = await call(cookie, "PATCH", "/api/admin/folders/nope", { name: "X" });
    assert.equal(missing.status, 404);
    assert.equal(await errorCode(missing), "not_found");
    const missingParent = await call(cookie, "POST", "/api/admin/folders", {
      name: "X",
      parentId: "nope",
    });
    assert.equal(missingParent.status, 404);
    assert.equal((await call(cookie, "DELETE", "/api/admin/folders/nope")).status, 404);
  });

  it("renames, moves and reorders folders", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const a = await create(cookie, "A");
    const b = await create(cookie, "B");
    const c = await create(cookie, "C");

    const renamed = await call(cookie, "PATCH", `/api/admin/folders/${a.id}`, { name: "Alpha" });
    assert.equal(renamed.status, 200);
    assert.equal(((await renamed.json()) as any).folder.name, "Alpha");

    const reordered = await call(cookie, "PATCH", `/api/admin/folders/${c.id}`, { position: 0 });
    assert.equal(reordered.status, 200);
    assert.equal(((await reordered.json()) as any).folder.position, 0);
    let tree = ((await (await call(cookie, "GET", "/api/admin/folders")).json()) as any).folders;
    assert.deepEqual(
      tree.map((f: any) => [f.name, f.position]),
      [
        ["C", 0],
        ["Alpha", 1],
        ["B", 2],
      ],
    );

    const moved = await call(cookie, "PATCH", `/api/admin/folders/${b.id}`, {
      parentId: c.id,
      name: "Beta",
    });
    assert.equal(moved.status, 200);
    assert.deepEqual(((await moved.json()) as any).folder, {
      id: b.id,
      name: "Beta",
      parentId: c.id,
      position: 0,
    });
    tree = ((await (await call(cookie, "GET", "/api/admin/folders")).json()) as any).folders;
    assert.deepEqual(
      tree.map((f: any) => [f.name, f.position]),
      [
        ["C", 0],
        ["Alpha", 1],
      ],
    );
    assert.equal(tree[0].children[0].name, "Beta");
  });

  it("rolls back a rename when the move in the same request fails", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const a = await create(cookie, "A");
    const b = await create(cookie, "B", a.id);
    const res = await call(cookie, "PATCH", `/api/admin/folders/${a.id}`, {
      name: "Renamed",
      parentId: b.id,
    });
    assert.equal(res.status, 400);
    const tree = ((await (await call(cookie, "GET", "/api/admin/folders")).json()) as any).folders;
    assert.equal(tree[0].name, "A");
    assert.equal(events().filter((e) => e.action === "folder_update").length, 0);
  });

  it("deletes an empty folder and lifts content with force=1", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const a = await create(cookie, "A");
    const b = await create(cookie, "B", a.id);
    const empty = await create(cookie, "Empty");
    assert.equal((await call(cookie, "DELETE", `/api/admin/folders/${empty.id}`)).status, 204);
    const forced = await call(cookie, "DELETE", `/api/admin/folders/${a.id}?force=1`);
    assert.equal(forced.status, 204);
    const tree = ((await (await call(cookie, "GET", "/api/admin/folders")).json()) as any).folders;
    assert.deepEqual(
      tree.map((f: any) => f.id),
      [b.id],
    );
  });

  it("validates the request bodies", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const a = await create(cookie, "A");
    const bad: [string, string, unknown][] = [
      ["POST", "/api/admin/folders", { name: "", parentId: null }],
      ["POST", "/api/admin/folders", { name: "   ", parentId: null }],
      ["POST", "/api/admin/folders", { name: "x".repeat(201), parentId: null }],
      ["POST", "/api/admin/folders", { name: "X", parentId: 3 }],
      ["POST", "/api/admin/folders", { name: "X" }],
      ["POST", "/api/admin/folders", "not an object"],
      ["PATCH", `/api/admin/folders/${a.id}`, { position: -1 }],
      ["PATCH", `/api/admin/folders/${a.id}`, { position: 1.5 }],
      ["PATCH", `/api/admin/folders/${a.id}`, { name: 12 }],
      ["PATCH", `/api/admin/folders/${a.id}`, { color: "red" }],
      ["PATCH", `/api/admin/folders/${a.id}`, {}],
    ];
    for (const [method, url, body] of bad) {
      const res = await call(cookie, method, url, body);
      assert.equal(res.status, 400, `${method} ${JSON.stringify(body)}`);
      assert.equal(await errorCode(res), "bad_request");
    }
    const raw = await t.app.request("/api/admin/folders", {
      method: "POST",
      headers: { cookie, ...CSRF, "Content-Type": "application/json" },
      body: "{not json",
    });
    assert.equal(raw.status, 400);
  });

  it("records one admin event per mutation", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const a = await create(cookie, "A");
    await call(cookie, "PATCH", `/api/admin/folders/${a.id}`, { name: "B" });
    await call(cookie, "DELETE", `/api/admin/folders/${a.id}?force=1`);
    // A refused mutation records nothing.
    await call(cookie, "PATCH", "/api/admin/folders/nope", { name: "C" });
    const rows = events();
    assert.deepEqual(
      rows.map((e) => [e.action, e.folder_id]),
      [
        ["folder_create", a.id],
        ["folder_update", a.id],
        ["folder_delete", a.id],
      ],
    );
    assert.deepEqual(JSON.parse(rows[1]!.detail), { name: "B" });
    assert.deepEqual(JSON.parse(rows[2]!.detail), { force: true });
    const user = t.db.prepare("SELECT id FROM users WHERE subject = 'admin-sub'").get() as {
      id: string;
    };
    const ids = t.db.prepare("SELECT DISTINCT user_id FROM admin_events").all() as {
      user_id: string;
    }[];
    assert.deepEqual(
      ids.map((r) => r.user_id),
      [user.id],
    );
  });

  it("refuses the user role and anonymous visitors", async () => {
    t = createTestApp();
    const admin = t.loginAs("admin");
    const a = await create(admin, "A");
    const cookie = t.loginAs("user");
    const requests: [string, string, unknown][] = [
      ["GET", "/api/admin/folders", undefined],
      ["POST", "/api/admin/folders", { name: "X", parentId: null }],
      ["PATCH", `/api/admin/folders/${a.id}`, { name: "Y" }],
      ["DELETE", `/api/admin/folders/${a.id}`, undefined],
    ];
    for (const [method, url, body] of requests) {
      assert.equal((await call(cookie, method, url, body)).status, 403, `${method} ${url}`);
      assert.equal((await call("", method, url, body)).status, 401, `anon ${method} ${url}`);
    }
    assert.equal(events().length, 1);
  });

  it("requires the CSRF header on mutations", async () => {
    t = createTestApp();
    const cookie = t.loginAs("admin");
    const res = await t.app.request("/api/admin/folders", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "A", parentId: null }),
    });
    assert.equal(res.status, 403);
  });
});
