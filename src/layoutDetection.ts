import type { PreflightResult } from './types';

const NORMAL_COLUMNS = 5;
const NORMAL_ROWS = 8;
const BAND_THRESHOLD_RATIO = 0.28;
const MIN_LINE_DARK_RATIO = 0.14;
const MIN_GRID_SCORE = 0.18;
const MIN_LINE_SPACING = 18;
const MAX_LINE_SPACING_VARIANCE = 0.35;

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GridLine = {
  position: number;
  thickness: number;
  strength: number;
};

export type LayoutRegion = {
  rect: Rect;
  confidence: number;
};

export type LayoutDetectionResult = {
  status: 'pass' | 'fail';
  confidence: number;
  warning?: string;
  orientation: 0 | 90 | 180 | 270;
  bounds: Rect;
  answerGrid: LayoutRegion;
  topRow: LayoutRegion;
  leftColumn: LayoutRegion;
  subtotalArea: LayoutRegion;
  totalArea: LayoutRegion;
  verticalLines: GridLine[];
  horizontalLines: GridLine[];
  overlayRects: Array<Rect & { label: string }>;
};

type ImageDataLike = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
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

function loadImageFromSource(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load normalized image.'));
    image.src = source;
  });
}

function toGray(data: Uint8ClampedArray, index: number) {
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
}

function rotateImageData(imageData: ImageDataLike, rotation: 0 | 90 | 180 | 270): ImageDataLike {
  if (rotation === 0) {
    return {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data),
    };
  }

  const srcWidth = imageData.width;
  const srcHeight = imageData.height;
  const dstWidth = rotation === 90 || rotation === 270 ? srcHeight : srcWidth;
  const dstHeight = rotation === 90 || rotation === 270 ? srcWidth : srcHeight;
  const dst = new Uint8ClampedArray(dstWidth * dstHeight * 4);

  for (let y = 0; y < srcHeight; y += 1) {
    for (let x = 0; x < srcWidth; x += 1) {
      const srcIndex = (y * srcWidth + x) * 4;
      let dstX = x;
      let dstY = y;

      if (rotation === 90) {
        dstX = srcHeight - 1 - y;
        dstY = x;
      } else if (rotation === 180) {
        dstX = srcWidth - 1 - x;
        dstY = srcHeight - 1 - y;
      } else if (rotation === 270) {
        dstX = y;
        dstY = srcWidth - 1 - x;
      }

      const dstIndex = (dstY * dstWidth + dstX) * 4;
      dst[dstIndex] = imageData.data[srcIndex];
      dst[dstIndex + 1] = imageData.data[srcIndex + 1];
      dst[dstIndex + 2] = imageData.data[srcIndex + 2];
      dst[dstIndex + 3] = imageData.data[srcIndex + 3];
    }
  }

  return { width: dstWidth, height: dstHeight, data: dst };
}

function estimateBands(
  imageData: ImageDataLike,
  axis: 'x' | 'y',
): GridLine[] {
  const { width, height, data } = imageData;
  const length = axis === 'x' ? width : height;
  const cross = axis === 'x' ? height : width;
  const scores: number[] = new Array(length).fill(0);

  for (let primary = 0; primary < length; primary += 1) {
    let darkPixels = 0;
    let total = 0;
    for (let secondary = 0; secondary < cross; secondary += 1) {
      const x = axis === 'x' ? primary : secondary;
      const y = axis === 'x' ? secondary : primary;
      const idx = (y * width + x) * 4;
      const gray = toGray(data, idx);
      if (gray < 170) {
        darkPixels += 1;
      }
      total += 1;
    }
    scores[primary] = darkPixels / total;
  }

  const peaks: GridLine[] = [];
  for (let i = 1; i < scores.length - 1; i += 1) {
    const score = scores[i];
    if (score < BAND_THRESHOLD_RATIO) continue;
    if (score < scores[i - 1] || score < scores[i + 1]) continue;

    let start = i;
    let end = i;
    while (start > 0 && scores[start - 1] >= BAND_THRESHOLD_RATIO * 0.7) start -= 1;
    while (end < scores.length - 1 && scores[end + 1] >= BAND_THRESHOLD_RATIO * 0.7) end += 1;

    const position = Math.round((start + end) / 2);
    const thickness = end - start + 1;
    peaks.push({ position, thickness, strength: score });
    i = end;
  }

  return peaks.sort((a, b) => b.strength - a.strength);
}

function pickBestSequence(lines: GridLine[], count: number): GridLine[] | null {
  if (lines.length < count) return null;

  const sorted = [...lines].sort((a, b) => a.position - b.position);
  let best: { score: number; sequence: GridLine[] } | null = null;

  for (let start = 0; start <= sorted.length - count; start += 1) {
    const sequence = sorted.slice(start, start + count);
    const spacings = [];
    for (let i = 1; i < sequence.length; i += 1) {
      spacings.push(sequence[i].position - sequence[i - 1].position);
    }
    const meanSpacing = spacings.reduce((sum, value) => sum + value, 0) / spacings.length;
    if (meanSpacing < MIN_LINE_SPACING) continue;
    const variance =
      spacings.reduce((sum, value) => sum + (value - meanSpacing) ** 2, 0) / Math.max(1, spacings.length);
    const normalizedVariance = Math.sqrt(variance) / meanSpacing;
    if (normalizedVariance > MAX_LINE_SPACING_VARIANCE) continue;
    const strength = sequence.reduce((sum, line) => sum + line.strength, 0) / sequence.length;
    const score = strength - normalizedVariance;
    if (!best || score > best.score) {
      best = { score, sequence };
    }
  }

  return best?.sequence ?? null;
}

function rectFromLines(vertical: GridLine[], horizontal: GridLine[]): Rect {
  const left = vertical[0].position;
  const right = vertical[vertical.length - 1].position;
  const top = horizontal[0].position;
  const bottom = horizontal[horizontal.length - 1].position;
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function cellsFromGrid(bounds: Rect, columns: number, rows: number) {
  const cellWidth = bounds.width / columns;
  const cellHeight = bounds.height / rows;
  const cells: Rect[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      cells.push({
        x: bounds.x + col * cellWidth,
        y: bounds.y + row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      });
    }
  }
  return cells;
}

function region(rect: Rect, confidence: number): LayoutRegion {
  return { rect, confidence: clamp(confidence, 0, 1) };
}

function scoreOrientation(imageData: ImageDataLike, orientation: 0 | 90 | 180 | 270) {
  const rotated = rotateImageData(imageData, orientation);
  const verticalBands = estimateBands(rotated, 'x');
  const horizontalBands = estimateBands(rotated, 'y');
  const gridVertical = pickBestSequence(verticalBands, NORMAL_COLUMNS + 1);
  const gridHorizontal = pickBestSequence(horizontalBands, NORMAL_ROWS + 1);
  if (!gridVertical || !gridHorizontal) {
    return { score: 0, rotated, verticalBands, horizontalBands };
  }

  const verticalStrength = gridVertical.reduce((sum, line) => sum + line.strength, 0) / gridVertical.length;
  const horizontalStrength = gridHorizontal.reduce((sum, line) => sum + line.strength, 0) / gridHorizontal.length;
  const bounds = rectFromLines(gridVertical, gridHorizontal);
  const areaRatio = (bounds.width * bounds.height) / (rotated.width * rotated.height);
  const score = verticalStrength + horizontalStrength + areaRatio;

  return { score, rotated, verticalBands, horizontalBands };
}

export async function detectNormalDrillLayout(normalizedDataUrl: string): Promise<LayoutDetectionResult> {
  const image = await loadImageFromSource(normalizedDataUrl);
  const { canvas, context } = createCanvas(image.width, image.height);
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, image.width, image.height);

  const orientations: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
  let best =
    orientations
      .map((orientation) => ({ orientation, ...scoreOrientation(imageData, orientation) }))
      .sort((a, b) => b.score - a.score)[0] ?? null;

  if (!best || best.score < MIN_GRID_SCORE) {
    return {
      status: 'fail',
      confidence: 0,
      warning: 'Could not find a stable normal-drill grid.',
      orientation: 0,
      bounds: { x: 0, y: 0, width: image.width, height: image.height },
      answerGrid: region({ x: 0, y: 0, width: 0, height: 0 }, 0),
      topRow: region({ x: 0, y: 0, width: 0, height: 0 }, 0),
      leftColumn: region({ x: 0, y: 0, width: 0, height: 0 }, 0),
      subtotalArea: region({ x: 0, y: 0, width: 0, height: 0 }, 0),
      totalArea: region({ x: 0, y: 0, width: 0, height: 0 }, 0),
      verticalLines: [],
      horizontalLines: [],
      overlayRects: [],
    };
  }

  const rotated = best.rotated;
  const gridVertical = pickBestSequence(best.verticalBands, NORMAL_COLUMNS + 1);
  const gridHorizontal = pickBestSequence(best.horizontalBands, NORMAL_ROWS + 1);
  if (!gridVertical || !gridHorizontal) {
    return {
      status: 'fail',
      confidence: 0,
      warning: 'Could not confirm the grid structure after orientation search.',
      orientation: best.orientation,
      bounds: { x: 0, y: 0, width: rotated.width, height: rotated.height },
      answerGrid: region({ x: 0, y: 0, width: 0, height: 0 }, 0),
      topRow: region({ x: 0, y: 0, width: 0, height: 0 }, 0),
      leftColumn: region({ x: 0, y: 0, width: 0, height: 0 }, 0),
      subtotalArea: region({ x: 0, y: 0, width: 0, height: 0 }, 0),
      totalArea: region({ x: 0, y: 0, width: 0, height: 0 }, 0),
      verticalLines: [],
      horizontalLines: [],
      overlayRects: [],
    };
  }

  const bounds = rectFromLines(gridVertical, gridHorizontal);
  const cellWidth = bounds.width / NORMAL_COLUMNS;
  const cellHeight = bounds.height / NORMAL_ROWS;
  const topRowHeight = cellHeight * 0.9;
  const leftColumnWidth = cellWidth * 0.95;
  const subtotalHeight = cellHeight * 0.85;
  const totalHeight = cellHeight * 0.85;

  const answerGridRect = bounds;
  const topRowRect = {
    x: bounds.x,
    y: Math.max(0, bounds.y - topRowHeight - cellHeight * 0.18),
    width: bounds.width,
    height: topRowHeight,
  };
  const leftColumnRect = {
    x: Math.max(0, bounds.x - leftColumnWidth - cellWidth * 0.12),
    y: bounds.y,
    width: leftColumnWidth,
    height: bounds.height,
  };
  const subtotalRect = {
    x: bounds.x,
    y: clamp(bounds.y + bounds.height + cellHeight * 0.15, 0, rotated.height),
    width: bounds.width,
    height: subtotalHeight,
  };
  const totalRect = {
    x: bounds.x,
    y: clamp(subtotalRect.y + subtotalRect.height + cellHeight * 0.1, 0, rotated.height),
    width: cellWidth * 1.7,
    height: totalHeight,
  };

  const confidence = clamp(
    (gridVertical.reduce((sum, line) => sum + line.strength, 0) / gridVertical.length +
      gridHorizontal.reduce((sum, line) => sum + line.strength, 0) / gridHorizontal.length) /
      2 +
      0.1,
    0,
    1,
  );

  const overlayRects = [
    { ...answerGridRect, label: 'Answer grid' },
    { ...topRowRect, label: 'Top row' },
    { ...leftColumnRect, label: 'Left column' },
    { ...subtotalRect, label: 'Subtotal area' },
    { ...totalRect, label: 'Total area' },
  ];

  return {
    status: 'pass',
    confidence,
    orientation: best.orientation,
    bounds,
    answerGrid: region(answerGridRect, confidence),
    topRow: region(topRowRect, confidence * 0.85),
    leftColumn: region(leftColumnRect, confidence * 0.85),
    subtotalArea: region(subtotalRect, confidence * 0.7),
    totalArea: region(totalRect, confidence * 0.7),
    verticalLines: gridVertical,
    horizontalLines: gridHorizontal,
    overlayRects,
  };
}
