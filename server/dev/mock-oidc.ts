import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import Provider from "oidc-provider";

// Development and test only: a tiny OIDC provider standing in for Authentik.
const port = Number(process.env.MOCK_OIDC_PORT ?? 3002);
const issuer = `http://localhost:${port}`;

interface MockAccount {
  name: string;
  email: string;
  groups: string[];
  disabled: boolean;
}

const accounts = new Map<string, MockAccount>([
  ["admin@test", { name: "Admin Test", email: "admin@test", groups: ["admin"], disabled: false }],
  ["user@test", { name: "User Test", email: "user@test", groups: ["users"], disabled: false }],
  ["nobody@test", { name: "Nobody Test", email: "nobody@test", groups: [], disabled: false }],
]);

const origins = ["http://localhost:8080", "http://localhost:3000", "http://127.0.0.1:4173"];

const provider = new Provider(issuer, {
  clients: [
    {
      client_id: "player-dev",
      client_secret: "player-dev-secret",
      redirect_uris: origins.map((origin) => `${origin}/api/auth/callback`),
      // Both forms: the server sends the app URL with a trailing slash.
      post_logout_redirect_uris: origins.flatMap((origin) => [origin, `${origin}/`]),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    },
  ],
  scopes: ["openid", "profile", "email", "groups", "offline_access"],
  claims: {
    openid: ["sub"],
    profile: ["name"],
    email: ["email"],
    groups: ["groups"],
  },
  // The server reads claims from the ID token and never calls userinfo.
  conformIdTokenClaims: false,
  pkce: { required: () => true },
  cookies: { keys: ["dev-only-cookie-key"] },
  issueRefreshToken: async () => true,
  rotateRefreshToken: false,
  ttl: {
    AccessToken: 3600,
    IdToken: 3600,
    RefreshToken: 86400,
    Session: 86400,
    Grant: 86400,
    Interaction: 3600,
  },
  features: {
    devInteractions: { enabled: true },
    revocation: { enabled: true },
    rpInitiatedLogout: {
      enabled: true,
      // Auto-confirm the logout so browsers and tests need no extra click.
      logoutSource: async (ctx, form) => {
        ctx.body = `<!DOCTYPE html><html><body>${form}<script>
const f = document.forms[0];
const logout = document.createElement("input");
logout.type = "hidden";
logout.name = "logout";
logout.value = "yes";
f.appendChild(logout);
f.submit();
</script></body></html>`;
      },
    },
  },
  findAccount: async (_ctx, id) => {
    const account = accounts.get(id);
    if (!account || account.disabled) return undefined;
    return {
      accountId: id,
      claims: async () => ({
        sub: id,
        name: account.name,
        email: account.email,
        groups: account.groups,
      }),
    };
  },
});

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleControl(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = new URL(req.url ?? "/", issuer).pathname;
  if (req.method === "GET" && path === "/mock/accounts") {
    sendJson(res, 200, Object.fromEntries(accounts));
    return;
  }
  const match = /^\/mock\/accounts\/([^/]+)$/.exec(path);
  if (req.method === "POST" && match) {
    const account = accounts.get(decodeURIComponent(match[1]!));
    if (!account) {
      sendJson(res, 404, { error: "unknown account" });
      return;
    }
    let patch: { groups?: unknown; disabled?: unknown };
    try {
      patch = (await readJson(req)) as typeof patch;
    } catch {
      sendJson(res, 400, { error: "invalid JSON" });
      return;
    }
    if (Array.isArray(patch.groups)) account.groups = patch.groups.map(String);
    if (typeof patch.disabled === "boolean") account.disabled = patch.disabled;
    sendJson(res, 200, account);
    return;
  }
  sendJson(res, 404, { error: "not found" });
}

const callback = provider.callback();

createServer((req, res) => {
  if (req.url?.startsWith("/mock/")) {
    handleControl(req, res).catch(() => sendJson(res, 500, { error: "internal error" }));
    return;
  }
  callback(req, res);
}).listen(port, () => {
  console.log(`mock OIDC listening on ${issuer}`);
  console.log(`accounts: ${[...accounts.keys()].join(", ")}`);
});
