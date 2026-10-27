import { afterEach, describe, expect, test } from "bun:test";
import { ApiError } from "../../lib/api";
import {
  createFolder,
  deleteFolder,
  deleteTrack,
  getImport,
  listImports,
  replaceCover,
  updateFolder,
  updateTrack,
  uploadFile,
} from "../../lib/admin-api";

const realFetch = globalThis.fetch;
const realXhr = globalThis.XMLHttpRequest;
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.XMLHttpRequest = realXhr;
});

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(status: number, body?: unknown) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    if (body === undefined) return new Response(null, { status });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

const header = (call: Call, name: string) => new Headers(call.init.headers).get(name);

describe("folder calls", () => {
  test("createFolder posts name and parentId, null included", async () => {
    const folder = { id: "f", name: "Rock", parentId: null, position: 0 };
    const calls = stubFetch(201, { folder });
    expect(await createFolder("Rock", null)).toEqual(folder);
    expect(calls[0]!.url).toBe("/api/admin/folders");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ name: "Rock", parentId: null });
    expect(header(calls[0]!, "Content-Type")).toBe("application/json");
    expect(header(calls[0]!, "X-Requested-With")).toBe("player");
  });

  test("updateFolder patches the given keys only", async () => {
    const calls = stubFetch(200, { folder: { id: "a b", name: "X", parentId: null, position: 0 } });
    await updateFolder("a b", { name: "X" });
    expect(calls[0]!.url).toBe("/api/admin/folders/a%20b");
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ name: "X" });
  });

  test("deleteFolder resolves on 204 and adds force=1 when asked", async () => {
    const calls = stubFetch(204);
    await deleteFolder("f");
    await deleteFolder("f", { force: true });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["DELETE", "/api/admin/folders/f"],
      ["DELETE", "/api/admin/folders/f?force=1"],
    ]);
  });

  test("a 409 rejects with the server code", async () => {
    stubFetch(409, { error: { code: "folder_not_empty", message: "Folder is not empty" } });
    const error = await deleteFolder("f").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("folder_not_empty");
    expect((error as ApiError).message).toBe("Folder is not empty");
  });
});

describe("track calls", () => {
  test("updateTrack returns the track and tagsWritten", async () => {
    const calls = stubFetch(200, { track: { id: "t" }, tagsWritten: true });
    const result = await updateTrack("t", { title: "New", folderId: null });
    expect(result.tagsWritten).toBe(true);
    expect(calls[0]!.url).toBe("/api/admin/tracks/t");
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ title: "New", folderId: null });
  });

  test("deleteTrack resolves on 204", async () => {
    const calls = stubFetch(204);
    expect(await deleteTrack("t")).toBeUndefined();
    expect(calls[0]!.init.method).toBe("DELETE");
  });

  test("replaceCover sends the image as the multipart file field", async () => {
    const calls = stubFetch(200, { hasCover: true });
    const image = new File([new Uint8Array([1, 2, 3])], "c.png", { type: "image/png" });
    expect(await replaceCover("t", image)).toEqual({ hasCover: true });
    expect(calls[0]!.url).toBe("/api/admin/tracks/t/cover");
    expect(calls[0]!.init.method).toBe("POST");
    const body = calls[0]!.init.body as FormData;
    expect((body.get("file") as File).name).toBe("c.png");
    expect(header(calls[0]!, "Content-Type")).toBeNull();
  });
});

describe("import calls", () => {
  test("getImport and listImports", async () => {
    const calls = stubFetch(200, []);
    await getImport("i 1");
    await listImports(10);
    await listImports();
    expect(calls.map((c) => c.url)).toEqual([
      "/api/admin/imports/i%201",
      "/api/admin/imports?limit=10",
      "/api/admin/imports",
    ]);
  });
});

class FakeXhr {
  static last: FakeXhr;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  statusText = "";
  responseText = "";
  withCredentials = false;
  upload = {
    onprogress: null as
      | ((e: { lengthComputable: boolean; loaded: number; total: number }) => void)
      | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.onload?.();
  }
}

describe("uploadFile", () => {
  const file = () => new File([new Uint8Array([1])], "song.flac");

  test("posts the file with the CSRF header and reports progress", async () => {
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    const progress: number[] = [];
    const pending = uploadFile(file(), (ratio) => progress.push(ratio));
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/api/admin/imports");
    expect(xhr.headers["X-Requested-With"]).toBe("player");
    expect(((xhr.body as FormData).get("file") as File).name).toBe("song.flac");
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    xhr.respond(202, { importId: "imp" });
    expect(await pending).toEqual({ importId: "imp" });
    expect(progress).toEqual([0.5, 1]);
  });

  test("rejects with an ApiError from the error envelope", async () => {
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    const pending = uploadFile(file(), () => {});
    FakeXhr.last.respond(413, { error: { code: "too_large", message: "Too big" } });
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(413);
    expect((error as ApiError).code).toBe("too_large");
  });

  test("a network failure rejects with an ApiError", async () => {
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    const pending = uploadFile(file(), () => {});
    FakeXhr.last.onerror?.();
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("network_error");
  });
});
