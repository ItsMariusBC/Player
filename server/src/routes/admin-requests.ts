import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { DatabaseSync } from "node:sqlite";
import { recordAdminEvent } from "../admin/events.ts";
import { requireAdmin, type AuthEnv } from "../auth/middleware.ts";
import { inTransaction } from "../catalog/tx.ts";
import { jsonError } from "../http.ts";
import {
  acceptRequest,
  deleteRequest,
  findRequest,
  listAllRequests,
  toRequestDto,
} from "../requests/repo.ts";

/** Admin view of every song request, mounted at /api/admin/requests. */
export function adminRequestRoutes(
  deps: { db: DatabaseSync; now: () => Date },
  session: MiddlewareHandler<AuthEnv>,
) {
  const { db } = deps;
  const routes = new Hono<AuthEnv>();
  routes.use("*", session, requireAdmin);

  routes.get("/", (c) =>
    c.json({ requests: listAllRequests(db).map((row) => toRequestDto(row, { withUser: true })) }),
  );

  routes.post("/:id/accept", (c) => {
    const id = c.req.param("id");
    const now = deps.now();
    const result = inTransaction(db, () => {
      const accepted = acceptRequest(db, id, now);
      if (accepted && accepted !== "not_pending") {
        recordAdminEvent(
          db,
          {
            userId: c.get("user").id,
            action: "request_accept",
            detail: { requestId: id, requestedBy: accepted.user_id },
          },
          now,
        );
      }
      return accepted;
    });
    if (result === null) return jsonError(c, 404, "request_not_found", "Request not found");
    if (result === "not_pending") {
      return jsonError(c, 409, "request_not_pending", "Request already accepted");
    }
    return c.json({ request: toRequestDto(result, { withUser: true }) });
  });

  routes.delete("/:id", (c) => {
    const id = c.req.param("id");
    const now = deps.now();
    const removed = inTransaction(db, () => {
      const row = findRequest(db, id);
      if (!row || !deleteRequest(db, id)) return false;
      recordAdminEvent(
        db,
        {
          userId: c.get("user").id,
          action: "request_delete",
          detail: { requestId: id, requestedBy: row.user_id, status: row.status },
        },
        now,
      );
      return true;
    });
    if (!removed) return jsonError(c, 404, "request_not_found", "Request not found");
    return c.body(null, 204);
  });

  return routes;
}
