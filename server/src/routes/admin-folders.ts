import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { DatabaseSync } from "node:sqlite";
import { recordAdminEvent } from "../admin/events.ts";
import { requireAdmin, type AuthEnv } from "../auth/middleware.ts";
import {
  createFolder,
  deleteFolder,
  getFolder,
  listFolders,
  moveFolder,
  renameFolder,
} from "../catalog/folders.ts";
import { buildFolderTree } from "../catalog/tree.ts";
import { inTransaction } from "../catalog/tx.ts";
import { NotFoundError, type FolderRecord } from "../catalog/types.ts";
import { jsonError, readJsonObject } from "../http.ts";
import {
  catalogErrorResponse,
  isNullableId,
  isPosition,
  onlyKeys,
  requiredText,
} from "./catalog-errors.ts";

const folderDto = (f: FolderRecord) => ({
  id: f.id,
  name: f.name,
  parentId: f.parentId,
  position: f.position,
});

export function adminFolderRoutes(
  deps: { db: DatabaseSync; now: () => Date },
  session: MiddlewareHandler<AuthEnv>,
) {
  const { db } = deps;
  const routes = new Hono<AuthEnv>();
  routes.use("*", session, requireAdmin);

  routes.get("/", (c) => c.json({ folders: buildFolderTree(listFolders(db)) }));

  routes.post("/", async (c) => {
    const body = await readJsonObject(c);
    const name = requiredText(body?.["name"]);
    const parentId = body?.["parentId"];
    if (
      !body ||
      !onlyKeys(body, ["name", "parentId"]) ||
      name === null ||
      !isNullableId(parentId)
    ) {
      return jsonError(c, 400, "bad_request", "Expected { name, parentId }");
    }
    const now = deps.now();
    try {
      const folder = inTransaction(db, () => {
        const created = createFolder(db, { name, parentId }, now);
        recordAdminEvent(
          db,
          {
            userId: c.get("user").id,
            action: "folder_create",
            folderId: created.id,
            detail: { name, parentId },
          },
          now,
        );
        return created;
      });
      return c.json({ folder: folderDto(folder) }, 201);
    } catch (error) {
      return catalogErrorResponse(c, error);
    }
  });

  routes.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await readJsonObject(c);
    if (
      !body ||
      Object.keys(body).length === 0 ||
      !onlyKeys(body, ["name", "parentId", "position"])
    ) {
      return jsonError(c, 400, "bad_request", "Expected { name?, parentId?, position? }");
    }
    const patch: { name?: string; parentId?: string | null; position?: number } = {};
    if ("name" in body) {
      const name = requiredText(body["name"]);
      if (name === null) return jsonError(c, 400, "bad_request", "Invalid name");
      patch.name = name;
    }
    if ("parentId" in body) {
      const parentId = body["parentId"];
      if (!isNullableId(parentId)) return jsonError(c, 400, "bad_request", "Invalid parentId");
      patch.parentId = parentId;
    }
    if ("position" in body) {
      const position = body["position"];
      if (!isPosition(position)) return jsonError(c, 400, "bad_request", "Invalid position");
      patch.position = position;
    }
    const now = deps.now();
    try {
      const folder = inTransaction(db, () => {
        let current = getFolder(db, id);
        if (!current) throw new NotFoundError("Folder not found");
        if (patch.parentId !== undefined || patch.position !== undefined) {
          const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
          current = moveFolder(db, id, parentId, now, patch.position);
        }
        if (patch.name !== undefined) current = renameFolder(db, id, patch.name, now);
        recordAdminEvent(
          db,
          { userId: c.get("user").id, action: "folder_update", folderId: id, detail: patch },
          now,
        );
        return current;
      });
      return c.json({ folder: folderDto(folder) });
    } catch (error) {
      return catalogErrorResponse(c, error);
    }
  });

  routes.delete("/:id", (c) => {
    const id = c.req.param("id");
    const force = c.req.query("force") === "1";
    const now = deps.now();
    try {
      inTransaction(db, () => {
        deleteFolder(db, id, { force });
        recordAdminEvent(
          db,
          { userId: c.get("user").id, action: "folder_delete", folderId: id, detail: { force } },
          now,
        );
      });
      return c.body(null, 204);
    } catch (error) {
      return catalogErrorResponse(c, error);
    }
  });

  return routes;
}
