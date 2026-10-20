// Scale helpers shared by the chart components.

export function niceMax(peak: number): number {
  const padded = Math.max(peak * 1.15, 0.1);
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  return Math.ceil(padded / magnitude) * magnitude;
}

export function formatTick(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  if (value >= 100 || Number.isInteger(value)) {
    return String(Math.round(value));
  }
  return value.toFixed(1);
}
