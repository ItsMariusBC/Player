// lib/api.ts
// Thin fetch wrapper for the Player API: CSRF header, same-origin cookies, typed errors.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Requested-With", "player");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });

  if (!response.ok) {
    let code = response.status === 401 ? "session_required" : "request_failed";
    let message = response.statusText || "Request failed";
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body: keep the defaults.
    }
    throw new ApiError(response.status, code, message);
  }

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
