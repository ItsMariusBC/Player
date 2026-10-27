import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LookupAddress } from "node:dns";
import {
  COVER_HOSTS,
  CoverRejected,
  createCheckedLookup,
  guardedFetchImage,
  hostAllowed,
  isPublicAddress,
  pinnedFetch,
} from "../src/metadata/fetch-guard.ts";
import { imageBytes } from "./fixtures.ts";

const MAX = 5 * 1024 * 1024;
const PUBLIC = async () => ["93.184.216.34"];

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch stub answering from a url → response factory map, recording each call. */
function stubFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const image =
  (ext: "jpg" | "png" | "webp" = "jpg", size = 64) =>
  () =>
    new Response(new Uint8Array(imageBytes(ext, size)), { status: 200 });
const redirect = (location: string) => () =>
  new Response(null, { status: 302, headers: { location } });

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof CoverRejected, `expected CoverRejected, got ${String(error)}`);
    return error.reason;
  }
  assert.fail("expected a rejection");
}

const opts = (fetch: typeof globalThis.fetch, resolve = PUBLIC) => ({
  allowedHosts: COVER_HOSTS,
  maxBytes: MAX,
  resolve,
  fetch,
});

describe("guardedFetchImage", () => {
  it("downloads an allowed image and detects its type by signature", async () => {
    const url = "https://cdn-images.dzcdn.net/images/cover/abc/500x500.jpg";
    const { fetch, calls } = stubFetch({ [url]: image("png") });
    const result = await guardedFetchImage(new URL(url), opts(fetch));
    assert.equal(result.ext, "png");
    assert.deepEqual(result.data, imageBytes("png"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.init?.redirect, "manual");
  });

  it("refuses a host outside the list without any request", async () => {
    const { fetch, calls } = stubFetch({});
    let resolved = false;
    const resolve = async () => {
      resolved = true;
      return ["93.184.216.34"];
    };
    const reason = await rejection(
      guardedFetchImage(new URL("https://evil.example/cover.jpg"), opts(fetch, resolve)),
    );
    assert.equal(reason, "host_not_allowed");
    assert.equal(calls.length, 0);
    assert.equal(resolved, false);
  });

  it("refuses plain http, credentials and non-default ports", async () => {
    const { fetch, calls } = stubFetch({});
    for (const url of [
      "http://coverartarchive.org/release/x/front-500",
      "https://user:pw@coverartarchive.org/release/x/front-500",
      "https://coverartarchive.org:8443/release/x/front-500",
    ]) {
      assert.equal(await rejection(guardedFetchImage(new URL(url), opts(fetch))), "bad_url", url);
    }
    assert.equal(calls.length, 0);
  });

  it("refuses a host that resolves to a private address", async () => {
    const url = "https://coverartarchive.org/release/x/front-500";
    for (const addresses of [
      ["10.0.0.5"],
      ["93.184.216.34", "127.0.0.1"],
      ["::ffff:192.168.1.1"],
    ]) {
      const { fetch, calls } = stubFetch({ [url]: image() });
      const reason = await rejection(
        guardedFetchImage(
          new URL(url),
          opts(fetch, async () => addresses),
        ),
      );
      assert.equal(reason, "private_address", addresses.join(","));
      assert.equal(calls.length, 0);
    }
    const { fetch } = stubFetch({});
    assert.equal(
      await rejection(
        guardedFetchImage(
          new URL(url),
          opts(fetch, async () => []),
        ),
      ),
      "dns_failed",
    );
  });

  it("follows two redirects on allowed hosts and refuses a third", async () => {
    const a = "https://coverartarchive.org/release/x/front-500";
    const b = "https://archive.org/download/mbid-x/x-500.jpg";
    const c = "https://ia800100.us.archive.org/1/items/mbid-x/x-500.jpg";
    const d = "https://ia800200.us.archive.org/1/items/mbid-x/x-500.jpg";
    const two = stubFetch({ [a]: redirect(b), [b]: redirect(c), [c]: image("jpg") });
    const resolved: string[] = [];
    const resolve = async (host: string) => {
      resolved.push(host);
      return ["207.241.224.2"];
    };
    assert.equal((await guardedFetchImage(new URL(a), opts(two.fetch, resolve))).ext, "jpg");
    assert.deepEqual(resolved, ["coverartarchive.org", "archive.org", "ia800100.us.archive.org"]);

    const three = stubFetch({ [a]: redirect(b), [b]: redirect(c), [c]: redirect(d), [d]: image() });
    assert.equal(
      await rejection(guardedFetchImage(new URL(a), opts(three.fetch))),
      "too_many_redirects",
    );
    assert.equal(three.calls.length, 3);
  });

  it("re-validates host and resolution at each redirect", async () => {
    const a = "https://coverartarchive.org/release/x/front-500";
    const offList = stubFetch({ [a]: redirect("https://evil.example/x.jpg") });
    assert.equal(
      await rejection(guardedFetchImage(new URL(a), opts(offList.fetch))),
      "host_not_allowed",
    );
    const b = "https://archive.org/download/x.jpg";
    const rebind = stubFetch({ [a]: redirect(b), [b]: image() });
    const resolve = async (host: string) =>
      host === "archive.org" ? ["169.254.169.254"] : PUBLIC();
    assert.equal(
      await rejection(guardedFetchImage(new URL(a), opts(rebind.fetch, resolve))),
      "private_address",
    );
    assert.equal(rebind.calls.length, 1);
  });

  it("refuses a body over the limit, announced or streamed", async () => {
    const url = "https://is1-ssl.mzstatic.com/image/thumb/x/600x600bb.jpg";
    const announced = stubFetch({
      [url]: () =>
        new Response(new Uint8Array(imageBytes("jpg")), {
          status: 200,
          headers: { "content-length": String(MAX + 1) },
        }),
    });
    assert.equal(
      await rejection(guardedFetchImage(new URL(url), opts(announced.fetch))),
      "too_large",
    );

    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    chunk.set(imageBytes("jpg").subarray(0, 4));
    const streamed = stubFetch({
      [url]: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulled += 1;
              if (pulled > 20) controller.close();
              else controller.enqueue(chunk.slice());
            },
          }),
          { status: 200 },
        ),
    });
    assert.equal(
      await rejection(guardedFetchImage(new URL(url), opts(streamed.fetch))),
      "too_large",
    );
    assert.ok(pulled < 10, `stopped reading early (${pulled} chunks)`);
  });

  it("refuses a body that is not a JPEG, PNG or WebP image", async () => {
    const url = "https://e-cdns-images.dzcdn.net/images/cover/x/500x500.jpg";
    const { fetch } = stubFetch({
      [url]: () => new Response("<html>not an image</html>", { status: 200 }),
    });
    assert.equal(await rejection(guardedFetchImage(new URL(url), opts(fetch))), "not_an_image");
  });

  it("refuses an error status and a redirect without location", async () => {
    const url = "https://coverartarchive.org/release/x/front-500";
    const missing = stubFetch({ [url]: () => new Response("nope", { status: 404 }) });
    assert.equal(
      await rejection(guardedFetchImage(new URL(url), opts(missing.fetch))),
      "bad_status",
    );
    const bare = stubFetch({ [url]: () => new Response(null, { status: 302 }) });
    assert.equal(
      await rejection(guardedFetchImage(new URL(url), opts(bare.fetch))),
      "bad_redirect",
    );
  });

  it("maps a network failure to fetch_failed", async () => {
    const fetch = (async () => {
      throw new TypeError("network down");
    }) as typeof globalThis.fetch;
    const url = new URL("https://coverartarchive.org/release/x/front-500");
    assert.equal(await rejection(guardedFetchImage(url, opts(fetch))), "fetch_failed");
  });
});

describe("isPublicAddress", () => {
  it("accepts public addresses and refuses private, reserved and mapped ones", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "2a00:1450:4007::200e"]) {
      assert.equal(isPublicAddress(ip), true, ip);
    }
    for (const ip of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "100.127.255.254",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "192.0.0.8",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "64:ff9b::a00:1",
      "2002:a00:1::1",
      "2001:db8::1",
      "not-an-ip",
    ]) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
    assert.equal(isPublicAddress("::ffff:8.8.8.8"), true);
  });
});

describe("hostAllowed", () => {
  it("matches exact hosts and the listed subdomain suffixes only", () => {
    assert.equal(hostAllowed("coverartarchive.org", COVER_HOSTS), true);
    assert.equal(hostAllowed("archive.org", COVER_HOSTS), true);
    assert.equal(hostAllowed("ia800100.us.archive.org", COVER_HOSTS), true);
    assert.equal(hostAllowed("cdn-images.dzcdn.net", COVER_HOSTS), true);
    assert.equal(hostAllowed("is3-ssl.mzstatic.com", COVER_HOSTS), true);
    assert.equal(hostAllowed("evilarchive.org", COVER_HOSTS), false);
    assert.equal(hostAllowed("coverartarchive.org.evil.example", COVER_HOSTS), false);
    assert.equal(hostAllowed("x.dzcdn.net", COVER_HOSTS), false);
  });
});

describe("pinnedFetch lookup", () => {
  /** A dns.lookup stub answering every host with the given addresses. */
  const stubDns = (addresses: string[]) =>
    ((_host: string, _options: unknown, callback: (e: null, a: LookupAddress[]) => void) =>
      callback(
        null,
        addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
      )) as unknown as Parameters<typeof createCheckedLookup>[0];

  function lookup(addresses: string[], all: boolean) {
    const checked = createCheckedLookup(stubDns(addresses));
    return new Promise<{ error: Error | null; result: unknown }>((resolve) => {
      checked("cdn-images.dzcdn.net", { all }, ((
        error: Error | null,
        address: unknown,
        family?: unknown,
      ) => resolve({ error, result: all ? address : { address, family } })) as never);
    });
  }

  it("refuses a mixed public and private answer in both lookup modes", async () => {
    for (const all of [true, false]) {
      const { error } = await lookup(["93.184.216.34", "10.0.0.1"], all);
      assert.ok(error, `all=${all}`);
    }
  });

  it("passes a public answer through in both lookup modes", async () => {
    const many = await lookup(["93.184.216.34", "2606:4700:4700::1111"], true);
    assert.equal(many.error, null);
    assert.deepEqual(
      (many.result as LookupAddress[]).map((entry) => entry.address),
      ["93.184.216.34", "2606:4700:4700::1111"],
    );
    const one = await lookup(["93.184.216.34"], false);
    assert.equal(one.error, null);
    assert.deepEqual(one.result, { address: "93.184.216.34", family: 4 });
  });

  it("refuses IP-literal hosts before any request", async () => {
    for (const url of [
      "https://127.0.0.1/x.jpg",
      "https://[::1]/x.jpg",
      "https://93.184.216.34/x",
    ]) {
      await assert.rejects(pinnedFetch(url), /IP-literal/, url);
    }
  });
});
