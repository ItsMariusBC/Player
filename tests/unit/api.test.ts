import { afterEach, describe, expect, test } from "bun:test";
import { ApiError, api } from "../../lib/api";

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
});
