// components/admin/context-menu.tsx
// Right-click menu of the admin panel: role="menu" at the cursor, kept inside the viewport,
// closed by Escape or a pointerdown outside. Arrow keys move between items; an item with a
// submenu opens it on click, hover or ArrowRight. Rendered in a portal so the panel's
// transform never offsets its fixed position.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface MenuItem {
  id: string;
  label: string;
  onSelect?: () => void;
  /** Kept focusable and announced, but inert (aria-disabled). */
  disabled?: boolean;
  title?: string;
  destructive?: boolean;
  /** Left padding steps, for the folder tree in "Déplacer vers…". */
  indent?: number;
  submenu?: MenuItem[];
}

const EDGE = 8;

const itemClass = (item: MenuItem) =>
  cn(
    "flex w-full items-center justify-between gap-6 rounded-sm px-2.5 py-1.5 text-left text-sm",
    "focus-visible:outline-hidden focus:outline-hidden",
    item.disabled
      ? "cursor-default text-purple-200/35"
      : cn(
          "hover:bg-purple-200/10 focus:bg-purple-200/10",
          item.destructive ? "text-red-200" : "text-purple-50",
        ),
  );

const panelClass =
  "min-w-48 max-w-80 rounded-md border border-purple-100/10 bg-purple-950/90 p-1 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-xs";

function menuItems(menu: Element | null): HTMLElement[] {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>(":scope > li > [role='menuitem']"));
}

function moveFocus(menu: Element | null, delta: 1 | -1 | "first" | "last") {
  const items = menuItems(menu);
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement as HTMLElement);
  let next: number;
  if (delta === "first") next = 0;
  else if (delta === "last") next = items.length - 1;
  else next = current === -1 ? 0 : (current + delta + items.length) % items.length;
  items[next]?.focus();
}

export function ContextMenu({
  x,
  y,
  label,
  prompt,
  items,
  initialFocusId,
  onClose,
}: {
  x: number;
  y: number;
  /** Accessible name of the menu. */
  label: string;
  /** Question shown above the items (inline confirmations). */
  prompt?: string;
  items: MenuItem[];
  /** Item focused when the content appears; the first one by default. */
  initialFocusId?: string;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [flipSub, setFlipSub] = useState(false);
  // The parent rebuilds `items` on every render; only a real content change counts.
  const signature = `${prompt ?? ""}|${items.map((item) => item.id).join("|")}`;

  // Keep the menu inside the viewport once its size is known.
  useLayoutEffect(() => {
    const menu = rootRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE));
    const top = Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE));
    setPosition({ left, top });
    setFlipSub(left + width * 2 + EDGE > window.innerWidth);
  }, [x, y, signature]);

  // Focus the initial item when opened and whenever the content changes (confirmation step:
  // the caller points it at « Non », never at the destructive answer).
  useEffect(() => {
    setOpenSub(null);
    const initial = initialFocusId ? document.getElementById(`menuitem-${initialFocusId}`) : null;
    if (initial && menuRef.current?.contains(initial)) initial.focus();
    else moveFocus(menuRef.current, "first");
  }, [signature, initialFocusId]);

  // Give focus back to what had it (the row) when the menu goes away, unless the user
  // already moved it elsewhere (an outside click on another control).
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      const lost = document.activeElement === null || document.activeElement === document.body;
      if (lost && previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    // Capture phase, and stopped here: Escape closes the menu, not the panel behind it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    const onResize = () => onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  const activate = (item: MenuItem) => {
    if (item.disabled) return;
    if (item.submenu) {
      setOpenSub(item.id);
      return;
    }
    item.onSelect?.();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLUListElement>, parent?: MenuItem) => {
    const menu = event.currentTarget;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        event.stopPropagation();
        moveFocus(menu, 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        event.stopPropagation();
        moveFocus(menu, -1);
        break;
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        moveFocus(menu, "first");
        break;
      case "End":
        event.preventDefault();
        event.stopPropagation();
        moveFocus(menu, "last");
        break;
      case "ArrowLeft":
        if (parent) {
          event.preventDefault();
          event.stopPropagation();
          setOpenSub(null);
          document.getElementById(`menuitem-${parent.id}`)?.focus();
        }
        break;
      case "Tab":
        event.preventDefault();
        onClose();
        break;
    }
  };

  const renderItem = (item: MenuItem) => (
    <button
      type="button"
      role="menuitem"
      id={`menuitem-${item.id}`}
      tabIndex={-1}
      aria-disabled={item.disabled ? "true" : undefined}
      aria-haspopup={item.submenu ? "menu" : undefined}
      aria-expanded={item.submenu ? openSub === item.id : undefined}
      title={item.title}
      className={itemClass(item)}
      style={item.indent ? { paddingLeft: `${0.625 + item.indent * 0.75}rem` } : undefined}
      onClick={() => activate(item)}
      onKeyDown={(event) => {
        if (item.submenu && event.key === "ArrowRight" && !item.disabled) {
          event.preventDefault();
          event.stopPropagation();
          setOpenSub(item.id);
          // The submenu mounts on the next render.
          requestAnimationFrame(() =>
            moveFocus(document.getElementById(`submenu-${item.id}`), "first"),
          );
        }
      }}
    >
      <span className="truncate">{item.label}</span>
      {item.submenu && <span aria-hidden="true">›</span>}
    </button>
  );

  return createPortal(
    <div
      ref={rootRef}
      className="fixed z-50"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ul
        ref={menuRef}
        role="menu"
        aria-label={prompt ?? label}
        className={panelClass}
        onKeyDown={(event) => onMenuKeyDown(event)}
      >
        {prompt && (
          <li role="presentation" className="max-w-72 px-2.5 py-1.5 text-sm text-purple-100">
            {prompt}
          </li>
        )}
        {items.map((item) => (
          <li
            key={item.id}
            role="none"
            className="relative"
            onMouseEnter={() => setOpenSub(item.submenu ? item.id : null)}
          >
            {renderItem(item)}
            {item.submenu && openSub === item.id && (
              <ul
                id={`submenu-${item.id}`}
                role="menu"
                aria-label={item.label}
                className={cn(
                  panelClass,
                  "absolute top-0 max-h-[60vh] overflow-y-auto",
                  flipSub ? "right-full mr-1" : "left-full ml-1",
                )}
                onKeyDown={(event) => onMenuKeyDown(event, item)}
              >
                {item.submenu.map((sub) => (
                  <li key={sub.id} role="none">
                    {renderItem(sub)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
