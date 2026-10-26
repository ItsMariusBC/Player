// components/music-visualizer/enhanced-visualizer.tsx
import { useCallback, useEffect, useRef, useState, type CanvasHTMLAttributes } from "react";
import { calculateBarData, draw } from "./drawing";
import { VisualizerConfig, loadVisualizerConfig } from "./config";

export interface EnhancedVisualizerProps extends CanvasHTMLAttributes<HTMLCanvasElement> {
  analyser: AnalyserNode;
}

export function EnhancedMusicVisualizer({ 
  analyser, 
  ...props 
}: EnhancedVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [config] = useState<VisualizerConfig>(() => loadVisualizerConfig());
  
  useEffect(() => {
    // Set analyzer properties based on config
    analyser.fftSize = config.fftSize;
    analyser.minDecibels = config.minDecibels;
    analyser.maxDecibels = config.maxDecibels;
    analyser.smoothingTimeConstant = config.smoothingTimeConstant;
    
    // Start the animation
    startAnimation();
    
  }, [analyser, config]);
  
  const startAnimation = useCallback(() => {
    if (analyser.context.state === "closed") return;
    
    const animationLoop = () => {
      if (analyser.context.state === "closed") return;
      
      const data = new Uint8Array(analyser.frequencyBinCount);
      
      if (analyser.context.state === "running") {
        analyser.getByteFrequencyData(data);
      }
      
      processFrequencyData(data);
      requestAnimationFrame(animationLoop);
    };
    
    animationLoop();
  }, [analyser]);
  
  const processFrequencyData = (data: Uint8Array): void => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const computedStyle = getComputedStyle(canvas);
    
    // Make sure the canvas size matches its display size
    if (canvas.width !== parseFloat(computedStyle.width) || 
        canvas.height !== parseFloat(computedStyle.height)) {
      canvas.width = parseFloat(computedStyle.width);
      canvas.height = parseFloat(computedStyle.height);
    }
    
    const dataPoints = calculateBarData(
      data,
      canvas.width,
      config.barWidth,
      config.gap,
    );
    
    draw(dataPoints, canvas, config);
  };
  
  return <canvas ref={canvasRef} {...props} />;
}

// Simplement exporter la référence au composant de paramètres
export { VisualizerSettingsDialog } from "./visualizer-settings";