import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { retry } from "../src/retry.ts";

describe("retry", () => {
  it("returns the first success without sleeping", async () => {
    const delays: number[] = [];
    const result = await retry(async () => "ok", {
      attempts: 3,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      sleep: async (ms) => void delays.push(ms),
    });
    assert.equal(result, "ok");
    assert.deepEqual(delays, []);
  });

  it("retries with a doubling delay capped at the maximum", async () => {
    const delays: number[] = [];
    const reported: number[] = [];
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        if (calls < 6) throw new Error("down");
        return calls;
      },
      {
        attempts: 6,
        baseDelayMs: 1000,
        maxDelayMs: 8000,
        sleep: async (ms) => void delays.push(ms),
        onRetry: (_error, attempt) => void reported.push(attempt),
      },
    );
    assert.equal(result, 6);
    assert.deepEqual(delays, [1000, 2000, 4000, 8000, 8000]);
    assert.deepEqual(reported, [1, 2, 3, 4, 5]);
  });

  it("rethrows the last error once attempts are exhausted", async () => {
    let calls = 0;
    await assert.rejects(
      retry(
        async () => {
          calls += 1;
          throw new Error(`fail ${calls}`);
        },
        { attempts: 3, baseDelayMs: 1, maxDelayMs: 2, sleep: async () => {} },
      ),
      /fail 3/,
    );
    assert.equal(calls, 3);
  });
});
