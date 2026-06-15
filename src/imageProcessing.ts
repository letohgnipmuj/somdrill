import type { PreflightMetric, PreflightResult } from './types';

const MAX_DIMENSION = 1800;
const MIN_SHORT_SIDE = 320;
const BLUR_THRESHOLD = 7.5;
const EXTREME_LIGHT_THRESHOLD = 238;
const EXTREME_DARK_THRESHOLD = 18;
const MIN_VARIANCE_THRESHOLD = 300;
const MIN_FOREGROUND_RATIO = 0.012;

type Analysis = {
  mean: number;
  variance: number;
  foregroundRatio: number;
  darkRatio: number;
  lightRatio: number;
  edgeEnergy: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context is not available.');
  }
  return { canvas, context };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to read the selected image.'));
    };
    image.src = url;
  });
}

function computeStats(data: Uint8ClampedArray, width: number, height: number): Analysis {
  let sum = 0;
  let sumSquares = 0;
  let foreground = 0;
  let dark = 0;
  let light = 0;
  let edgeEnergy = 0;
  let pixelCount = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    sum += gray;
    sumSquares += gray * gray;
    if (gray < EXTREME_DARK_THRESHOLD) dark += 1;
    if (gray > EXTREME_LIGHT_THRESHOLD) light += 1;
    if (gray < 225) foreground += 1;
  }

  const mean = sum / pixelCount;
  const variance = sumSquares / pixelCount - mean * mean;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = (y * width + x) * 4;
      const center = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
      const right = data[idx + 4] * 0.299 + data[idx + 5] * 0.587 + data[idx + 6] * 0.114;
      const down = data[idx + width * 4] * 0.299 + data[idx + width * 4 + 1] * 0.587 + data[idx + width * 4 + 2] * 0.114;
      edgeEnergy += Math.abs(center - right) + Math.abs(center - down);
    }
  }

  return {
    mean,
    variance,
    foregroundRatio: foreground / pixelCount,
    darkRatio: dark / pixelCount,
    lightRatio: light / pixelCount,
    edgeEnergy: edgeEnergy / pixelCount,
  };
}

function generateNormalizedPreview(
  image: HTMLImageElement,
  targetWidth: number,
  targetHeight: number,
) {
  const { canvas, context } = createCanvas(targetWidth, targetHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
  const { data } = imageData;

  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    min = Math.min(min, gray);
    max = Math.max(max, gray);
  }

  const spread = Math.max(1, max - min);
  const contrastBoost = 255 / spread;

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    const adjusted = clamp(Math.round((gray - min) * contrastBoost), 0, 255);
    data[i] = adjusted;
    data[i + 1] = adjusted;
    data[i + 2] = adjusted;
    data[i + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function analyze(imageData: ImageData): Analysis {
  return computeStats(imageData.data, imageData.width, imageData.height);
}

function buildMetrics(result: Analysis): PreflightMetric[] {
  return [
    {
      label: 'Mean brightness',
      value: `${Math.round(result.mean)}/255`,
      status: result.mean > EXTREME_DARK_THRESHOLD && result.mean < EXTREME_LIGHT_THRESHOLD ? 'pass' : 'fail',
    },
    {
      label: 'Contrast variance',
      value: `${Math.round(result.variance)}`,
      status: result.variance >= MIN_VARIANCE_THRESHOLD ? 'pass' : 'fail',
    },
    {
      label: 'Foreground coverage',
      value: `${Math.round(result.foregroundRatio * 100)}%`,
      status: result.foregroundRatio >= MIN_FOREGROUND_RATIO ? 'pass' : 'fail',
    },
    {
      label: 'Edge energy',
      value: `${result.edgeEnergy.toFixed(1)}`,
      status: result.edgeEnergy >= BLUR_THRESHOLD ? 'pass' : 'fail',
    },
  ];
}

export async function inspectImage(file: File): Promise<PreflightResult> {
  const image = await loadImage(file);
  const { width, height } = image;

  const longestSide = Math.max(width, height);
  const scale = longestSide > MAX_DIMENSION ? MAX_DIMENSION / longestSide : 1;
  const normalizedWidth = Math.max(1, Math.round(width * scale));
  const normalizedHeight = Math.max(1, Math.round(height * scale));

  const { canvas, context } = createCanvas(normalizedWidth, normalizedHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, normalizedWidth, normalizedHeight);

  const normalizedImageData = context.getImageData(0, 0, normalizedWidth, normalizedHeight);
  const analysis = analyze(normalizedImageData);
  const metrics = buildMetrics(analysis);

  const reasons: string[] = [];
  if (Math.min(normalizedWidth, normalizedHeight) < MIN_SHORT_SIDE) {
    reasons.push('Image is too small to analyze reliably.');
  }
  if (analysis.variance < MIN_VARIANCE_THRESHOLD) {
    reasons.push('Image contrast is too low.');
  }
  if (analysis.edgeEnergy < BLUR_THRESHOLD) {
    reasons.push('Image appears too blurry.');
  }
  if (analysis.darkRatio < 0.001 && analysis.lightRatio > 0.995) {
    reasons.push('Image appears blank or washed out.');
  }
  if (analysis.foregroundRatio < MIN_FOREGROUND_RATIO) {
    reasons.push('Image does not contain enough drill-like content.');
  }

  const status = reasons.length === 0 ? 'pass' : 'fail';
  const normalizedDataUrl = status === 'pass' ? generateNormalizedPreview(image, normalizedWidth, normalizedHeight) : null;

  return {
    status,
    reasons,
    metrics,
    width,
    height,
    normalizedWidth,
    normalizedHeight,
    normalizedDataUrl,
  };
}
