// components/music-visualizer/enhanced-visualizer.tsx
import { useEffect, useMemo, useRef, useState, type CanvasHTMLAttributes } from "react";
import { calculateBarData, draw } from "./drawing";
import { VisualizerConfig, loadVisualizerConfig } from "./config";

export interface EnhancedVisualizerProps extends CanvasHTMLAttributes<HTMLCanvasElement> {
  analyser: AnalyserNode;
  /** Per-instance overrides on top of the stored configuration. */
  config?: Partial<VisualizerConfig>;
}

export function EnhancedMusicVisualizer({ analyser, config: overrides, ...props }: EnhancedVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stored] = useState<VisualizerConfig>(() => loadVisualizerConfig());
  const config = useMemo<VisualizerConfig>(() => ({ ...stored, ...overrides }), [stored, overrides]);

  useEffect(() => {
    analyser.fftSize = config.fftSize;
    analyser.minDecibels = config.minDecibels;
    analyser.maxDecibels = config.maxDecibels;
    analyser.smoothingTimeConstant = config.smoothingTimeConstant;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;

    // Keep the drawing buffer in sync with the CSS size without reading layout every frame.
    const syncSize = (width: number, height: number) => {
      const w = Math.round(width);
      const h = Math.round(height);
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      syncSize(box.width, box.height);
    });
    observer.observe(canvas);
    syncSize(canvas.clientWidth, canvas.clientHeight);

    const render = () => {
      if (analyser.context.state === "closed") return;
      frame = requestAnimationFrame(render);

      if (analyser.context.state === "running") analyser.getByteFrequencyData(data);
      else data.fill(0);

      draw(calculateBarData(data, canvas.width, config.barWidth, config.gap), canvas, config);
    };

    render();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [analyser, config]);

  return <canvas ref={canvasRef} {...props} />;
}
