// components/admin-button.tsx
// Bare control for admins, mirroring LogoutLink's style. Positioned by CornerActions.
export function AdminButton({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <button
        type="button"
        aria-label="Administration"
        data-admin-button=""
        onClick={onOpen}
        className="pointer-events-auto flex items-center gap-2 rounded-md text-sm text-purple-200/70 drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)] transition-colors hover:text-purple-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-purple-400/60"
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
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <span>Administration</span>
      </button>
    </>
  );
}
