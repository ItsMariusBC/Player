// components/music-visualizer/drawing.ts
import { VisualizerConfig } from './config';

// Draw bars visualizer
export const drawBars = (
  data: number[],
  canvas: HTMLCanvasElement,
  config: VisualizerConfig
): void => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (config.backgroundColor !== 'transparent') {
    ctx.fillStyle = config.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Store peak values if showing peaks
  const peakValues: number[] = [];
  if (config.showPeaks) {
    for (let i = 0; i < data.length; i++) {
      peakValues[i] = Math.max(data[i], peakValues[i] || 0);
      
      // Gradually decrease peak values over time
      peakValues[i] *= 0.99;
    }
  }

  // Draw the bars: every rectangle goes into one path, filled once per frame.
  ctx.fillStyle = config.barColor;
  const maxBarHeight = canvas.height * config.heightScale;
  const toHeight = (value: number) => Math.max(1, (value / 255) * maxBarHeight);
  const rounded = config.rounded && typeof ctx.roundRect === "function";
  const width = config.barWidth;
  const step = config.barWidth + config.gap;

  const addBar = (x: number, y: number, height: number) => {
    if (rounded) ctx.roundRect(x, y, width, height, 20);
    else ctx.rect(x, y, width, height);
  };

  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const barHeight = toHeight(data[i] || 1);
    const x = i * step;
    addBar(x, canvas.height - barHeight, barHeight);
    if (config.mirrorMode) addBar(x, 0, barHeight);

    if (config.showPeaks && peakValues[i]) {
      const peakHeight = toHeight(peakValues[i]);
      ctx.rect(x, canvas.height - peakHeight, width, 2);
      if (config.mirrorMode) ctx.rect(x, peakHeight, width, 2);
    }
  }
  ctx.fill();
};

// Draw wave visualizer
export const drawWave = (
  data: number[],
  canvas: HTMLCanvasElement,
  config: VisualizerConfig
): void => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (config.backgroundColor !== 'transparent') {
    ctx.fillStyle = config.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const centerY = canvas.height / 2;
  const amplitude = canvas.height / 4; // How tall the wave can be

  ctx.beginPath();
  ctx.moveTo(0, centerY);
  
  // Draw the top half of the wave
  for (let i = 0; i < data.length; i++) {
    const x = i * (canvas.width / data.length);
    const normalizedData = data[i] / 255; // Normalize to 0-1
    const y = centerY - normalizedData * amplitude;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  
  // If mirror mode is on, complete the shape by drawing the bottom half
  if (config.mirrorMode) {
    // Draw from right to left for bottom half
    for (let i = data.length - 1; i >= 0; i--) {
      const x = i * (canvas.width / data.length);
      const normalizedData = data[i] / 255;
      const y = centerY + normalizedData * amplitude;
      ctx.lineTo(x, y);
    }
    
    // Fill the wave
    ctx.fillStyle = config.barColor;
    ctx.fill();
  } else {
    // Just draw a line through to the end if not mirrored
    ctx.lineTo(canvas.width, centerY);
    
    // Style for single line
    ctx.strokeStyle = config.barColor;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
};

// Draw circle visualizer
export const drawCircle = (
  data: number[],
  canvas: HTMLCanvasElement,
  config: VisualizerConfig
): void => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (config.backgroundColor !== 'transparent') {
    ctx.fillStyle = config.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) * 0.7; // Base radius
  
  const angleStep = (Math.PI * 2) / data.length;
  
  ctx.beginPath();
  
  for (let i = 0; i < data.length; i++) {
    const amplitude = data[i] / 255;
    const adjustedRadius = radius * (1 + amplitude * 0.5);
    
    const angle = i * angleStep;
    const x = centerX + Math.cos(angle) * adjustedRadius;
    const y = centerY + Math.sin(angle) * adjustedRadius;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  
  ctx.closePath();
  
  // Fill or stroke based on mirror mode
  if (config.mirrorMode) {
    ctx.fillStyle = config.barColor;
    ctx.fill();
  } else {
    ctx.strokeStyle = config.barColor;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
};

// Draw particle visualizer
export const drawParticles = (
  data: number[],
  canvas: HTMLCanvasElement,
  config: VisualizerConfig
): void => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (config.backgroundColor !== 'transparent') {
    ctx.fillStyle = config.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  
  // Sample fewer data points for particles
  const step = Math.ceil(data.length / 50);
  
  for (let i = 0; i < data.length; i += step) {
    const amplitude = data[i] / 255;
    if (amplitude < 0.05) continue; // Skip very quiet parts
    
    const particleSize = amplitude * 10;
    const distance = amplitude * canvas.height / 2;
    
    // Angle based on index
    const angle = (i / data.length) * Math.PI * 2;
    
    // Calculate position
    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance;
    
    // Draw particle
    ctx.beginPath();
    ctx.arc(x, y, particleSize, 0, Math.PI * 2);
    ctx.fillStyle = config.barColor;
    ctx.fill();
    
    // Draw mirrored particle if enabled
    if (config.mirrorMode) {
      const mirrorX = centerX - Math.cos(angle) * distance;
      const mirrorY = centerY - Math.sin(angle) * distance;
      
      ctx.beginPath();
      ctx.arc(mirrorX, mirrorY, particleSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};

// Main draw function that calls specific drawing functions based on mode
export const draw = (
  data: number[],
  canvas: HTMLCanvasElement,
  config: VisualizerConfig
): void => {
  switch (config.mode) {
    case 'bars':
      drawBars(data, canvas, config);
      break;
    case 'wave':
      drawWave(data, canvas, config);
      break;
    case 'circle':
      drawCircle(data, canvas, config);
      break;
    case 'particles':
      drawParticles(data, canvas, config);
      break;
    default:
      drawBars(data, canvas, config);
  }
};

// Data calculation function (enhanced from original)
export const calculateBarData = (
  frequencyData: Uint8Array,
  width: number,
  barWidth: number,
  gap: number,
): number[] => {
  let units = width / (barWidth + gap);
  let step = Math.floor(frequencyData.length / units);

  if (units > frequencyData.length) {
    units = frequencyData.length;
    step = 1;
  }

  const data: number[] = [];

  for (let i = 0; i < units; i++) {
    let sum = 0;

    for (let j = 0; j < step && i * step + j < frequencyData.length; j++) {
      sum += frequencyData[i * step + j];
    }
    data.push(sum / step);
  }
  return data;
};
