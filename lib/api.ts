// lib/api.ts
// Thin fetch wrapper for the Player API: CSRF header, same-origin cookies, typed errors.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface SessionInfo {
  user: { id: string; displayName: string | null };
  role: "admin" | "user";
  expiresAt: string;
}

/**
 * Builds the ApiError of a failed response from its status and raw body, reading the
 * `{ error: { code, message } }` envelope when there is one. Shared with the XHR upload.
 */
export function toApiError(status: number, statusText: string, bodyText: string): ApiError {
  let code = status === 401 ? "session_required" : "request_failed";
  let message = statusText || "Request failed";
  let details: unknown;
  try {
    const body = JSON.parse(bodyText) as { error?: { code?: string; message?: string } };
    details = body;
    if (body.error?.code) code = body.error.code;
    if (body.error?.message) message = body.error.message;
  } catch {
    // Non-JSON error body: keep the defaults.
  }
  return new ApiError(status, code, message, details);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Requested-With", "player");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw toApiError(response.status, response.statusText, text);
  }

  // Deletions answer 204 without a body.
  if (response.status === 204) return undefined as T;

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, "bad_response", "Réponse inattendue du serveur");
  }
}

export function fetchSession(): Promise<SessionInfo> {
  return api<SessionInfo>("/api/session");
}

export function logout(): Promise<{ redirect: string }> {
  return api<{ redirect: string }>("/api/auth/logout", { method: "POST" });
}

// Ends the server session then leaves for the provider's end_session URL.
export async function performLogout(): Promise<void> {
  try {
    const { redirect } = await logout();
    window.location.assign(redirect);
  } catch (error) {
    console.error("Logout failed", error);
  }
}

export function redirectToLogin(): void {
  window.location.assign("/api/auth/login");
}

// Dev-only login bypass (see server/src/dev-bypass.ts). Any failure means "not available".
export async function fetchDevBypassStatus(): Promise<boolean> {
  try {
    const { bypass } = await api<{ bypass?: boolean }>("/api/dev/status");
    return bypass === true;
  } catch {
    return false;
  }
}

export async function devLoginAs(role: "admin" | "user"): Promise<void> {
  await api<{ role: string }>("/api/dev/login-as", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}
