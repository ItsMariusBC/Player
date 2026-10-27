import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { rm, writeFile } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import {
  applyCoverFile,
  applyTrackPatch,
  readyTrack,
  TrackNotFound,
  type TrackPatch,
  type WithTrackLock,
} from "../admin/track-edit.ts";
import { requireAdmin, type AuthEnv } from "../auth/middleware.ts";
import { toTrackDto } from "../catalog/tracks.ts";
import type { TrackRecord } from "../catalog/types.ts";
import { jsonError, readJsonObject } from "../http.ts";
import type { CoverExt, MediaStorage } from "../media/storage.ts";
import { CoverRejected } from "../metadata/fetch-guard.ts";
import { MetadataUnavailable, type MetadataSearch } from "../metadata/search.ts";
import { catalogErrorResponse, onlyKeys } from "./catalog-errors.ts";

interface MetadataDeps {
  db: DatabaseSync;
  storage: MediaStorage;
  metadata: MetadataSearch;
  trackLocks: WithTrackLock;
  now: () => Date;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

/** GET /search?q= behind the admin session: mounted at /api/admin/metadata. */
export function adminMetadataRoutes(
  deps: Pick<MetadataDeps, "metadata">,
  session: MiddlewareHandler<AuthEnv>,
) {
  const routes = new Hono<AuthEnv>();
  routes.use("*", session, requireAdmin);

  routes.get("/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 2 || q.length > 200) {
      return jsonError(c, 400, "bad_request", "Expected q with 2 to 200 characters");
    }
    try {
      return c.json(await deps.metadata.search(q));
    } catch (error) {
      if (error instanceof MetadataUnavailable) {
        return jsonError(c, 502, "provider_error", "No metadata provider answered");
      }
      throw error;
    }
  });

  return routes;
}

const APPLY_KEYS = ["proposalId", "applyCover"] as const;

/**
 * Adds POST /:id/metadata to the track routes (already behind the admin session), so the
 * apply shares their path and lock. Text through the PATCH sequence, then the cover through
 * the cover route's sequence; the cover URL only ever comes from the proposal cache.
 */
export function addMetadataApplyRoute(routes: Hono<AuthEnv>, deps: MetadataDeps) {
  const { db, storage, metadata } = deps;

  routes.post("/:id/metadata", async (c) => {
    const id = c.req.param("id");
    const body = await readJsonObject(c);
    if (
      !body ||
      !onlyKeys(body, APPLY_KEYS) ||
      typeof body["proposalId"] !== "string" ||
      typeof body["applyCover"] !== "boolean"
    ) {
      return jsonError(c, 400, "bad_request", "Expected { proposalId, applyCover }");
    }
    const proposalId = body["proposalId"];
    const applyCover = body["applyCover"];
    if (!readyTrack(db, id)) return jsonError(c, 404, "not_found", "Track not found");
    const proposal = metadata.getProposal(proposalId);
    if (!proposal) {
      return jsonError(c, 404, "proposal_expired", "Proposal unknown or expired, search again");
    }

    // Downloaded before taking the lock: a slow provider host does not hold the track.
    let image: { data: Buffer; ext: CoverExt } | null = null;
    let coverRejected = false;
    if (applyCover && proposal.coverUrl) {
      try {
        image = await metadata.fetchCover(proposal);
      } catch (error) {
        coverRejected = true;
        deps.log?.("metadata.cover_rejected", {
          trackId: id,
          source: proposal.source,
          reason: error instanceof CoverRejected ? error.reason : "unknown",
        });
      }
    }

    // A proposal without album keeps the track's album rather than clearing it.
    const patch: TrackPatch = { title: proposal.title, artist: proposal.artist };
    if (proposal.album !== null) patch.album = proposal.album;
    const userId = c.get("user").id;

    return deps.trackLocks(id, async () => {
      let track: TrackRecord;
      let tagsWritten: boolean;
      try {
        ({ track, tagsWritten } = await applyTrackPatch(deps, id, patch, {
          userId,
          action: "metadata_apply",
          detail: { proposalId, source: proposal.source, applyCover },
        }));
      } catch (error) {
        if (error instanceof TrackNotFound)
          return jsonError(c, 404, "not_found", "Track not found");
        return catalogErrorResponse(c, error);
      }
      let coverApplied = false;
      if (image) {
        const file = storage.scratchPath(id);
        try {
          await writeFile(file, image.data);
          track = await applyCoverFile(deps, id, file, image.ext, {
            userId,
            action: "cover_replace",
            detail: { ext: image.ext, proposalId, source: proposal.source },
          });
          coverApplied = true;
        } catch (error) {
          if (error instanceof TrackNotFound) {
            return jsonError(c, 404, "not_found", "Track not found");
          }
          throw error;
        } finally {
          await rm(file, { force: true });
        }
      }
      const result = { track: toTrackDto(track), tagsWritten, coverApplied };
      if (coverRejected) {
        // The text is applied; the error envelope says the cover was not.
        return c.json(
          {
            error: { code: "cover_rejected", message: "The proposed cover was refused" },
            ...result,
            coverError: "cover_rejected",
          },
          422,
        );
      }
      return c.json(result);
    });
  });
}
