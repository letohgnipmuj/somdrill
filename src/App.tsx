import { useState } from 'react';
import { inspectImage } from './imageProcessing';
import { detectNormalDrillLayout } from './layoutDetection';
import type { PreflightResult } from './types';

const DEFAULT_HINTS = [
  'Use a cropped drill photo, not a full page.',
  'Keep the sheet flat and well lit.',
  'Avoid heavy shadows, glare, or motion blur.',
];

function StatusBadge({ status }: { status: 'pass' | 'fail' }) {
  return <span className={`badge badge-${status}`}>{status === 'pass' ? 'Pass' : 'Fail'}</span>;
}

export default function App() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [layout, setLayout] = useState<Awaited<ReturnType<typeof detectNormalDrillLayout>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setLayout(null);
    setFileName(file.name);

    try {
      const analysis = await inspectImage(file);
      setResult(analysis);
      if (analysis.status === 'pass' && analysis.layoutDataUrl) {
        const detectedLayout = await detectNormalDrillLayout(analysis.layoutDataUrl);
        setLayout(detectedLayout);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to analyze the image.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Version 0</p>
          <h1>Drill Checker intake</h1>
          <p className="lede">
            Upload a cropped drill image. The app performs a simple preflight check and prepares a normalized
            preview for later OCR and layout detection.
          </p>
        </div>
        <div className="hero-card">
          <h2>Basic intake rules</h2>
          <ul>
            <li>Accept one cropped drill image at a time.</li>
            <li>Reject only obvious bad photos.</li>
            <li>Do not try to detect operation, digits, or drill type here.</li>
          </ul>
        </div>
      </section>

      <section className="panel">
        <div className="upload-row">
          <label className="upload">
            <span>Choose drill image</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <div className="help">
            {DEFAULT_HINTS.map((hint) => (
              <p key={hint}>{hint}</p>
            ))}
          </div>
        </div>

        {loading && <p className="state">Analyzing image...</p>}
        {error && <p className="state state-error">{error}</p>}

        {!loading && result && (
          <div className="results">
            <div className={`summary summary-${result.status}`}>
              <div>
                <p className="summary-label">Preflight</p>
                <h2>{result.status === 'pass' ? 'Image accepted' : 'Image rejected'}</h2>
              </div>
              <StatusBadge status={result.status} />
            </div>

            <div className="meta">
              <div>
                <span>File</span>
                <strong>{fileName}</strong>
              </div>
              <div>
                <span>Original size</span>
                <strong>
                  {result.width} x {result.height}
                </strong>
              </div>
              <div>
                <span>Normalized size</span>
                <strong>
                  {result.normalizedWidth} x {result.normalizedHeight}
                </strong>
              </div>
            </div>

            <div className="metrics">
              {result.metrics.map((metric) => (
                <div className="metric" key={metric.label}>
                  <div className="metric-top">
                    <span>{metric.label}</span>
                    <StatusBadge status={metric.status} />
                  </div>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>

            {result.reasons.length > 0 && (
              <div className="reasons">
                <h3>Why it was rejected</h3>
                <ul>
                  {result.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.status === 'pass' && result.normalizedDataUrl && (
              <div className="preview">
                <h3>Canonical warp preview</h3>
                <div
                  className="preview-stage"
                  style={{
                    aspectRatio: `${layout?.warpedCanvasWidth ?? result.normalizedWidth} / ${
                      layout?.warpedCanvasHeight ?? result.normalizedHeight
                    }`,
                  }}
                >
                  <img
                    src={layout?.status === 'pass' && layout.warpedDataUrl ? layout.warpedDataUrl : result.normalizedDataUrl}
                    alt="Canonical drill preview"
                  />
                  {layout?.status === 'pass' && (
                    <svg
                      className="overlay"
                      viewBox={`0 0 ${layout.warpedCanvasWidth} ${layout.warpedCanvasHeight}`}
                      aria-hidden="true"
                    >
                      {layout.overlayRects.map((rect) => (
                        <rect
                          key={rect.label}
                          x={rect.x}
                          y={rect.y}
                          width={rect.width}
                          height={rect.height}
                          className={`overlay-rect overlay-${rect.label.toLowerCase().replaceAll(' ', '-')}`}
                        />
                      ))}
                    </svg>
                  )}
                </div>
              </div>
            )}

            {layout && (
              <div className={`layout-summary layout-${layout.status}`}>
                <div className="layout-header">
                  <div>
                    <p className="summary-label">Layout detection</p>
                    <h3>{layout.status === 'pass' ? 'Normal drill structure found' : 'Layout not found'}</h3>
                  </div>
                  <StatusBadge status={layout.status} />
                </div>
                <div className="layout-grid">
                  <div>
                    <span>Stage</span>
                    <strong>{layout.diagnostics.stage}</strong>
                  </div>
                  <div>
                    <span>Orientation</span>
                    <strong>{layout.orientation}°</strong>
                  </div>
                  <div>
                    <span>Confidence</span>
                    <strong>{Math.round(layout.confidence * 100)}%</strong>
                  </div>
                  <div>
                    <span>Candidate score</span>
                    <strong>{Math.round(layout.diagnostics.candidateScore * 1000) / 1000}</strong>
                  </div>
                  <div>
                    <span>Answer cells</span>
                    <strong>{layout.answerCells.length}</strong>
                  </div>
                  <div>
                    <span>Top row cells</span>
                    <strong>{layout.topRowCells.length}</strong>
                  </div>
                  <div>
                    <span>Left column cells</span>
                    <strong>{layout.leftColumnCells.length}</strong>
                  </div>
                  <div>
                    <span>Warnings</span>
                    <strong>{layout.warning ?? 'None'}</strong>
                  </div>
                  <div>
                    <span>Hypothesis</span>
                    <strong>{layout.diagnostics.chosenHypothesis}</strong>
                  </div>
                  <div>
                    <span>Consistency</span>
                    <strong>{Math.round(layout.diagnostics.rectangleConsistency * 100)}%</strong>
                  </div>
                  <div>
                    <span>Grid bounds</span>
                    <strong>
                      {Math.round(layout.bounds.x)}, {Math.round(layout.bounds.y)} / {Math.round(layout.bounds.width)} x {Math.round(
                        layout.bounds.height,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Content bounds</span>
                    <strong>
                      {layout.diagnostics.contentBounds
                        ? `${Math.round(layout.diagnostics.contentBounds.x)}, ${Math.round(layout.diagnostics.contentBounds.y)} / ${Math.round(layout.diagnostics.contentBounds.width)} x ${Math.round(layout.diagnostics.contentBounds.height)}`
                        : 'None'}
                    </strong>
                  </div>
                </div>
                <div className="layout-debug">
                  <p className="summary-label">Debug</p>
                  <p>{layout.warning ?? layout.diagnostics.rejectionReason ?? 'No layout warning.'}</p>
                  <p>
                    Stripe counts: V {layout.diagnostics.stripeSummary.vertical}, H {layout.diagnostics.stripeSummary.horizontal}
                  </p>
                  <p>
                    Transform: rotation {layout.diagnostics.transform.rotation}°, scale {layout.diagnostics.transform.scaleX.toFixed(2)} x {layout.diagnostics.transform.scaleY.toFixed(2)}
                  </p>
                  <p>
                    Source bounds: {Math.round(layout.diagnostics.transform.sourceBounds.x)}, {Math.round(
                      layout.diagnostics.transform.sourceBounds.y,
                    )} / {Math.round(layout.diagnostics.transform.sourceBounds.width)} x {Math.round(
                      layout.diagnostics.transform.sourceBounds.height,
                    )}
                  </p>
                </div>
              </div>
            )}          </div>
        )}
      </section>
    </main>
  );
}
