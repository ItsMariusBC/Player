import { afterEach, describe, expect, test } from "bun:test";
import { ApiError, api, fetchDevBypassStatus } from "../../lib/api";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(status: number, body: unknown) {
  const calls: { input: unknown; init: RequestInit | undefined }[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

describe("api", () => {
  test("sends the CSRF header and same-origin credentials", async () => {
    const calls = stubFetch(200, { ok: true });
    await api("/api/session");
    const init = calls[0]!.init!;
    expect(new Headers(init.headers).get("X-Requested-With")).toBe("player");
    expect(new Headers(init.headers).get("Accept")).toBe("application/json");
    expect(init.credentials).toBe("same-origin");
  });

  test("returns the parsed JSON body on success", async () => {
    stubFetch(200, { role: "user" });
    expect(await api<{ role: string }>("/api/session")).toEqual({ role: "user" });
  });

  test("rejects with an ApiError carrying status and code on 401", async () => {
    stubFetch(401, { error: { code: "session_expired", message: "expired" } });
    const err = await api("/api/session").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).code).toBe("session_expired");
  });

  test("rejects a 200 with a non-JSON body as bad_response", async () => {
    globalThis.fetch = (async () =>
      new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    const err = await api("/api/session").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("bad_response");
  });

  test("rejects a 502 text body with an ApiError", async () => {
    globalThis.fetch = (async () =>
      new Response("Bad Gateway", { status: 502 })) as unknown as typeof fetch;
    const err = await api("/api/session").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).code.length).toBeGreaterThan(0);
  });
});

describe("fetchDevBypassStatus", () => {
  test("is false on 404", async () => {
    stubFetch(404, { error: { code: "not_found", message: "no" } });
    expect(await fetchDevBypassStatus()).toBe(false);
  });

  test("is true on 200", async () => {
    stubFetch(200, { bypass: true });
    expect(await fetchDevBypassStatus()).toBe(true);
  });
});

describe("api error details", () => {
  test("ApiError keeps the parsed body as details", async () => {
    stubFetch(403, {
      error: { code: "no_group", message: "no" },
      user: { displayName: "Nobody Test" },
    });
    const err = (await api("/api/session").catch((e: unknown) => e)) as ApiError;
    expect((err.details as { user: { displayName: string } }).user.displayName).toBe("Nobody Test");
  });
});
