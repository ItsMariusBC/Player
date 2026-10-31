import type { Context } from "hono";
import {
  FolderConflictError,
  FolderCycleError,
  FolderNotEmptyError,
  NotFoundError,
} from "../catalog/types.ts";
import { jsonError } from "../http.ts";

/** Maps a repository error to its JSON response; anything else is rethrown. */
export function catalogErrorResponse(c: Context, error: unknown): Response {
  if (error instanceof NotFoundError) return jsonError(c, 404, error.code, error.message);
  if (error instanceof FolderCycleError) return jsonError(c, 400, error.code, error.message);
  if (error instanceof FolderConflictError || error instanceof FolderNotEmptyError) {
    return jsonError(c, 409, error.code, error.message);
  }
  throw error;
}

export const MAX_TEXT = 200;

/** A trimmed, non-empty string of at most MAX_TEXT characters, else null. */
export function requiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text !== "" && text.length <= MAX_TEXT ? text : null;
}

/** A trimmed string of at most MAX_TEXT characters (empty allowed), else null. */
export function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length <= MAX_TEXT ? text : null;
}

export const isPosition = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

export const isNullableId = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value !== "");

/** True when every key of body is allowed. */
export const onlyKeys = (body: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(body).every((key) => allowed.includes(key));
