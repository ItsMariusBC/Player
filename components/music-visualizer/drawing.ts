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

  // Draw the bars
  ctx.fillStyle = config.barColor;
  
  for (let i = 0; i < data.length; i++) {
    const dataValue = data[i] || 1;
    const barHeight = dataValue / 2; // Scale down for better visuals
    
    const x = i * (config.barWidth + config.gap);
    const y = canvas.height - barHeight;
    const width = config.barWidth;
    const height = barHeight;

    if (config.rounded && ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, 20);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, width, height);
    }
    
    // Draw mirror if mirrorMode is enabled
    if (config.mirrorMode) {
      const mirrorY = 0;
      if (config.rounded && ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, mirrorY, width, barHeight, 20);
        ctx.fill();
      } else {
        ctx.fillRect(x, mirrorY, width, barHeight);
      }
    }
    
    // Draw peak markers if enabled
    if (config.showPeaks && peakValues[i]) {
      const peakY = canvas.height - peakValues[i] / 2;
      ctx.fillRect(x, peakY, width, 2);
      
      if (config.mirrorMode) {
        const mirrorPeakY = peakValues[i] / 2;
        ctx.fillRect(x, mirrorPeakY, width, 2);
      }
    }
  }
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
