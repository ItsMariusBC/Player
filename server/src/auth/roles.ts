import type { AppConfig } from "../config.ts";

export type Role = "admin" | "user";

export interface RoleResolution {
  role: Role | null;
  groups: string[];
  reason?: "missing_claim" | "no_group";
}

// Maps the OIDC groups claim to a player role. Admin wins over user.
// Comparison is exact (case-sensitive).
export function resolveRole(
  claims: Record<string, unknown>,
  oidc: AppConfig["oidc"],
): RoleResolution {
  const raw = claims[oidc.groupsClaim];
  if (!Array.isArray(raw)) {
    return { role: null, groups: [], reason: "missing_claim" };
  }
  const groups = raw.filter((entry): entry is string => typeof entry === "string");
  if (groups.includes(oidc.groupAdmin)) return { role: "admin", groups };
  if (groups.includes(oidc.groupUsers)) return { role: "user", groups };
  return { role: null, groups, reason: "no_group" };
}
