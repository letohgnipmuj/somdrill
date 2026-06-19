export type PreflightStatus = 'pass' | 'fail';

export type PreflightMetric = {
  label: string;
  value: string;
  status: PreflightStatus;
};

export type PreflightResult = {
  status: PreflightStatus;
  reasons: string[];
  metrics: PreflightMetric[];
  width: number;
  height: number;
  normalizedWidth: number;
  normalizedHeight: number;
  normalizedDataUrl: string | null;
  layoutDataUrl: string | null;
};
