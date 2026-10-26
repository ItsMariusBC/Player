// components/music-visualizer/visualizer-settings.tsx
import React, { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { 
  VisualizerConfig, 
  VisualizerMode, 
  loadVisualizerConfig, 
  saveVisualizerConfig
} from "./config";

const inputVariants = "bg-transparent rounded-lg bg-purple-200/10 text-sm px-2 py-1 placeholder:text-purple-200/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400";

export function VisualizerSettingsDialog() {
  const [open, setOpen] = useState(false);
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className={cn(
          buttonVariants({
            variant: "secondary",
          }),
        )}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-5"
        >
          <path d="M3 3v18h18" />
          <path d="m21 21-9-9" />
          <path d="M12 12H3V3" />
        </svg>
        Visualizer
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <VisualizerSettings onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function VisualizerSettings({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<VisualizerConfig>(() => loadVisualizerConfig());
  
  const handleSave = () => {
    saveVisualizerConfig(config);
    onClose();
    // Force a page reload to apply new settings
    window.location.reload();
  };
  
  const handleChange = <K extends keyof VisualizerConfig>(
    key: K, 
    value: VisualizerConfig[K]
  ) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };
  
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium">Visualizer Settings</h2>
        <p className="text-purple-200 text-sm mb-4">
          Customize how your music visualizer looks and behaves
        </p>
      </div>
      
      <div className="flex flex-col gap-2">
        <label htmlFor="mode" className="text-xs font-medium">
          Visualization Mode
        </label>
        <select
          id="mode"
          value={config.mode}
          onChange={(e) => handleChange('mode', e.target.value as VisualizerMode)}
          className={inputVariants}
        >
          <option value="bars">Bars</option>
          <option value="wave">Wave</option>
          <option value="circle">Circle</option>
          <option value="particles">Particles</option>
        </select>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="barWidth" className="text-xs font-medium">
            Bar Width
          </label>
          <input
            id="barWidth"
            type="range"
            min="1"
            max="10"
            value={config.barWidth}
            onChange={(e) => handleChange('barWidth', parseInt(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-purple-200">{config.barWidth}px</div>
        </div>
        
        <div className="flex flex-col gap-2">
          <label htmlFor="gap" className="text-xs font-medium">
            Gap Between Bars
          </label>
          <input
            id="gap"
            type="range"
            min="0"
            max="5"
            value={config.gap}
            onChange={(e) => handleChange('gap', parseInt(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-purple-200">{config.gap}px</div>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="smoothing" className="text-xs font-medium">
            Smoothing
          </label>
          <input
            id="smoothing"
            type="range"
            min="0"
            max="0.95"
            step="0.05"
            value={config.smoothingTimeConstant}
            onChange={(e) => handleChange('smoothingTimeConstant', parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-purple-200">
            {config.smoothingTimeConstant.toFixed(2)}
          </div>
        </div>
        
        <div className="flex flex-col gap-2">
          <label htmlFor="fftSize" className="text-xs font-medium">
            Resolution (FFT Size)
          </label>
          <select
            id="fftSize"
            value={config.fftSize}
            onChange={(e) => handleChange('fftSize', parseInt(e.target.value))}
            className={inputVariants}
          >
            <option value="256">256 (Low)</option>
            <option value="512">512</option>
            <option value="1024">1024 (Medium)</option>
            <option value="2048">2048</option>
            <option value="4096">4096 (High)</option>
            <option value="8192">8192 (Ultra)</option>
          </select>
        </div>
      </div>
      
      <div className="flex flex-col gap-2">
        <label htmlFor="barColor" className="text-xs font-medium">
          Visualizer Color
        </label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            id="barColor"
            value={config.barColor.startsWith('rgb') ? '#a0c6ff' : config.barColor}
            onChange={(e) => handleChange('barColor', e.target.value)}
            className="w-8 h-8 rounded cursor-pointer"
          />
          <input
            value={config.barColor}
            onChange={(e) => handleChange('barColor', e.target.value)}
            className={inputVariants}
            placeholder="Color value (hex, rgb, etc)"
          />
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="showPeaks"
            checked={config.showPeaks}
            onChange={(e) => handleChange('showPeaks', e.target.checked)}
            className="rounded"
          />
          <label htmlFor="showPeaks" className="text-sm">Show Peaks</label>
        </div>
        
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="mirrorMode"
            checked={config.mirrorMode}
            onChange={(e) => handleChange('mirrorMode', e.target.checked)}
            className="rounded"
          />
          <label htmlFor="mirrorMode" className="text-sm">Mirror Mode</label>
        </div>
        
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="rounded"
            checked={config.rounded}
            onChange={(e) => handleChange('rounded', e.target.checked)}
            className="rounded"
          />
          <label htmlFor="rounded" className="text-sm">Rounded Edges</label>
        </div>
      </div>
      
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={onClose}
          className={cn(buttonVariants({ variant: "secondary" }))}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className={cn(buttonVariants({ variant: "primary" }))}
        >
          Save Changes
        </button>
      </div>
    </div>
  );
}