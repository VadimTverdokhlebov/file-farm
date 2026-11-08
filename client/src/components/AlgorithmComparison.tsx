import { useState } from 'react';
import { BalancerAlgorithm, SeriesOutage, SeriesRun, SeriesSample, SeriesStatus, TestMetrics } from '../types/loadTest';
import { algorithmShortName } from '../config/loadTestConfig';
import { ChartScrollBar } from './ChartScrollBar';
import { formatTick, formatTestSeconds, outageOverlapsWindow, scaleMax, testClockOutages, testRulerTicks } from './chartMath';

const COLORS = ['#1f6f5b', '#2563eb', '#d97706', '#be123c', '#7c3aed', '#0891b2', '#65a30d', '#6b7280'];

type MetricKey = 'cpuMad' | 'rps' | 'p50Ms' | 'p95Ms' | 'p99Ms' | 'errorPct';

const METRICS: { key: MetricKey; label: string; unit: string; fixedMax: number | null }[] = [
  { key: 'cpuMad', label: 'CPU MAD', unit: '%', fixedMax: 50 },
  { key: 'rps', label: 'RPS', unit: '', fixedMax: null },
  { key: 'p50Ms', label: 'Latency p50', unit: 'ms', fixedMax: null },
  { key: 'p95Ms', label: 'Latency p95', unit: 'ms', fixedMax: null },
  { key: 'p99Ms', label: 'Latency p99', unit: 'ms', fixedMax: null },
  { key: 'errorPct', label: 'Errors', unit: '%', fixedMax: 100 },
];

const VIEW_W = 640;
const VIEW_H = 228;
const PAD = { top: 12, right: 34, bottom: 48, left: 67 };
const MINOR_TICK = 3;
const MAJOR_TICK = 8;
// Display smoothing: each point is the mean of this many seconds on both sides.
const SMOOTH_HALF_WIDTH = 3;
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
  extraOutages,
  liveReport,
}: {
  series: SeriesStatus | null;
  algorithms: BalancerAlgorithm[];
  extraOutages?: SeriesOutage[];
  liveReport?: TestMetrics | null;
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [rangeSec, setRangeSec] = useState(RANGES[0].sec);
  // 0 starts at the left; null follows the latest sample after the user pans to the end.
  const [scrollSec, setScrollSec] = useState<number | null>(0);

  if (!series || series.runs.length === 0) {
    return (
      <>
        <RangeButtons selected={rangeSec} onChange={setRangeSec} />
        <p className="load-empty">No runs yet. Pick algorithms and press Start.</p>
        <ChartScrollBar
          total={0}
          window={rangeSec}
          start={0}
          onScroll={setScrollSec}
          label="Scroll the charts"
        />
      </>
    );
  }

  const nameOf = (id: string) => algorithmShortName(id, algorithms.find((item) => item.id === id)?.name);
  const colorOf = (id: string, runIndex: number) => {
    const position = algorithms.findIndex((item) => item.id === id);
    return COLORS[(position >= 0 ? position : runIndex) % COLORS.length];
  };
  const withSamples = (run: SeriesRun) => (run.samples?.length ?? 0) > 0;
  const shown = series.runs
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => withSamples(run) && !hidden.includes(run.algorithm));
  const windowSec = rangeSec;
  // The window starts at 0 until the test fills it, then follows the latest sample.
  const latestSec = Math.max(0, ...shown.flatMap(({ run }) => (run.samples ?? []).map((sample) => sample.t)));
  const lastStartSec = Math.max(0, latestSec - windowSec);
  const windowStartSec = scrollSec === null
    ? lastStartSec
    : Math.min(Math.max(scrollSec, 0), lastStartSec);
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
      <RangeButtons selected={windowSec} onChange={setRangeSec} />
      <div className="load-charts">
        {METRICS.map((metric) => (
          <article className="load-chart" key={metric.key}>
            <h3>{metric.label}{metric.unit ? `, ${metric.unit}` : ''}</h3>
            <div className="load-legend">
              {shown.length === 0 ? (
                <span>Turn an algorithm on to see its line</span>
              ) : shown.map(({ run, index }) => {
                const value = legendValue(reportOf(run, index, series, liveReport), metric.key);
                return (
                  <span key={run.algorithm}>
                    <i style={{ background: colorOf(run.algorithm, index) }} />
                    {nameOf(run.algorithm)}{value ? ` ${value}` : ''}
                  </span>
                );
              })}
            </div>
            <ComparisonChart
              runs={shown.map(({ run, index }) => ({ run, color: colorOf(run.algorithm, index) }))}
              metric={metric.key}
              fixedMax={metric.fixedMax}
              windowStartSec={windowStartSec}
              windowSec={windowSec}
              outages={testClockOutages(series.outages, extraOutages ?? [])}
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

function RangeButtons({ selected, onChange }: { selected: number; onChange: (sec: number) => void }) {
  return (
    <div className="load-chart-range" role="group" aria-label="Chart interval">
      {RANGES.map((item) => (
        <button
          key={item.sec}
          type="button"
          aria-pressed={item.sec === selected}
          onClick={() => onChange(item.sec)}
        >
          {item.label}
        </button>
      ))}
    </div>
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
  outages,
}: {
  runs: { run: SeriesRun; color: string }[];
  metric: MetricKey;
  fixedMax: number | null;
  windowStartSec: number;
  windowSec: number;
  outages: SeriesOutage[];
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
      {outages
        .filter((outage) => outageOverlapsWindow(outage.stopAtSec, outage.startAtSec, windowStartSec, windowSec))
        .map((outage) => (
        <g key={`${outage.server}-${outage.stopAtSec}`}>
          <rect
            x={xOf(outage.stopAtSec)}
            y={PAD.top}
            width={Math.max(xOf(outage.startAtSec) - xOf(outage.stopAtSec), 0)}
            height={plotH}
            className="load-chart-outage"
          >
            <title>{`${outage.server} stopped from ${formatTestSeconds(outage.stopAtSec)} to ${formatTestSeconds(outage.startAtSec)}`}</title>
          </rect>
          {outage.stopAtSec >= windowStartSec && (
            <text x={xOf(outage.stopAtSec) + 3} y={PAD.top + 14} className="load-chart-outage-label">
              {`S-${outage.server.replace(/\D+/g, '')}`}
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
      {testRulerTicks(windowStartSec, windowSec).map((tick) => (
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

function reportOf(
  run: SeriesRun,
  index: number,
  series: SeriesStatus,
  liveReport?: TestMetrics | null,
): TestMetrics | null {
  const live = index === series.current && run.state === 'running' ? liveReport ?? null : null;
  return run.report ?? live;
}

function legendValue(report: TestMetrics | null, metric: MetricKey): string {
  if (!report) {
    return '';
  }
  switch (metric) {
    case 'cpuMad':
      return report.cpuMadMeanAvailable ? (report.cpuMadMeanPercent ?? 0).toFixed(2) : 'N/A';
    case 'rps':
      return report.rps.toFixed(2);
    case 'p50Ms':
      return report.p50Millis.toFixed(2);
    case 'p95Ms':
      return (report.p95Millis ?? 0).toFixed(2);
    case 'p99Ms':
      return report.p99Millis.toFixed(2);
    case 'errorPct':
      return report.errorRatePercent.toFixed(2);
    default:
      return '';
  }
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
