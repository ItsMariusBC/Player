// components/song-notification.tsx
// Pure view: renders whatever the NotificationManager says is current, in the
// same bare style as the "En lecture" and "À suivre" hints.
import { useEffect, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Notification, NotificationKind, NotificationManager } from "@/lib/notification-manager";

const LABELS: Record<NotificationKind, string> = {
  next: "Suivant",
  previous: "Précédent",
  jump: "Lecture",
  play: "Lecture",
  pause: "Pause",
};

export function SongNotificationProvider({
  notifications,
  children,
}: {
  notifications: NotificationManager;
  children: React.ReactNode;
}) {
  const [current, setCurrent] = useState<Notification | null>(() => notifications.getCurrent());

  useEffect(() => notifications.subscribe(setCurrent), [notifications]);

  return (
    <>
      {children}

      <div
        className="pointer-events-none fixed top-4 right-3 z-50 max-w-[min(640px,calc(100vw-1.5rem))] md:top-5 md:right-4"
        role="status"
        aria-live="polite"
      >
        <AnimatePresence mode="wait" initial={false}>
          {current && (
            <m.div
              key={current.id}
              className="flex items-center gap-3 text-purple-50 drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
              transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.8 }}
            >
              {current.song.picture ? (
                <img
                  src={current.song.picture}
                  alt=""
                  width={36}
                  height={36}
                  decoding="async"
                  className="size-9 shrink-0 rounded-md object-cover shadow-lg ring-1 ring-purple-100/15"
                />
              ) : (
                <div className="size-9 shrink-0 rounded-md bg-purple-200/10 ring-1 ring-purple-100/15" />
              )}
              <div className="min-w-0 truncate text-sm whitespace-nowrap">
                <span className="text-purple-200/70">{LABELS[current.kind]} : </span>
                <span className="font-medium">{current.song.name}</span>
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
