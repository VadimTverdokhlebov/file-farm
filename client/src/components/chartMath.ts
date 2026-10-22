// Scale helpers shared by the chart components.

export function niceMax(peak: number): number {
  const padded = Math.max(peak * 1.15, 0.1);
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  return Math.ceil(padded / magnitude) * magnitude;
}

export function scaleMax(peak: number, fixedMax: number | null): number {
  if (!Number.isFinite(peak) || peak <= 0) {
    return fixedMax != null && fixedMax > 0 ? fixedMax : 1;
  }
  const auto = niceMax(peak);
  return fixedMax == null ? auto : Math.min(fixedMax, auto);
}

const MAJOR_STEPS_SEC = [10, 30, 60, 120, 300, 600, 1800, 3600];

export function formatTestSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.abs(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// A short tick every half of the labelled step, a long tick with a label at the
// labelled step, both on round test times so they slide left as the window moves.
export function testRulerTicks(startSec: number, windowSec: number): { sec: number; label: string | null }[] {
  const majorSec = MAJOR_STEPS_SEC.find((step) => windowSec / step <= 10) ?? MAJOR_STEPS_SEC[MAJOR_STEPS_SEC.length - 1];
  const minorSec = majorSec / 2;
  const ticks: { sec: number; label: string | null }[] = [];
  for (let sec = Math.ceil(startSec / minorSec) * minorSec; sec <= startSec + windowSec; sec += minorSec) {
    ticks.push({ sec, label: sec > 0 && sec % majorSec === 0 ? formatTestSeconds(sec) : null });
  }
  return ticks;
}

export function outageOverlapsWindow(
  stopAtSec: number,
  startAtSec: number,
  windowStartSec: number,
  windowSec: number,
): boolean {
  return startAtSec > windowStartSec && stopAtSec < windowStartSec + windowSec;
}

export function outagesOverlap(
  left: { server: string; stopAtSec: number; startAtSec: number },
  right: { server: string; stopAtSec: number; startAtSec: number },
): boolean {
  return left.server === right.server && left.stopAtSec < right.startAtSec && right.stopAtSec < left.startAtSec;
}

export function withoutPlannedOverlap<T extends { server: string; stopAtSec: number; startAtSec: number }>(
  manuals: T[],
  planned: T[],
): T[] {
  return manuals.filter((manual) => !planned.some((plan) => outagesOverlap(manual, plan)));
}

export function testClockOutages<T extends { server: string; stopAtSec: number; startAtSec: number }>(
  planned: T[] | undefined,
  manuals: T[],
): T[] {
  const schedule = planned ?? [];
  return [...schedule, ...withoutPlannedOverlap(manuals, schedule)];
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
