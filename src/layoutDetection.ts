const NORMAL_COLUMNS = 5;
const NORMAL_ROWS = 8;
const CANONICAL_WIDTH = 1200;
const CANONICAL_HEIGHT = 1600;
const MIN_GRID_SCORE = 0.18;
const MIN_STRIPE_STRENGTH = 0.14;
const MAX_SPACING_VARIANCE = 0.32;
const MAX_CONSISTENCY_ERROR = 0.22;
const CELL_PADDING_RATIO = 0.16;

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

export type TransformMetadata = {
  sourceBounds: Rect;
  canonicalWidth: number;
  canonicalHeight: number;
  scaleX: number;
  scaleY: number;
  rotation: 0 | 90 | 180 | 270;
};

export type LayoutDiagnostics = {
  chosenHypothesis: string;
  transform: TransformMetadata;
  fieldConfidence: number;
  rejectionReason?: string;
  stripeSummary: {
    vertical: number;
    horizontal: number;
  };
  rectangleConsistency: number;
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
  warpedCanvasWidth: number;
  warpedCanvasHeight: number;
  warpedDataUrl: string | null;
  diagnostics: LayoutDiagnostics;
};

type ImageDataLike = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

type Stripe = {
  start: number;
  end: number;
  center: number;
  thickness: number;
  strength: number;
};

type OrientationCandidate = {
  orientation: 0 | 90 | 180 | 270;
  imageData: ImageDataLike;
  verticalStripes: Stripe[];
  horizontalStripes: Stripe[];
  score: number;
  hypothesis: string;
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

function scanAxis(imageData: ImageDataLike, axis: 'x' | 'y') {
  const { width, height, data } = imageData;
  const length = axis === 'x' ? width : height;
  const cross = axis === 'x' ? height : width;
  const intensities: number[] = [];

  for (let primary = 0; primary < length; primary += 1) {
    let darkRatio = 0;
    let edgeEnergy = 0;
    let lastDark = false;

    for (let secondary = 0; secondary < cross; secondary += 1) {
      const x = axis === 'x' ? primary : secondary;
      const y = axis === 'x' ? secondary : primary;
      const idx = (y * width + x) * 4;
      const gray = toGray(data, idx);
      const isDark = gray < 170;
      if (isDark) darkRatio += 1;
      if (secondary > 0 && isDark !== lastDark) edgeEnergy += 1;
      lastDark = isDark;
    }

    intensities.push((darkRatio / cross) * 0.75 + (edgeEnergy / cross) * 0.25);
  }

  return intensities;
}

function groupStripes(intensities: number[]): Stripe[] {
  const stripes: Stripe[] = [];
  let index = 0;
  while (index < intensities.length) {
    if (intensities[index] < MIN_STRIPE_STRENGTH) {
      index += 1;
      continue;
    }

    const start = index;
    let strength = 0;
    let end = index;
    while (end < intensities.length && intensities[end] >= MIN_STRIPE_STRENGTH * 0.75) {
      strength += intensities[end];
      end += 1;
    }

    const stripeEnd = end - 1;
    const thickness = stripeEnd - start + 1;
    stripes.push({
      start,
      end: stripeEnd,
      center: (start + stripeEnd) / 2,
      thickness,
      strength: strength / thickness,
    });
    index = end;
  }

  return stripes;
}

function buildLines(stripes: Stripe[]): GridLine[] {
  return stripes.map((stripe) => ({
    position: Math.round(stripe.center),
    thickness: stripe.thickness,
    strength: stripe.strength,
  }));
}

function sampleBestSequence(stripes: Stripe[], count: number) {
  if (stripes.length < count) return null;

  const ordered = [...stripes].sort((a, b) => a.center - b.center);
  let best: { score: number; sequence: Stripe[]; error: number } | null = null;

  for (let start = 0; start <= ordered.length - count; start += 1) {
    const sequence = ordered.slice(start, start + count);
    const gaps: number[] = [];
    for (let i = 1; i < sequence.length; i += 1) {
      gaps.push(sequence[i].center - sequence[i - 1].center);
    }

    const meanGap = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
    if (meanGap < 12) continue;
    const variance =
      gaps.reduce((sum, value) => sum + (value - meanGap) ** 2, 0) / Math.max(1, gaps.length);
    const normalizedVariance = Math.sqrt(variance) / meanGap;
    if (normalizedVariance > MAX_SPACING_VARIANCE) continue;

    const strength = sequence.reduce((sum, stripe) => sum + stripe.strength, 0) / sequence.length;
    const score = strength - normalizedVariance;
    if (!best || score > best.score) {
      best = { score, sequence, error: normalizedVariance };
    }
  }

  return best;
}

function estimateBounds(vertical: Stripe[], horizontal: Stripe[]): Rect {
  return {
    x: Math.max(0, vertical[0].start - 1),
    y: Math.max(0, horizontal[0].start - 1),
    width: Math.max(1, vertical[vertical.length - 1].end - vertical[0].start + 2),
    height: Math.max(1, horizontal[horizontal.length - 1].end - horizontal[0].start + 2),
  };
}

function buildWarp(imageData: ImageDataLike, bounds: Rect) {
  const { canvas, context } = createCanvas(CANONICAL_WIDTH, CANONICAL_HEIGHT);
  const source = createCanvas(imageData.width, imageData.height);
  source.context.putImageData(new ImageData(imageData.data, imageData.width, imageData.height), 0, 0);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source.canvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    CANONICAL_WIDTH,
    CANONICAL_HEIGHT,
  );

  return {
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
  };
}

function pointRectsFromGrid(
  bounds: Rect,
  vertical: GridLine[],
  horizontal: GridLine[],
  imageWidth: number,
  imageHeight: number,
) {
  const cellWidth = bounds.width / NORMAL_COLUMNS;
  const cellHeight = bounds.height / NORMAL_ROWS;
  const answerCells: Rect[] = [];
  const topRowCells: Rect[] = [];
  const leftColumnCells: Rect[] = [];
  const subtotalRects: Rect[] = [];

  for (let row = 0; row < NORMAL_ROWS; row += 1) {
    for (let col = 0; col < NORMAL_COLUMNS; col += 1) {
      const left = vertical[col].position;
      const right = vertical[col + 1].position;
      const top = horizontal[row].position;
      const bottom = horizontal[row + 1].position;
      const width = right - left;
      const height = bottom - top;
      const padX = width * CELL_PADDING_RATIO;
      const padY = height * CELL_PADDING_RATIO;
      answerCells.push({
        x: left + padX,
        y: top + padY,
        width: Math.max(1, width - padX * 2),
        height: Math.max(1, height - padY * 2),
      });
    }
  }

  for (let col = 0; col < NORMAL_COLUMNS; col += 1) {
    const left = vertical[col].position;
    const right = vertical[col + 1].position;
    const width = right - left;
    topRowCells.push({
      x: left + width * 0.14,
      y: Math.max(0, bounds.y - cellHeight * 0.86),
      width: Math.max(1, width * 0.72),
      height: cellHeight * 0.72,
    });
    subtotalRects.push({
      x: left + width * 0.18,
      y: clamp(bounds.y + bounds.height + cellHeight * 0.16, 0, imageHeight),
      width: Math.max(1, width * 0.62),
      height: cellHeight * 0.62,
    });
  }

  for (let row = 0; row < NORMAL_ROWS; row += 1) {
    const top = horizontal[row].position;
    const bottom = horizontal[row + 1].position;
    const height = bottom - top;
    leftColumnCells.push({
      x: Math.max(0, bounds.x - cellWidth * 0.88),
      y: top + height * 0.14,
      width: cellWidth * 0.68,
      height: Math.max(1, height * 0.72),
    });
  }

  const totalRect: Rect = {
    x: vertical[0].position,
    y: clamp(bounds.y + bounds.height + cellHeight * 0.88, 0, imageHeight),
    width: Math.max(1, vertical[1].position - vertical[0].position + cellWidth * 0.2),
    height: cellHeight * 0.72,
  };

  return {
    answerCells,
    topRowCells,
    leftColumnCells,
    subtotalRects,
    totalRect,
  };
}

function gridConsistency(vertical: GridLine[], horizontal: GridLine[]) {
  const vGaps = vertical.slice(1).map((line, index) => line.position - vertical[index].position);
  const hGaps = horizontal.slice(1).map((line, index) => line.position - horizontal[index].position);
  const meanV = vGaps.reduce((sum, value) => sum + value, 0) / vGaps.length;
  const meanH = hGaps.reduce((sum, value) => sum + value, 0) / hGaps.length;
  const vError = Math.sqrt(vGaps.reduce((sum, value) => sum + (value - meanV) ** 2, 0) / vGaps.length) / meanV;
  const hError = Math.sqrt(hGaps.reduce((sum, value) => sum + (value - meanH) ** 2, 0) / hGaps.length) / meanH;
  return clamp(1 - (vError + hError) / 2, 0, 1);
}

function scoreCandidate(
  imageData: ImageDataLike,
  vertical: GridLine[],
  horizontal: GridLine[],
  consistency: number,
) {
  const bounds = estimateBounds(vertical, horizontal);
  const coverage = (bounds.width * bounds.height) / (imageData.width * imageData.height);
  const verticalStrength = vertical.reduce((sum, line) => sum + line.strength, 0) / vertical.length;
  const horizontalStrength = horizontal.reduce((sum, line) => sum + line.strength, 0) / horizontal.length;
  return verticalStrength * 0.35 + horizontalStrength * 0.35 + coverage * 0.15 + consistency * 0.15;
}

function detectOrientation(imageData: ImageDataLike, orientation: 0 | 90 | 180 | 270): OrientationCandidate | null {
  const rotated = rotateImageData(imageData, orientation);
  const verticalStripes = groupStripes(scanAxis(rotated, 'x'));
  const horizontalStripes = groupStripes(scanAxis(rotated, 'y'));
  const verticalSequence = sampleBestSequence(verticalStripes, NORMAL_COLUMNS + 1);
  const horizontalSequence = sampleBestSequence(horizontalStripes, NORMAL_ROWS + 1);
  if (!verticalSequence || !horizontalSequence) return null;

  const vertical = buildLines(verticalSequence.sequence);
  const horizontal = buildLines(horizontalSequence.sequence);
  const consistency = gridConsistency(vertical, horizontal);
  const score = scoreCandidate(rotated, vertical, horizontal, consistency);

  return {
    orientation,
    imageData: rotated,
    verticalStripes: verticalSequence.sequence,
    horizontalStripes: horizontalSequence.sequence,
    score,
    hypothesis: `rotated-${orientation}-stripe-clustering`,
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

  const candidates = ([0, 90, 180, 270] as const)
    .map((orientation) => detectOrientation(imageData, orientation))
    .filter((candidate): candidate is OrientationCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < MIN_GRID_SCORE) {
    const rejectionReason = best
      ? 'Layout geometry was too inconsistent to trust.'
      : 'Could not find a stable normal-drill stripe pattern.';
    return {
      status: 'fail',
      confidence: 0,
      warning: rejectionReason,
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
      warpedCanvasWidth: CANONICAL_WIDTH,
      warpedCanvasHeight: CANONICAL_HEIGHT,
      warpedDataUrl: null,
      diagnostics: {
        chosenHypothesis: best?.hypothesis ?? 'none',
        transform: {
          sourceBounds: { x: 0, y: 0, width: image.width, height: image.height },
          canonicalWidth: CANONICAL_WIDTH,
          canonicalHeight: CANONICAL_HEIGHT,
          scaleX: CANONICAL_WIDTH / image.width,
          scaleY: CANONICAL_HEIGHT / image.height,
          rotation: 0,
        },
        fieldConfidence: 0,
        rejectionReason,
        stripeSummary: {
          vertical: best?.verticalStripes.length ?? 0,
          horizontal: best?.horizontalStripes.length ?? 0,
        },
        rectangleConsistency: 0,
      },
    };
  }

  const vertical = buildLines(best.verticalStripes);
  const horizontal = buildLines(best.horizontalStripes);
  const bounds = estimateBounds(vertical, horizontal);
  const fields = pointRectsFromGrid(bounds, vertical, horizontal, image.width, image.height);
  const consistency = gridConsistency(vertical, horizontal);
  const confidence = clamp(best.score * 0.65 + consistency * 0.35, 0, 1);
  const warp = buildWarp(best.imageData, bounds);
  const consistencyError = 1 - consistency;
  if (consistencyError > MAX_CONSISTENCY_ERROR) {
    return {
      status: 'fail',
      confidence,
      warning: 'Detected grid stripes were too irregular to trust.',
      orientation: best.orientation,
      bounds,
      answerCells: [],
      topRowCells: [],
      leftColumnCells: [],
      subtotalRects: [],
      totalRect: null,
      verticalLines: vertical,
      horizontalLines: horizontal,
      overlayRects: [],
      warpedCanvasWidth: CANONICAL_WIDTH,
      warpedCanvasHeight: CANONICAL_HEIGHT,
      warpedDataUrl: warp.dataUrl,
      diagnostics: {
        chosenHypothesis: best.hypothesis,
        transform: {
          sourceBounds: bounds,
          canonicalWidth: CANONICAL_WIDTH,
          canonicalHeight: CANONICAL_HEIGHT,
          scaleX: CANONICAL_WIDTH / bounds.width,
          scaleY: CANONICAL_HEIGHT / bounds.height,
          rotation: best.orientation,
        },
        fieldConfidence: confidence,
        rejectionReason: 'Rectangle consistency was too low.',
        stripeSummary: {
          vertical: best.verticalStripes.length,
          horizontal: best.horizontalStripes.length,
        },
        rectangleConsistency: consistency,
      },
    };
  }
  const overlayRects = [
    ...fields.answerCells.map((rect, index) => rectToOverlay(rect, `Answer ${index + 1}`)),
    ...fields.topRowCells.map((rect, index) => rectToOverlay(rect, `Top ${index + 1}`)),
    ...fields.leftColumnCells.map((rect, index) => rectToOverlay(rect, `Left ${index + 1}`)),
    ...fields.subtotalRects.map((rect, index) => rectToOverlay(rect, `Subtotal ${index + 1}`)),
    ...(fields.totalRect ? [rectToOverlay(fields.totalRect, 'Total')] : []),
  ];

  const transform: TransformMetadata = {
    sourceBounds: bounds,
    canonicalWidth: CANONICAL_WIDTH,
    canonicalHeight: CANONICAL_HEIGHT,
    scaleX: CANONICAL_WIDTH / bounds.width,
    scaleY: CANONICAL_HEIGHT / bounds.height,
    rotation: best.orientation,
  };

  return {
    status: confidence >= MIN_GRID_SCORE ? 'pass' : 'fail',
    confidence,
    orientation: best.orientation,
    bounds,
    answerCells: fields.answerCells,
    topRowCells: fields.topRowCells,
    leftColumnCells: fields.leftColumnCells,
    subtotalRects: fields.subtotalRects,
    totalRect: fields.totalRect,
    verticalLines: vertical,
    horizontalLines: horizontal,
    overlayRects,
    warpedCanvasWidth: CANONICAL_WIDTH,
    warpedCanvasHeight: CANONICAL_HEIGHT,
    warpedDataUrl: warp.dataUrl,
    diagnostics: {
      chosenHypothesis: best.hypothesis,
      transform,
      fieldConfidence: confidence,
      stripeSummary: {
        vertical: best.verticalStripes.length,
        horizontal: best.horizontalStripes.length,
      },
      rectangleConsistency: consistency,
    },
  };
}
