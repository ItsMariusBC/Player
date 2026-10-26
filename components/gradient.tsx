// components/gradient.tsx
// Lazy entry point: three.js and the WebGL scene load after the first paint.
import { lazy, Suspense } from "react";
import { GradientColors } from "@/lib/palette";

const GradientCanvas = lazy(() =>
  import("@/components/gradient/gradient-scene").then((m) => ({ default: m.GradientCanvas })),
);

export function Gradient({ colors }: { colors: GradientColors }) {
  return (
    <Suspense fallback={<div className="absolute inset-0 bg-purple-900/50" />}>
      <GradientCanvas colors={colors} />
    </Suspense>
  );
}
