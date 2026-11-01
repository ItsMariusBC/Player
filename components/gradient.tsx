// components/gradient.tsx
// Lazy entry point: three.js and the WebGL scene load after the first paint.
// Under « prefers-reduced-motion », the animated scene gives way to a static CSS gradient
// of the same colours: no WebGL at all, which also keeps headless runners without a GPU
// responsive.
import { lazy, Suspense } from "react";
import { useReducedMotion } from "framer-motion";
import { GradientColors } from "@/lib/palette";

const GradientCanvas = lazy(() =>
  import("@/components/gradient/gradient-scene").then((m) => ({ default: m.GradientCanvas })),
);

export function Gradient({ colors }: { colors: GradientColors }) {
  const reduced = useReducedMotion();
  if (reduced) return <StaticGradient colors={colors} />;
  return (
    <Suspense fallback={<div className="absolute inset-0 bg-purple-900/50" />}>
      <GradientCanvas colors={colors} />
    </Suspense>
  );
}

/** The three palette colours as a diagonal gradient, without animation. */
export function StaticGradient({ colors }: { colors: GradientColors }) {
  const [first, second, third] = colors;
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0"
      style={{ background: `linear-gradient(160deg, ${first} 0%, ${second} 55%, ${third} 100%)` }}
    />
  );
}
