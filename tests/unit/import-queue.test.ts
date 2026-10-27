import { describe, expect, test } from "bun:test";
import type { ImportDto } from "../../lib/admin-api";
import {
  type LabelContext,
  type QueueState,
  entryLabel,
  failureFromImport,
  importQueueReducer,
  initialQueueState,
  isQueueIdle,
  nextTransfers,
} from "../../lib/import-queue";

const MB = 1024 * 1024;
const file = (key: string, size = 10) => ({ key, filename: `${key}.flac`, size });
const add = (state: QueueState, keys: string[], maxUploadBytes: number | null = null) =>
  importQueueReducer(state, { type: "add", files: keys.map((key) => file(key)), maxUploadBytes });

describe("nextTransfers", () => {
  test("starts at most two uploads, in order", () => {
    const state = add(initialQueueState, ["a", "b", "c"]);
    expect(nextTransfers(state).map((e) => e.key)).toEqual(["a", "b"]);
  });

  test("counts uploads already running", () => {
    let state = add(initialQueueState, ["a", "b", "c"]);
    state = importQueueReducer(state, { type: "start", key: "a" });
    expect(nextTransfers(state).map((e) => e.key)).toEqual(["b"]);
    state = importQueueReducer(state, { type: "start", key: "b" });
    expect(nextTransfers(state)).toEqual([]);
  });

  test("a finished upload frees a slot while the server analyses", () => {
    let state = add(initialQueueState, ["a", "b", "c"]);
    state = importQueueReducer(state, { type: "start", key: "a" });
    state = importQueueReducer(state, { type: "start", key: "b" });
    state = importQueueReducer(state, { type: "uploaded", key: "a", importId: "imp-a" });
    expect(nextTransfers(state).map((e) => e.key)).toEqual(["c"]);
  });

  test("never starts an oversized file", () => {
    const state = importQueueReducer(initialQueueState, {
      type: "add",
      files: [file("big", 3 * MB), file("ok", MB)],
      maxUploadBytes: 2 * MB,
    });
    expect(state.entries[0]?.status).toEqual({ kind: "failed", code: "too_large" });
    expect(nextTransfers(state).map((e) => e.key)).toEqual(["ok"]);
  });

  test("accepts any size when the limit is unknown", () => {
    const state = importQueueReducer(initialQueueState, {
      type: "add",
      files: [file("big", 900 * MB)],
      maxUploadBytes: null,
    });
    expect(nextTransfers(state).map((e) => e.key)).toEqual(["big"]);
  });
});

describe("importQueueReducer", () => {
  test("follows an import to ready", () => {
    let state = add(initialQueueState, ["a"]);
    state = importQueueReducer(state, { type: "start", key: "a" });
    state = importQueueReducer(state, { type: "progress", key: "a", ratio: 0.42 });
    expect(state.entries[0]?.status).toEqual({ kind: "uploading", progress: 0.42 });
    state = importQueueReducer(state, { type: "uploaded", key: "a", importId: "imp" });
    expect(isQueueIdle(state)).toBe(false);
    state = importQueueReducer(state, { type: "ready", key: "a", trackId: "t1" });
    expect(state.entries[0]?.status).toEqual({ kind: "ready", trackId: "t1" });
    expect(isQueueIdle(state)).toBe(true);
  });

  test("ignores progress once the upload is over", () => {
    let state = add(initialQueueState, ["a"]);
    state = importQueueReducer(state, { type: "start", key: "a" });
    state = importQueueReducer(state, { type: "uploaded", key: "a", importId: "imp" });
    const after = importQueueReducer(state, { type: "progress", key: "a", ratio: 1 });
    expect(after).toBe(state);
  });

  test("clear keeps only the entries still in progress", () => {
    let state = add(initialQueueState, ["a", "b"]);
    state = importQueueReducer(state, { type: "failed", key: "a", code: "internal" });
    state = importQueueReducer(state, { type: "clear" });
    expect(state.entries.map((e) => e.key)).toEqual(["b"]);
  });
});

describe("entryLabel", () => {
  const ctx: LabelContext = {
    maxUploadBytes: 200 * MB,
    titleOf: (id: string) => (id === "t1" ? "Hey" : undefined),
  };
  const label = (status: QueueState["entries"][number]["status"], c = ctx) =>
    entryLabel({ ...file("a"), status }, c);

  test("labels every state", () => {
    expect(label({ kind: "pending" })).toBe("Envoi 0 %");
    expect(label({ kind: "uploading", progress: 0.4249 })).toBe("Envoi 42 %");
    expect(label({ kind: "processing", importId: "i" })).toBe("Analyse…");
    expect(label({ kind: "ready", trackId: "t1" })).toBe("Importé");
    expect(label({ kind: "failed", code: "duplicate", trackId: "t1" })).toBe("Doublon de Hey");
    expect(label({ kind: "failed", code: "duplicate", trackId: "gone" })).toBe("Doublon");
    expect(label({ kind: "failed", code: "unsupported_format" })).toBe("Format non reconnu");
    expect(label({ kind: "failed", code: "too_large" })).toBe("Trop volumineux (max 200 Mo)");
    expect(label({ kind: "failed", code: "internal" })).toBe("Erreur serveur");
  });

  test("rounds the limit and drops it when unknown", () => {
    const status = { kind: "failed", code: "too_large" } as const;
    expect(label(status, { ...ctx, maxUploadBytes: 1.6 * MB })).toBe("Trop volumineux (max 2 Mo)");
    expect(label(status, { ...ctx, maxUploadBytes: null })).toBe("Trop volumineux");
  });
});

describe("failureFromImport", () => {
  const dto = (over: Partial<ImportDto>): ImportDto => ({
    id: "imp",
    filename: "a.flac",
    state: "processing",
    error: null,
    trackId: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  });

  test("keeps polling while the server analyses", () => {
    expect(failureFromImport(dto({}))).toBeNull();
  });

  test("ready with its track", () => {
    expect(failureFromImport(dto({ state: "ready", trackId: "t1" }))).toEqual({
      kind: "ready",
      trackId: "t1",
    });
    expect(failureFromImport(dto({ state: "ready" }))).toEqual({
      kind: "failed",
      code: "internal",
    });
  });

  test("reads the server's failure reason", () => {
    const duplicate = failureFromImport(
      dto({ state: "failed", error: { reason: "duplicate", trackId: "t1" } }),
    );
    expect(duplicate).toEqual({ kind: "failed", code: "duplicate", trackId: "t1" });
    expect(
      failureFromImport(dto({ state: "failed", error: { reason: "unsupported_format" } })),
    ).toEqual({ kind: "failed", code: "unsupported_format" });
    expect(failureFromImport(dto({ state: "failed", error: { reason: "internal" } }))).toEqual({
      kind: "failed",
      code: "internal",
    });
    expect(failureFromImport(dto({ state: "failed", error: null }))).toEqual({
      kind: "failed",
      code: "internal",
    });
  });

  test("feeds the duplicate title into the label", () => {
    const status = failureFromImport(
      dto({ state: "failed", error: { reason: "duplicate", trackId: "t1" } }),
    );
    if (!status) throw new Error("expected a final status");
    const label = entryLabel(
      { key: "a", filename: "a.flac", size: 1, status },
      { maxUploadBytes: null, titleOf: (id) => (id === "t1" ? "Hey" : undefined) },
    );
    expect(label).toBe("Doublon de Hey");
  });
});
