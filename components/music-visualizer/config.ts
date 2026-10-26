// components/music-visualizer/config.ts
export type VisualizerMode = 
  | 'bars' 
  | 'wave' 
  | 'circle' 
  | 'particles';

export interface VisualizerConfig {
  mode: VisualizerMode;
  barWidth: number;
  gap: number;
  fftSize: number;
  smoothingTimeConstant: number;
  minDecibels: number;
  maxDecibels: number;
  barColor: string;
  backgroundColor: string;
  showPeaks: boolean;
  mirrorMode: boolean;
  rounded: boolean;
  /** Height of a full-scale bar as a fraction of the canvas height (0..1). */
  heightScale: number;
}

export const DEFAULT_CONFIG: VisualizerConfig = {
  mode: 'bars',
  barWidth: 2,
  gap: 1,
  fftSize: 1024,
  smoothingTimeConstant: 0.5,
  minDecibels: -90,
  maxDecibels: -10,
  barColor: 'rgb(160, 198, 255)',
  backgroundColor: 'transparent',
  showPeaks: false,
  mirrorMode: false,
  rounded: true,
  heightScale: 0.6,
};

// Load config from localStorage
export const loadVisualizerConfig = (): VisualizerConfig => {
  const savedConfig = localStorage.getItem('visualizer_config');
  if (savedConfig) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(savedConfig) };
    } catch (e) {
      console.error('Failed to parse visualizer config', e);
    }
  }
  return DEFAULT_CONFIG;
};

// Save config to localStorage
export const saveVisualizerConfig = (config: VisualizerConfig): void => {
  localStorage.setItem('visualizer_config', JSON.stringify(config));
};