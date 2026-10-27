export interface AppConfig {
  appUrl: URL;
  port: number;
  dataDir: string;
  nodeEnv: "development" | "production" | "test";
  oidc: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    groupsClaim: string;
    groupAdmin: string;
    groupUsers: string;
  };
  session: {
    secret: Buffer;
    ttlMs: number;
    groupsRecheckMs: number;
  };
  trustProxy: boolean;
  maxUploadBytes: number;
  /** Dev-only login bypass, always false in production. */
  devBypass: boolean;
}

type Env = Record<string, string | undefined>;

const HOUR_MS = 3_600_000;
const GROUPS_RECHECK_MS = 15 * 60 * 1000;
const BYTES_PER_MB = 1024 * 1024;
const SECRET_BYTES = 32;
const NODE_ENVS = ["development", "production", "test"] as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`Missing required environment variable ${name}`);
  return value;
}

function optional(env: Env, name: string, fallback: string): string {
  const value = env[name]?.trim();
  return value ? value : fallback;
}

function positiveNumber(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive number, got "${raw}"`);
  }
  return value;
}

function parseMaxUploadBytes(env: Env): number {
  const raw = env.MAX_UPLOAD_MB?.trim();
  if (!raw) return 200 * BYTES_PER_MB;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`MAX_UPLOAD_MB must be a positive integer, got "${raw}"`);
  }
  return value * BYTES_PER_MB;
}

function parsePort(env: Env): number {
  const raw = env.PORT?.trim();
  if (!raw) return 8080;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new ConfigError(`PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return value;
}

function parseNodeEnv(env: Env): AppConfig["nodeEnv"] {
  const raw = optional(env, "NODE_ENV", "production");
  const match = NODE_ENVS.find((candidate) => candidate === raw);
  if (!match)
    throw new ConfigError(`NODE_ENV must be one of ${NODE_ENVS.join(", ")}, got "${raw}"`);
  return match;
}

function parseSessionSecret(raw: string): Buffer {
  let secret: Buffer | undefined;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) secret = Buffer.from(raw, "hex");
  else if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) secret = Buffer.from(raw, "base64");
  if (!secret || secret.length !== SECRET_BYTES) {
    throw new ConfigError(
      `SESSION_SECRET must decode to ${SECRET_BYTES} bytes (64 hex characters or 44 base64 characters)`,
    );
  }
  return secret;
}

function parseAppUrl(raw: string, nodeEnv: AppConfig["nodeEnv"]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`APP_URL must be a valid URL, got "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError("APP_URL must use http or https");
  }
  if (nodeEnv === "production" && url.protocol !== "https:") {
    throw new ConfigError("APP_URL must use https in production");
  }
  return url;
}

function parseDevBypass(env: Env, nodeEnv: AppConfig["nodeEnv"], appUrl: URL): boolean {
  const enabled = optional(env, "DEV_BYPASS_LOGIN", "false") === "true";
  if (enabled && nodeEnv === "production") {
    throw new ConfigError("DEV_BYPASS_LOGIN=true is refused when NODE_ENV=production");
  }
  if (enabled && appUrl.protocol === "https:") {
    throw new ConfigError("DEV_BYPASS_LOGIN=true is only allowed with an http:// APP_URL");
  }
  return enabled;
}

export function loadConfig(env: Env): AppConfig {
  const nodeEnv = parseNodeEnv(env);
  const appUrl = parseAppUrl(required(env, "APP_URL"), nodeEnv);
  return {
    appUrl,
    port: parsePort(env),
    dataDir: optional(env, "DATA_DIR", "/data"),
    nodeEnv,
    oidc: {
      issuer: required(env, "OIDC_ISSUER"),
      clientId: required(env, "OIDC_CLIENT_ID"),
      clientSecret: required(env, "OIDC_CLIENT_SECRET"),
      groupsClaim: optional(env, "OIDC_GROUPS_CLAIM", "groups"),
      groupAdmin: optional(env, "OIDC_GROUP_ADMIN", "admin"),
      groupUsers: optional(env, "OIDC_GROUP_USERS", "users"),
    },
    session: {
      secret: parseSessionSecret(required(env, "SESSION_SECRET")),
      ttlMs: positiveNumber(env, "SESSION_TTL_HOURS", 12) * HOUR_MS,
      groupsRecheckMs: GROUPS_RECHECK_MS,
    },
    trustProxy: optional(env, "TRUST_PROXY", "false").toLowerCase() === "true",
    maxUploadBytes: parseMaxUploadBytes(env),
    devBypass: parseDevBypass(env, nodeEnv, appUrl),
  };
}
