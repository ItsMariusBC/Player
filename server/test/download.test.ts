import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { downloadToFile, type DownloadOptions } from "../src/media/download.ts";

let dir: string;
let dest: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "download-"));
  dest = path.join(dir, "upload.bin");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PUBLIC = async () => ["93.184.216.34"];
const redirect = (location: string | null, status = 302) =>
  new Response(null, { status, headers: location ? { location } : {} });

function opts(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> | Response,
  extra: Partial<DownloadOptions> = {},
): DownloadOptions {
  return {
    maxBytes: 1000,
    resolve: PUBLIC,
    fetch: (async (input: string | URL | Request, init?: RequestInit) =>
      fetchImpl(String(input), init)) as typeof globalThis.fetch,
    userAgent: "Player/test",
    ...extra,
  };
}

describe("downloadToFile", () => {
  it("streams the body to disk and reports the byte count", async () => {
    const seen: { url: string; ua: string | undefined }[] = [];
    const result = await downloadToFile(
      "https://example.com/a.wav",
      dest,
      opts((url, init) => {
        seen.push({ url, ua: ((init?.headers ?? {}) as Record<string, string>)["user-agent"] });
        return new Response(Buffer.from("hello world"));
      }),
    );
    assert.deepEqual(result, { ok: true, bytes: 11 });
    assert.equal(readFileSync(dest, "utf8"), "hello world");
    assert.deepEqual(seen, [{ url: "https://example.com/a.wav", ua: "Player/test" }]);
  });

  it("refuses http, credentials, IP literals and unparsable URLs as forbidden_host", async () => {
    let calls = 0;
    const o = opts(() => {
      calls += 1;
      return new Response("x");
    });
    for (const url of [
      "http://example.com/a",
      "https://user:pw@example.com/a",
      "https://93.184.216.34/a",
      "https://[2606:4700::1]/a",
      "not a url",
    ]) {
      assert.deepEqual(await downloadToFile(url, dest, o), { ok: false, detail: "forbidden_host" });
    }
    assert.equal(calls, 0);
  });

  it("refuses a host with a non-public address before fetching", async () => {
    let calls = 0;
    const result = await downloadToFile(
      "https://internal.example/a",
      dest,
      opts(
        () => {
          calls += 1;
          return new Response("x");
        },
        { resolve: async () => ["93.184.216.34", "10.0.0.5"] },
      ),
    );
    assert.deepEqual(result, { ok: false, detail: "forbidden_host" });
    assert.equal(calls, 0);
  });

  it("re-checks the address after a redirect", async () => {
    const result = await downloadToFile(
      "https://example.com/a",
      dest,
      opts(() => redirect("https://other.example/b"), {
        resolve: async (host) => (host === "other.example" ? ["127.0.0.1"] : ["93.184.216.34"]),
      }),
    );
    assert.deepEqual(result, { ok: false, detail: "forbidden_host" });
  });

  it("maps resolution failures and fetch errors to unreachable", async () => {
    const failing = opts(() => {
      throw new Error("boom");
    });
    assert.deepEqual(await downloadToFile("https://example.com/a", dest, failing), {
      ok: false,
      detail: "unreachable",
    });
    const noDns = opts(() => new Response("x"), {
      resolve: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    assert.deepEqual(await downloadToFile("https://example.com/a", dest, noDns), {
      ok: false,
      detail: "unreachable",
    });
  });

  it("reports http_<status> for non-200 answers", async () => {
    const result = await downloadToFile(
      "https://example.com/a",
      dest,
      opts(() => new Response("nope", { status: 404 })),
    );
    assert.deepEqual(result, { ok: false, detail: "http_404" });
  });

  it("refuses a Content-Length over the cap without reading the body", async () => {
    const result = await downloadToFile(
      "https://example.com/a",
      dest,
      opts(() => new Response("tiny", { headers: { "content-length": "5000" } })),
    );
    assert.deepEqual(result, { ok: false, detail: "too_large" });
    assert.equal(existsSync(dest), false);
  });

  it("aborts a stream that passes the cap and leaves no file", async () => {
    const result = await downloadToFile(
      "https://example.com/a",
      dest,
      opts(() => new Response(new Uint8Array(5000))),
    );
    assert.deepEqual(result, { ok: false, detail: "too_large" });
    assert.equal(existsSync(dest), false);
  });

  it("accepts exactly maxBytes", async () => {
    const result = await downloadToFile(
      "https://example.com/a",
      dest,
      opts(() => new Response(new Uint8Array(1000))),
    );
    assert.deepEqual(result, { ok: true, bytes: 1000 });
  });

  it("follows https redirects up to the limit, then reports redirect", async () => {
    let hops = 0;
    const chain = opts((url) => {
      hops += 1;
      return url.endsWith("/c") ? new Response("end") : redirect(url.endsWith("/a") ? "/b" : "/c");
    });
    assert.deepEqual(await downloadToFile("https://example.com/a", dest, chain), {
      ok: true,
      bytes: 3,
    });
    assert.equal(hops, 3);
    const endless = opts(() => redirect("/again"));
    assert.deepEqual(await downloadToFile("https://example.com/a", dest, endless), {
      ok: false,
      detail: "redirect",
    });
  });

  it("refuses a redirect to http or without a location", async () => {
    assert.deepEqual(
      await downloadToFile(
        "https://example.com/a",
        dest,
        opts(() => redirect("http://example.com/b")),
      ),
      { ok: false, detail: "redirect" },
    );
    assert.deepEqual(
      await downloadToFile(
        "https://example.com/a",
        dest,
        opts(() => redirect(null)),
      ),
      { ok: false, detail: "redirect" },
    );
  });

  it("times out when the connection never answers", async () => {
    const result = await downloadToFile(
      "https://example.com/a",
      dest,
      opts(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
          ),
        { connectTimeoutMs: 20 },
      ),
    );
    assert.deepEqual(result, { ok: false, detail: "timeout" });
  });

  it("times out when the body is too slow overall", async () => {
    const result = await downloadToFile(
      "https://example.com/a",
      dest,
      opts(
        (_url, init) => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(10));
              init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
            },
          });
          return new Response(body);
        },
        { timeoutMs: 30 },
      ),
    );
    assert.deepEqual(result, { ok: false, detail: "timeout" });
    assert.equal(existsSync(dest), false);
  });
});
