// components/logout-link.tsx
// Bottom-left bare link mirroring UpNext's style; ends the server session.
import { logout } from "@/lib/api";

export function LogoutLink() {
  const onLogout = async () => {
    try {
      const { redirect } = await logout();
      window.location.assign(redirect);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  return (
    <div className="fixed left-3 bottom-3 z-30 md:left-4 md:bottom-4">
      <button
        type="button"
        aria-label="Se déconnecter"
        onClick={onLogout}
        className="pointer-events-auto flex items-center gap-3 text-sm text-purple-200/70 drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] hover:text-purple-50"
      >
        <svg
          aria-hidden="true"
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    </div>
  );
}
