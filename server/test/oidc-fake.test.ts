import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeOidc } from "./oidc-fake.ts";

const adminClaims = { sub: "admin-sub", groups: ["admin"] };
const expected = (state: string) => ({
  state,
  nonce: "fake-nonce",
  codeVerifier: "fake-verifier",
  redirectUri: new URL("https://player.example/auth/callback"),
});

describe("createFakeOidc", () => {
  it("returns the admin claims on completeLogin", async () => {
    const oidc = createFakeOidc({ admin: { claims: adminClaims } });
    const start = await oidc.startLogin(new URL("https://player.example/auth/callback"));
    const callback = new URL(
      `https://player.example/auth/callback?code=admin&state=${start.state}`,
    );
    const tokens = await oidc.completeLogin(callback, expected(start.state));
    assert.deepEqual(tokens.claims, adminClaims);
    assert.equal(tokens.idToken, "fake-id-admin");
    assert.equal(tokens.refreshToken, "fake-rt-admin");
  });

  it("rejects a state mismatch", async () => {
    const oidc = createFakeOidc({ admin: { claims: adminClaims } });
    const callback = new URL("https://player.example/auth/callback?code=admin&state=other");
    await assert.rejects(oidc.completeLogin(callback, expected("fake-state")), /state mismatch/);
  });

  it("reflects claim changes and refresh failures", async () => {
    const accounts = { admin: { claims: { ...adminClaims }, refreshFails: false } };
    const oidc = createFakeOidc(accounts);
    accounts.admin.claims.groups = ["users"];
    assert.deepEqual((await oidc.refresh("fake-rt-admin")).claims.groups, ["users"]);
    accounts.admin.refreshFails = true;
    await assert.rejects(oidc.refresh("fake-rt-admin"), /refresh failed/);
  });
});
