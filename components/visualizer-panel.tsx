// components/visualizer-panel.tsx
// Two views of the same analyser:
// - VisualizerCard: the inline card with its "expand" control.
// - VisualizerStage: the expanded view. The page unmounts everything else
//   while it is shown, so only the shader and this canvas are rendered.
import { useEffect, type MouseEvent } from "react";
import { m } from "framer-motion";
import { EnhancedMusicVisualizer } from "@/components/music-visualizer/enhanced-visualizer";
import { cn } from "@/lib/cn";

export function VisualizerCard({ analyser, onExpand }: { analyser: AnalyserNode; onExpand: () => void }) {
  return (
    <div
      className="relative h-72 rounded-lg bg-purple-800/10 p-4 backdrop-blur-xs md:h-[500px]"
      data-trigger-container={true}
    >
      <EnhancedMusicVisualizer className="size-full" analyser={analyser} />
      <PanelButton className="absolute top-3 right-3" label="Agrandir le visualiseur" onClick={onExpand}>
        <ExpandIcon />
      </PanelButton>
    </div>
  );
}

// Larger canvas: taller and thicker bars so the spectrum fills the stage.
const STAGE_CONFIG = { heightScale: 0.9, barWidth: 4, gap: 2 } as const;

export function VisualizerStage({ analyser, onClose }: { analyser: AnalyserNode; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <m.div
      role="dialog"
      aria-modal="true"
      aria-label="Visualiseur"
      className="fixed inset-4 overflow-hidden rounded-2xl border border-purple-100/10 bg-purple-950/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] md:inset-8 md:p-6"
      data-trigger-container={true}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.9 }}
    >
      <EnhancedMusicVisualizer className="size-full" analyser={analyser} config={STAGE_CONFIG} />
      <PanelButton className="absolute top-4 right-4 md:top-5 md:right-5" label="Réduire le visualiseur" onClick={onClose}>
        <CollapseIcon />
      </PanelButton>
    </m.div>
  );
}

function PanelButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  // The surrounding card toggles playback on mousedown; the control must not.
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={stop}
      onClick={(event) => {
        stop(event);
        onClick();
      }}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full",
        "border border-purple-100/10 bg-purple-900/40 text-purple-100/75",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        "transition-all duration-200 hover:border-purple-100/20 hover:bg-purple-200/15 hover:text-purple-50",
        "active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/60",
        className,
      )}
    >
      {children}
    </button>
  );
}

const iconProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function ExpandIcon() {
  return (
    <svg {...iconProps}>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg {...iconProps}>
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}
