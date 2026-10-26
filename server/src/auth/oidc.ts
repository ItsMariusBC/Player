import * as client from "openid-client";
import type { AppConfig } from "../config.ts";

export interface LoginStart {
  url: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface TokenSet {
  idToken: string;
  refreshToken?: string;
  claims: Record<string, unknown>;
  expiresAt?: number;
}

export interface OidcAdapter {
  startLogin(redirectUri: URL): Promise<LoginStart>;
  completeLogin(
    callbackUrl: URL,
    expected: { state: string; nonce: string; codeVerifier: string; redirectUri: URL },
  ): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  endSessionUrl(idTokenHint: string | undefined, postLogoutRedirect: URL): URL | null;
  revoke(refreshToken: string): Promise<void>;
}

function toTokenSet(
  response: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
): TokenSet {
  const tokens: TokenSet = {
    idToken: response.id_token ?? "",
    claims: { ...(response.claims() ?? {}) },
  };
  if (response.refresh_token) tokens.refreshToken = response.refresh_token;
  if (response.expires_in !== undefined) {
    tokens.expiresAt = Date.now() + response.expires_in * 1000;
  }
  return tokens;
}

export async function createOidcAdapter(
  cfg: AppConfig["oidc"],
  opts: { allowInsecure?: boolean } = {},
): Promise<OidcAdapter> {
  const config = await client.discovery(
    new URL(cfg.issuer),
    cfg.clientId,
    cfg.clientSecret,
    client.ClientSecretPost(cfg.clientSecret),
    opts.allowInsecure ? { execute: [client.allowInsecureRequests] } : undefined,
  );
  const scope = ["openid", "profile", "email", "offline_access", cfg.groupsClaim].join(" ");

  return {
    async startLogin(redirectUri) {
      const codeVerifier = client.randomPKCECodeVerifier();
      const state = client.randomState();
      const nonce = client.randomNonce();
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri.toString(),
        scope,
        code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: "S256",
        state,
        nonce,
      });
      return { url, state, nonce, codeVerifier };
    },
    async completeLogin(callbackUrl, expected) {
      return toTokenSet(
        await client.authorizationCodeGrant(config, callbackUrl, {
          pkceCodeVerifier: expected.codeVerifier,
          expectedState: expected.state,
          expectedNonce: expected.nonce,
        }),
      );
    },
    async refresh(refreshToken) {
      return toTokenSet(await client.refreshTokenGrant(config, refreshToken));
    },
    endSessionUrl(idTokenHint, postLogoutRedirect) {
      if (!config.serverMetadata().end_session_endpoint) return null;
      const params: Record<string, string> = {
        post_logout_redirect_uri: postLogoutRedirect.toString(),
      };
      if (idTokenHint) params.id_token_hint = idTokenHint;
      return client.buildEndSessionUrl(config, params);
    },
    async revoke(refreshToken) {
      if (!config.serverMetadata().revocation_endpoint) return;
      await client.tokenRevocation(config, refreshToken);
    },
  };
}
