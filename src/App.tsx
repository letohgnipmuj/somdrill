import { useState } from 'react';
import { inspectImage } from './imageProcessing';
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
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setFileName(file.name);

    try {
      const analysis = await inspectImage(file);
      setResult(analysis);
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
          <p className="eyebrow">Cycle 2 prototype</p>
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
                <h3>Normalized preview</h3>
                <img src={result.normalizedDataUrl} alt="Normalized drill preview" />
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
