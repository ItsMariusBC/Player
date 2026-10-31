import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { DatabaseSync } from "node:sqlite";
import type { AuthEnv } from "../auth/middleware.ts";
import { jsonError, readJsonObject } from "../http.ts";
import { MetadataUnavailable, type MetadataSearch } from "../metadata/search.ts";
import {
  createRequest,
  deleteRequest,
  listUserRequests,
  RequestDuplicate,
  RequestLimit,
  toRequestDto,
  type RequestInput,
} from "../requests/repo.ts";
import { onlyKeys, optionalText, requiredText } from "./catalog-errors.ts";

/** User-facing request routes (any session), mounted at /api/requests. */
export function requestRoutes(
  deps: {
    db: DatabaseSync;
    metadata?: MetadataSearch;
    now: () => Date;
  },
  session: MiddlewareHandler<AuthEnv>,
) {
  const { db, metadata } = deps;
  const routes = new Hono<AuthEnv>();
  routes.use("*", session);

  // The same MetadataSearch instance as the admin search: one shared rate limit per provider.
  if (metadata) {
    routes.get("/search", async (c) => {
      const q = (c.req.query("q") ?? "").trim();
      if (q.length < 2 || q.length > 200) {
        return jsonError(c, 400, "bad_request", "Expected q with 2 to 200 characters");
      }
      try {
        return c.json(await metadata.search(q));
      } catch (error) {
        if (error instanceof MetadataUnavailable) {
          return jsonError(c, 502, "provider_error", "No metadata provider answered");
        }
        throw error;
      }
    });
  }

  routes.get("/", (c) =>
    c.json({
      requests: listUserRequests(db, c.get("user").id).map((row) => toRequestDto(row)),
    }),
  );

  routes.post("/", async (c) => {
    const body = await readJsonObject(c);
    const bad = () =>
      jsonError(c, 400, "bad_request", "Expected { proposalId } or { title, artist? }");
    if (!body) return bad();
    const userId = c.get("user").id;
    let input: RequestInput;

    if ("proposalId" in body) {
      if (!onlyKeys(body, ["proposalId"]) || typeof body["proposalId"] !== "string") return bad();
      if (!metadata) return bad();
      const proposal = metadata.getProposal(body["proposalId"]);
      if (!proposal) {
        return jsonError(c, 404, "proposal_expired", "Proposal unknown or expired, search again");
      }
      input = {
        userId,
        title: proposal.title,
        artist: proposal.artist,
        album: proposal.album,
        year: proposal.year,
        source: proposal.source,
        coverUrl: proposal.coverUrl,
      };
    } else {
      if (!onlyKeys(body, ["title", "artist"])) return bad();
      const title = requiredText(body["title"]);
      const artist = "artist" in body ? optionalText(body["artist"]) : "";
      if (title === null || artist === null) return bad();
      input = { userId, title, artist, album: null, year: null, source: "manual", coverUrl: null };
    }

    try {
      const row = createRequest(db, input, deps.now());
      return c.json({ request: toRequestDto(row) }, 201);
    } catch (error) {
      if (error instanceof RequestDuplicate) {
        return jsonError(c, 409, "request_duplicate", "This request is already pending");
      }
      if (error instanceof RequestLimit) {
        return jsonError(c, 409, "request_limit", "Too many pending requests");
      }
      throw error;
    }
  });

  routes.delete("/:id", (c) => {
    const removed = deleteRequest(db, c.req.param("id"), {
      userId: c.get("user").id,
      pendingOnly: true,
    });
    if (!removed) return jsonError(c, 404, "request_not_found", "Request not found");
    return c.body(null, 204);
  });

  return routes;
}
