import { useState } from 'react';
import { BalancerAlgorithm, SeriesRun, SeriesSample, SeriesStatus } from '../types/loadTest';
import { ChartScrollBar } from './ChartScrollBar';
import { formatTick, niceMax } from './chartMath';

const COLORS = ['#1f6f5b', '#2563eb', '#d97706', '#be123c', '#7c3aed', '#0891b2', '#65a30d', '#6b7280'];

type MetricKey = 'cpuMad' | 'rps' | 'p50Ms' | 'p95Ms' | 'p99Ms' | 'errorPct';

const METRICS: { key: MetricKey; label: string; unit: string; fixedMax: number | null; digits: number }[] = [
  { key: 'cpuMad', label: 'CPU MAD', unit: '%', fixedMax: 50, digits: 1 },
  { key: 'rps', label: 'RPS', unit: '', fixedMax: null, digits: 1 },
  { key: 'p50Ms', label: 'Latency p50', unit: 'ms', fixedMax: null, digits: 1 },
  { key: 'p95Ms', label: 'Latency p95', unit: 'ms', fixedMax: null, digits: 0 },
  { key: 'p99Ms', label: 'Latency p99', unit: 'ms', fixedMax: null, digits: 0 },
  { key: 'errorPct', label: 'Errors', unit: '%', fixedMax: 100, digits: 2 },
];

const VIEW_W = 640;
const VIEW_H = 206;
const PAD = { top: 10, right: 12, bottom: 28, left: 42 };
const MINOR_TICK = 3;
const MAJOR_TICK = 7;
// Display smoothing: each point is the mean of this many seconds on both sides.
const SMOOTH_HALF_WIDTH = 3;
// Ruler steps in seconds, the smallest that keeps the labels to about ten.
const MAJOR_STEPS_SEC = [10, 30, 60, 120, 300, 600, 1800, 3600];
// Chart windows in seconds, the same set as on the server charts.
const RANGES = [
  { label: '3 min', sec: 3 * 60 },
  { label: '10 min', sec: 10 * 60 },
  { label: '30 min', sec: 30 * 60 },
  { label: '1 h', sec: 60 * 60 },
];

export function AlgorithmComparison({
  series,
  algorithms,
}: {
  series: SeriesStatus | null;
  algorithms: BalancerAlgorithm[];
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  // null follows the test: the shortest window that holds the whole run.
  const [rangeSec, setRangeSec] = useState<number | null>(null);
  // null follows the latest data, a number is where the scrolled window starts.
  const [scrollSec, setScrollSec] = useState<number | null>(null);

  const emptyWindowSec = rangeSec ?? RANGES[0].sec;
  if (!series || series.runs.length === 0) {
    return (
      <>
        <div className="load-chart-range" role="group" aria-label="Chart interval">
          {RANGES.map((item) => (
            <button
              key={item.sec}
              type="button"
              aria-pressed={item.sec === emptyWindowSec}
              onClick={() => setRangeSec(item.sec)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="load-empty">No runs yet. Pick algorithms and press Start.</p>
        <ChartScrollBar
          total={0}
          window={emptyWindowSec}
          start={0}
          onScroll={setScrollSec}
          label="Scroll the charts"
        />
      </>
    );
  }

  const nameOf = (id: string) => algorithms.find((item) => item.id === id)?.name ?? id;
  const colorOf = (id: string, runIndex: number) => {
    const position = algorithms.findIndex((item) => item.id === id);
    return COLORS[(position >= 0 ? position : runIndex) % COLORS.length];
  };
  const withSamples = (run: SeriesRun) => (run.samples?.length ?? 0) > 0;
  const shown = series.runs
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => withSamples(run) && !hidden.includes(run.algorithm));
  const windowSec =
    rangeSec ?? (RANGES.find((item) => item.sec >= series.durationSec) ?? RANGES[RANGES.length - 1]).sec;
  // The window ends at the latest sample, like the server charts, and starts at 0 until the test outgrows it.
  const latestSec = Math.max(0, ...shown.flatMap(({ run }) => (run.samples ?? []).map((sample) => sample.t)));
  const lastStartSec = Math.max(0, latestSec - windowSec);
  const windowStartSec = scrollSec === null ? lastStartSec : Math.min(Math.max(scrollSec, 0), lastStartSec);
  const toggle = (id: string) => {
    setHidden((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  return (
    <>
      <div className="load-chart-range" role="group" aria-label="Algorithms on the charts">
        {series.runs.map((run, index) => (
          <button
            key={run.algorithm}
            type="button"
            className="load-algorithm-toggle"
            aria-pressed={withSamples(run) && !hidden.includes(run.algorithm)}
            disabled={!withSamples(run)}
            onClick={() => toggle(run.algorithm)}
            title={run.error}
          >
            <i style={{ background: colorOf(run.algorithm, index) }} />
            {nameOf(run.algorithm)}
            {runSuffix(run)}
          </button>
        ))}
      </div>
      <div className="load-chart-range" role="group" aria-label="Chart interval">
        {RANGES.map((item) => (
          <button
            key={item.sec}
            type="button"
            aria-pressed={item.sec === windowSec}
            onClick={() => setRangeSec(item.sec)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="load-charts">
        {METRICS.map((metric) => (
          <article className="load-chart" key={metric.key}>
            <h3>{metric.label}{metric.unit ? `, ${metric.unit}` : ''}</h3>
            <div className="load-legend">
              {shown.length === 0 ? (
                <span>Turn an algorithm on to see its line</span>
              ) : shown.map(({ run, index }) => (
                <span key={run.algorithm}>
                  <i style={{ background: colorOf(run.algorithm, index) }} />
                  {nameOf(run.algorithm)} {mean(run.samples ?? [], metric.key).toFixed(metric.digits)}
                </span>
              ))}
            </div>
            <ComparisonChart
              runs={shown.map(({ run, index }) => ({ run, color: colorOf(run.algorithm, index) }))}
              metric={metric.key}
              fixedMax={metric.fixedMax}
              windowStartSec={windowStartSec}
              windowSec={windowSec}
              series={series}
            />
          </article>
        ))}
      </div>
      <ChartScrollBar
        total={latestSec}
        window={windowSec}
        start={windowStartSec}
        onScroll={setScrollSec}
        label="Scroll the charts"
      />
    </>
  );
}

function runSuffix(run: SeriesRun): string {
  switch (run.state) {
    case 'running':
      return ' · running';
    case 'pending':
      return ' · pending';
    case 'failed':
      return ' · failed';
    case 'stopped':
      return ' · stopped';
    default:
      return '';
  }
}

function ComparisonChart({
  runs,
  metric,
  fixedMax,
  windowStartSec,
  windowSec,
  series,
}: {
  runs: { run: SeriesRun; color: string }[];
  metric: MetricKey;
  fixedMax: number | null;
  windowStartSec: number;
  windowSec: number;
  series: SeriesStatus;
}) {
  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = VIEW_H - PAD.top - PAD.bottom;
  const lines = runs.map(({ run, color }) => ({
    id: run.algorithm,
    color,
    points: smooth(run.samples ?? [], metric).filter(
      (point) => point.t >= windowStartSec && point.t <= windowStartSec + windowSec,
    ),
  }));
  const peak = Math.max(0, ...lines.flatMap((line) => line.points.map((point) => point.value)));
  const max = scaleMax(peak, fixedMax);
  const yTicks = [max, max / 2, 0];
  const bottom = PAD.top + plotH;
  const xOf = (sec: number) =>
    PAD.left + Math.min(Math.max((sec - windowStartSec) / windowSec, 0), 1) * plotW;
  const yOf = (value: number) => PAD.top + plotH - (Math.min(Math.max(value, 0), max) / max) * plotH;

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={metric}>
      {(series.outages ?? [])
        .filter((outage) => outage.startAtSec > windowStartSec && outage.stopAtSec < windowStartSec + windowSec)
        .map((outage) => (
        <g key={`${outage.server}-${outage.stopAtSec}`}>
          <rect
            x={xOf(outage.stopAtSec)}
            y={PAD.top}
            width={Math.max(xOf(outage.startAtSec) - xOf(outage.stopAtSec), 0)}
            height={plotH}
            className="load-chart-outage"
          >
            <title>{`${outage.server} stopped from ${formatSeconds(outage.stopAtSec)} to ${formatSeconds(outage.startAtSec)}`}</title>
          </rect>
          {outage.stopAtSec >= windowStartSec && (
            <text x={xOf(outage.stopAtSec) + 3} y={PAD.top + 10} className="load-chart-outage-label">
              {`S${outage.server.replace(/\D+/g, '')}`}
            </text>
          )}
        </g>
      ))}
      {yTicks.map((tick) => (
        <g key={tick}>
          <line x1={PAD.left} x2={VIEW_W - PAD.right} y1={yOf(tick)} y2={yOf(tick)} className="load-chart-grid" />
          <text x={PAD.left - 6} y={yOf(tick) + 4} className="load-chart-tick" textAnchor="end">
            {formatTick(tick)}
          </text>
        </g>
      ))}
      {rulerTicks(windowStartSec, windowSec).map((tick) => (
        <g key={tick.sec}>
          <line
            x1={xOf(tick.sec)}
            x2={xOf(tick.sec)}
            y1={bottom}
            y2={bottom + (tick.label ? MAJOR_TICK : MINOR_TICK)}
            className="load-chart-ruler"
          />
          {tick.label && (
            <text x={xOf(tick.sec)} y={VIEW_H - 6} className="load-chart-tick" textAnchor="middle">
              {tick.label}
            </text>
          )}
        </g>
      ))}
      {lines.map((line) => (
        <polyline
          key={line.id}
          points={line.points.map((point) => `${xOf(point.t)},${yOf(point.value)}`).join(' ')}
          fill="none"
          stroke={line.color}
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function mean(samples: SeriesSample[], metric: MetricKey): number {
  if (samples.length === 0) {
    return 0;
  }
  return samples.reduce((sum, sample) => sum + sample[metric], 0) / samples.length;
}

function smooth(samples: SeriesSample[], metric: MetricKey): { t: number; value: number }[] {
  return samples.map((sample, index) => {
    const from = Math.max(index - SMOOTH_HALF_WIDTH, 0);
    const to = Math.min(index + SMOOTH_HALF_WIDTH, samples.length - 1);
    let sum = 0;
    for (let at = from; at <= to; at += 1) {
      sum += samples[at][metric];
    }
    return { t: sample.t, value: sum / (to - from + 1) };
  });
}

function scaleMax(peak: number, fixedMax: number | null): number {
  if (!Number.isFinite(peak) || peak <= 0) {
    return fixedMax != null && fixedMax > 0 ? fixedMax : 1;
  }
  const auto = niceMax(peak);
  return fixedMax == null ? auto : Math.min(fixedMax, auto);
}

// A short tick every half of the labelled step, a long tick with a label at the
// labelled step, both on round test times so they slide left as the window moves.
// For a ten minute window that is a tick every 30 s and ten labels, one per minute.
function rulerTicks(startSec: number, windowSec: number): { sec: number; label: string | null }[] {
  const majorSec = MAJOR_STEPS_SEC.find((step) => windowSec / step <= 10) ?? MAJOR_STEPS_SEC[MAJOR_STEPS_SEC.length - 1];
  const minorSec = majorSec / 2;
  const ticks: { sec: number; label: string | null }[] = [];
  for (let sec = Math.ceil(startSec / minorSec) * minorSec; sec <= startSec + windowSec; sec += minorSec) {
    ticks.push({ sec, label: sec > 0 && sec % majorSec === 0 ? formatSeconds(sec) : null });
  }
  return ticks;
}

function formatSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
