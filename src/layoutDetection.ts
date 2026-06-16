const NORMAL_COLUMNS = 5;
const NORMAL_ROWS = 8;
const BAND_THRESHOLD_RATIO = 0.22;
const MIN_GRID_SCORE = 0.14;
const MIN_LINE_SPACING = 14;
const MAX_LINE_SPACING_VARIANCE = 0.42;
const CELL_PADDING_RATIO = 0.18;
const FIELD_PADDING_RATIO = 0.1;

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

export type LayoutDetectionResult = {
  status: 'pass' | 'fail';
  confidence: number;
  warning?: string;
  orientation: 0 | 90 | 180 | 270;
  bounds: Rect;
  answerCells: Rect[];
  topRowCells: Rect[];
  leftColumnCells: Rect[];
  subtotalRects: Rect[];
  totalRect: Rect | null;
  verticalLines: GridLine[];
  horizontalLines: GridLine[];
  overlayRects: Array<Rect & { label: string }>;
};

type ImageDataLike = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

type LineScanResult = {
  position: number;
  thickness: number;
  strength: number;
};

type OrientationResult = {
  orientation: 0 | 90 | 180 | 270;
  score: number;
  imageData: ImageDataLike;
  verticalLines: GridLine[];
  horizontalLines: GridLine[];
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

function scanLines(imageData: ImageDataLike, axis: 'x' | 'y'): LineScanResult[] {
  const { width, height, data } = imageData;
  const length = axis === 'x' ? width : height;
  const cross = axis === 'x' ? height : width;
  const scans: LineScanResult[] = [];

  for (let primary = 0; primary < length; primary += 1) {
    let darkPixels = 0;
    let edgeChanges = 0;
    let lastDark = false;

    for (let secondary = 0; secondary < cross; secondary += 1) {
      const x = axis === 'x' ? primary : secondary;
      const y = axis === 'x' ? secondary : primary;
      const idx = (y * width + x) * 4;
      const gray = toGray(data, idx);
      const isDark = gray < 170;
      if (isDark) darkPixels += 1;
      if (secondary > 0 && isDark !== lastDark) edgeChanges += 1;
      lastDark = isDark;
    }

    const darkRatio = darkPixels / cross;
    const continuity = edgeChanges / cross;
    const strength = darkRatio * 0.8 + continuity * 0.2;
    scans.push({ position: primary, thickness: 1, strength });
  }

  return scans;
}

function collectPeaks(scans: LineScanResult[]): GridLine[] {
  const peaks: GridLine[] = [];
  for (let i = 1; i < scans.length - 1; i += 1) {
    const current = scans[i];
    if (current.strength < BAND_THRESHOLD_RATIO) continue;
    if (current.strength < scans[i - 1].strength || current.strength < scans[i + 1].strength) continue;

    let start = i;
    let end = i;
    while (start > 0 && scans[start - 1].strength >= BAND_THRESHOLD_RATIO * 0.68) start -= 1;
    while (end < scans.length - 1 && scans[end + 1].strength >= BAND_THRESHOLD_RATIO * 0.68) end += 1;
    const strength = scans.slice(start, end + 1).reduce((sum, line) => sum + line.strength, 0) / (end - start + 1);
    peaks.push({
      position: Math.round((start + end) / 2),
      thickness: end - start + 1,
      strength,
    });
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

function expandRect(rect: Rect, padX: number, padY: number, maxWidth: number, maxHeight: number): Rect {
  const x = clamp(rect.x - padX, 0, maxWidth);
  const y = clamp(rect.y - padY, 0, maxHeight);
  const right = clamp(rect.x + rect.width + padX, 0, maxWidth);
  const bottom = clamp(rect.y + rect.height + padY, 0, maxHeight);
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

function rectFromLines(vertical: GridLine[], horizontal: GridLine[]): Rect {
  return {
    x: vertical[0].position,
    y: horizontal[0].position,
    width: Math.max(1, vertical[vertical.length - 1].position - vertical[0].position),
    height: Math.max(1, horizontal[horizontal.length - 1].position - horizontal[0].position),
  };
}

function cellRectsFromLines(vertical: GridLine[], horizontal: GridLine[], paddingRatio: number): Rect[] {
  const rects: Rect[] = [];
  for (let row = 0; row < horizontal.length - 1; row += 1) {
    for (let col = 0; col < vertical.length - 1; col += 1) {
      const left = vertical[col].position;
      const right = vertical[col + 1].position;
      const top = horizontal[row].position;
      const bottom = horizontal[row + 1].position;
      const width = right - left;
      const height = bottom - top;
      const padX = width * paddingRatio;
      const padY = height * paddingRatio;
      rects.push({
        x: left + padX,
        y: top + padY,
        width: Math.max(1, width - padX * 2),
        height: Math.max(1, height - padY * 2),
      });
    }
  }
  return rects;
}

function fieldRectsFromGrid(
  bounds: Rect,
  vertical: GridLine[],
  horizontal: GridLine[],
  imageWidth: number,
  imageHeight: number,
) {
  const cellWidth = bounds.width / NORMAL_COLUMNS;
  const cellHeight = bounds.height / NORMAL_ROWS;
  const answerCells = cellRectsFromLines(vertical, horizontal, CELL_PADDING_RATIO);
  const topRowCells: Rect[] = [];
  const leftColumnCells: Rect[] = [];
  const subtotalRects: Rect[] = [];

  const topBandHeight = cellHeight * 0.9;
  const leftBandWidth = cellWidth * 0.95;
  const subtotalBandHeight = cellHeight * 0.85;
  const totalBandHeight = cellHeight * 0.9;

  for (let col = 0; col < NORMAL_COLUMNS; col += 1) {
    const left = vertical[col].position;
    const right = vertical[col + 1].position;
    const width = right - left;
    topRowCells.push({
      x: left + width * FIELD_PADDING_RATIO,
      y: Math.max(0, bounds.y - topBandHeight - cellHeight * 0.2),
      width: Math.max(1, width - width * FIELD_PADDING_RATIO * 2),
      height: topBandHeight,
    });
  }

  for (let row = 0; row < NORMAL_ROWS; row += 1) {
    const top = horizontal[row].position;
    const bottom = horizontal[row + 1].position;
    const height = bottom - top;
    leftColumnCells.push({
      x: Math.max(0, bounds.x - leftBandWidth - cellWidth * 0.14),
      y: top + height * FIELD_PADDING_RATIO,
      width: leftBandWidth,
      height: Math.max(1, height - height * FIELD_PADDING_RATIO * 2),
    });
  }

  for (let col = 0; col < NORMAL_COLUMNS; col += 1) {
    const left = vertical[col].position;
    const right = vertical[col + 1].position;
    const width = right - left;
    subtotalRects.push({
      x: left + width * 0.18,
      y: clamp(bounds.y + bounds.height + cellHeight * 0.2, 0, imageHeight),
      width: Math.max(1, width * 0.65),
      height: subtotalBandHeight,
    });
  }

  const totalRect: Rect = {
    x: vertical[0].position,
    y: clamp(bounds.y + bounds.height + subtotalBandHeight + cellHeight * 0.32, 0, imageHeight),
    width: Math.max(1, vertical[1].position - vertical[0].position + cellWidth * 0.25),
    height: totalBandHeight,
  };

  return {
    answerCells,
    topRowCells,
    leftColumnCells,
    subtotalRects,
    totalRect,
  };
}

function scoreLayout(
  imageData: ImageDataLike,
  vertical: GridLine[],
  horizontal: GridLine[],
): number {
  const bounds = rectFromLines(vertical, horizontal);
  const coverage = (bounds.width * bounds.height) / (imageData.width * imageData.height);
  const verticalStrength = vertical.reduce((sum, line) => sum + line.strength, 0) / vertical.length;
  const horizontalStrength = horizontal.reduce((sum, line) => sum + line.strength, 0) / horizontal.length;
  return verticalStrength * 0.4 + horizontalStrength * 0.4 + coverage * 0.2;
}

function detectOrientation(imageData: ImageDataLike, orientation: 0 | 90 | 180 | 270): OrientationResult | null {
  const rotated = rotateImageData(imageData, orientation);
  const verticalScans = collectPeaks(scanLines(rotated, 'x'));
  const horizontalScans = collectPeaks(scanLines(rotated, 'y'));
  const verticalLines = pickBestSequence(verticalScans, NORMAL_COLUMNS + 1);
  const horizontalLines = pickBestSequence(horizontalScans, NORMAL_ROWS + 1);
  if (!verticalLines || !horizontalLines) {
    return null;
  }

  return {
    orientation,
    score: scoreLayout(rotated, verticalLines, horizontalLines),
    imageData: rotated,
    verticalLines,
    horizontalLines,
  };
}

function rectToOverlay(rect: Rect, label: string) {
  return { ...rect, label };
}

export async function detectNormalDrillLayout(normalizedDataUrl: string): Promise<LayoutDetectionResult> {
  const image = await loadImageFromSource(normalizedDataUrl);
  const { canvas, context } = createCanvas(image.width, image.height);
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, image.width, image.height);

  const orientations: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
  const candidates = orientations
    .map((orientation) => detectOrientation(imageData, orientation))
    .filter((candidate): candidate is OrientationResult => candidate !== null)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < MIN_GRID_SCORE) {
    return {
      status: 'fail',
      confidence: 0,
      warning: 'Could not find a stable normal-drill layout.',
      orientation: 0,
      bounds: { x: 0, y: 0, width: image.width, height: image.height },
      answerCells: [],
      topRowCells: [],
      leftColumnCells: [],
      subtotalRects: [],
      totalRect: null,
      verticalLines: [],
      horizontalLines: [],
      overlayRects: [],
    };
  }

  const bounds = rectFromLines(best.verticalLines, best.horizontalLines);
  const fields = fieldRectsFromGrid(bounds, best.verticalLines, best.horizontalLines, best.imageData.width, best.imageData.height);
  const confidence = clamp(best.score, 0, 1);
  const overlayRects = [
    ...fields.answerCells.map((rect, index) => rectToOverlay(rect, `Answer ${index + 1}`)),
    ...fields.topRowCells.map((rect, index) => rectToOverlay(rect, `Top ${index + 1}`)),
    ...fields.leftColumnCells.map((rect, index) => rectToOverlay(rect, `Left ${index + 1}`)),
    ...fields.subtotalRects.map((rect, index) => rectToOverlay(rect, `Subtotal ${index + 1}`)),
    ...(fields.totalRect ? [rectToOverlay(fields.totalRect, 'Total')] : []),
  ];

  return {
    status: 'pass',
    confidence,
    orientation: best.orientation,
    bounds,
    answerCells: fields.answerCells,
    topRowCells: fields.topRowCells,
    leftColumnCells: fields.leftColumnCells,
    subtotalRects: fields.subtotalRects,
    totalRect: fields.totalRect,
    verticalLines: best.verticalLines,
    horizontalLines: best.horizontalLines,
    overlayRects,
  };
}
