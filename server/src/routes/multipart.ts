import busboy from "busboy";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";

function baseName(raw: string): string {
  const name = [...path.basename(raw.replaceAll("\\", "/"))]
    .filter((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f)
    .join("");
  return (name === "" || name === "." || name === ".." ? "upload" : name).slice(0, 255);
}

export type Received = "stored" | "too_large" | "no_file" | "bad_request";

/**
 * Streams the first part named "file" of a multipart body to target, at most maxBytes.
 * The caller removes target when the outcome is not "stored".
 */
export async function receive(
  request: Request,
  target: string,
  maxBytes: number,
): Promise<{ outcome: Received; filename: string }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!request.body || !/^multipart\/form-data/i.test(contentType)) {
    return { outcome: "bad_request", filename: "" };
  }
  let parser: busboy.Busboy;
  try {
    parser = busboy({
      headers: Object.fromEntries(request.headers),
      // busboy flags a file as truncated once it reaches the limit, so allow one more byte:
      // exactly maxBytes is accepted, maxBytes + 1 is refused.
      limits: { files: 1, fileSize: maxBytes + 1 },
    });
  } catch {
    return { outcome: "bad_request", filename: "" };
  }
  const state = { outcome: "no_file" as Received };
  let filename = "";
  const writes: Promise<void>[] = [];
  const source = Readable.fromWeb(request.body as NodeWebStream<Uint8Array>);
  const done = new Promise<void>((resolve, reject) => {
    parser.on("file", (name, stream, info) => {
      if (name !== "file" || state.outcome !== "no_file") {
        stream.resume();
        return;
      }
      state.outcome = "stored";
      filename = baseName(info.filename);
      stream.on("limit", () => {
        state.outcome = "too_large";
        // Stop reading the rest of the upload.
        source.destroy();
      });
      writes.push(pipeline(stream, createWriteStream(target)));
    });
    parser.on("error", reject);
    parser.on("close", resolve);
  });
  try {
    await Promise.all([pipeline(source, parser), done]);
    await Promise.all(writes);
  } catch {
    await Promise.allSettled(writes);
    return { outcome: state.outcome === "too_large" ? state.outcome : "bad_request", filename };
  }
  return { outcome: state.outcome, filename };
}
