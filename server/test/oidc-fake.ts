import type { OidcAdapter, TokenSet } from "../src/auth/oidc.ts";

export interface FakeAccount {
  claims: Record<string, unknown>;
  refreshFails?: boolean;
}

export type FakeOidc = OidcAdapter & { revoked: string[]; lastCallbackUrl: URL | null };

// In-memory OIDC adapter for tests. The authorization code is the account id.
export function createFakeOidc(accounts: Record<string, FakeAccount>): FakeOidc {
  const revoked: string[] = [];

  const fake: FakeOidc = {
    revoked,
    lastCallbackUrl: null,
    async startLogin() {
      const state = "fake-state";
      return {
        url: new URL(`http://fake-idp/authorize?state=${state}`),
        state,
        nonce: "fake-nonce",
        codeVerifier: "fake-verifier",
      };
    },
    async completeLogin(callbackUrl, expected): Promise<TokenSet> {
      fake.lastCallbackUrl = callbackUrl;
      if (
        callbackUrl.origin + callbackUrl.pathname !==
        expected.redirectUri.origin + expected.redirectUri.pathname
      ) {
        throw new Error("redirect_uri mismatch");
      }
      const code = callbackUrl.searchParams.get("code") ?? "";
      if (callbackUrl.searchParams.get("state") !== expected.state) {
        throw new Error("state mismatch");
      }
      const account = accounts[code];
      if (!account) throw new Error("unknown code");
      return {
        idToken: `fake-id-${code}`,
        refreshToken: `fake-rt-${code}`,
        claims: account.claims,
      };
    },
    async refresh(refreshToken): Promise<TokenSet> {
      const id = refreshToken.replace(/^fake-rt-/, "");
      const account = accounts[id];
      if (!account || account.refreshFails) throw new Error("refresh failed");
      return { idToken: `fake-id-${id}`, refreshToken, claims: account.claims };
    },
    endSessionUrl(_idTokenHint, postLogoutRedirect) {
      const url = new URL("http://fake-idp/end_session");
      url.searchParams.set("post_logout_redirect_uri", postLogoutRedirect.toString());
      return url;
    },
    async revoke(refreshToken) {
      revoked.push(refreshToken);
    },
  };
  return fake;
}
