import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppConfig } from "../src/config.ts";
import { resolveRole } from "../src/auth/roles.ts";

function oidcFixture(overrides: Partial<AppConfig["oidc"]> = {}): AppConfig["oidc"] {
  return {
    issuer: "https://auth.example/application/o/player/",
    clientId: "player",
    clientSecret: "shh",
    groupsClaim: "groups",
    groupAdmin: "admin",
    groupUsers: "users",
    ...overrides,
  };
}

describe("resolveRole", () => {
  it("maps the users group to user", () => {
    const result = resolveRole({ groups: ["users"] }, oidcFixture());
    assert.deepEqual(result, { role: "user", groups: ["users"] });
  });

  it("maps the admin group to admin", () => {
    const result = resolveRole({ groups: ["admin"] }, oidcFixture());
    assert.deepEqual(result, { role: "admin", groups: ["admin"] });
  });

  it("prefers admin when both groups are present", () => {
    const result = resolveRole({ groups: ["admin", "users"] }, oidcFixture());
    assert.equal(result.role, "admin");
  });

  it("denies with no_group when no known group matches", () => {
    const result = resolveRole({ groups: [] }, oidcFixture());
    assert.deepEqual(result, { role: null, groups: [], reason: "no_group" });
  });

  it("denies with missing_claim when the claim is absent", () => {
    const result = resolveRole({}, oidcFixture());
    assert.deepEqual(result, { role: null, groups: [], reason: "missing_claim" });
  });

  it("denies with missing_claim when the claim is not an array", () => {
    const result = resolveRole({ groups: "users" }, oidcFixture());
    assert.deepEqual(result, { role: null, groups: [], reason: "missing_claim" });
  });

  it("honours a custom claim name and admin group", () => {
    const oidc = oidcFixture({ groupsClaim: "roles", groupAdmin: "player-admin" });
    const result = resolveRole({ roles: ["player-admin"] }, oidc);
    assert.equal(result.role, "admin");
  });
});
