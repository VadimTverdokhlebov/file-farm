import { useState } from 'react';
import { ServerHistoryPoint, ServerStatus } from '../types/loadTest';

const SERVER_COLORS = ['#1f6f5b', '#2563eb', '#d97706', '#be123c'];
const TOTAL_COLOR = '#1f6f5b';

type MetricKey = 'cpu' | 'ram' | 'rps' | 'totalRps' | 'eds' | 'mem';

const METRICS: { key: MetricKey; label: string; unit: string; fixedMax: number | null }[] = [
  { key: 'cpu', label: 'CPU', unit: '%', fixedMax: 100 },
  { key: 'ram', label: 'RAM', unit: '%', fixedMax: 100 },
  { key: 'rps', label: 'RPS', unit: '', fixedMax: null },
  { key: 'totalRps', label: 'Общий RPS', unit: '', fixedMax: null },
  { key: 'eds', label: 'Вес EDS', unit: '', fixedMax: null },
  { key: 'mem', label: 'Память', unit: 'МБ', fixedMax: null },
];

const RANGES = [
  { label: '3 мин', ms: 3 * 60 * 1000 },
  { label: '10 мин', ms: 10 * 60 * 1000 },
  { label: '30 мин', ms: 30 * 60 * 1000 },
  { label: '1 час', ms: 60 * 60 * 1000 },
];

const VIEW_W = 640;
const VIEW_H = 206;
const PAD = { top: 10, right: 8, bottom: 28, left: 42 };
const TIME_TICKS = 4;

export function ServerCharts({ history }: { history: ServerHistoryPoint[] }) {
  const [rangeMs, setRangeMs] = useState(RANGES[0].ms);
  const names = serverNames(history);
  const windowEnd = history.length > 0 ? history[history.length - 1].at : Date.now();
  const windowStart = windowEnd - rangeMs;
  const visible = history.filter((point) => point.at >= windowStart);

  return (
    <>
      <div className="load-chart-range" role="group" aria-label="Интервал графиков">
        {RANGES.map((range) => (
          <button
            key={range.ms}
            type="button"
            aria-pressed={range.ms === rangeMs}
            onClick={() => setRangeMs(range.ms)}
          >
            {range.label}
          </button>
        ))}
      </div>
      {history.length === 0 || names.length === 0 ? (
        <p className="load-empty">Графики появятся, когда придёт статус серверов.</p>
      ) : (
        <div className="load-charts">
          {METRICS.map((metric) => (
            <article className="load-chart" key={metric.key}>
              <h3>{metric.label}{metric.unit ? `, ${metric.unit}` : ''}</h3>
              {metric.key === 'totalRps' ? (
                <div className="load-legend">
                  <span>
                    <i style={{ background: TOTAL_COLOR }} />
                    кластер {formatNumber(totalRps(history[history.length - 1]))}
                  </span>
                </div>
              ) : (
                <div className="load-legend">
                  {names.map((name, index) => (
                    <span key={name}>
                      <i style={{ background: SERVER_COLORS[index % SERVER_COLORS.length] }} />
                      {shortName(name)} {formatLatest(history, name, metric.key)}
                    </span>
                  ))}
                </div>
              )}
              <MetricChart
                history={visible}
                names={names}
                metric={metric.key}
                fixedMax={metric.fixedMax}
                windowStart={windowStart}
                windowMs={rangeMs}
              />
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function MetricChart({
  history,
  names,
  metric,
  fixedMax,
  windowStart,
  windowMs,
}: {
  history: ServerHistoryPoint[];
  names: string[];
  metric: MetricKey;
  fixedMax: number | null;
  windowStart: number;
  windowMs: number;
}) {
  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = VIEW_H - PAD.top - PAD.bottom;
  const rawSeries = metric === 'totalRps'
    ? [history.map((point) => totalRps(point))]
    : names.map((name) => history.map((point, index) => (
      metric === 'eds' ? weightValue(history, index, name) : metricValue(point, name, metric)
    )));
  const times = history.map((point) => point.at);
  const series = rawSeries.map((values) => smoothSeries(values, times, windowStart, windowMs, plotW));
  const finite = series.flat(2).map((point) => point.value);
  const peak = finite.length === 0 ? 0 : Math.max(0, ...finite);
  const max = scaleMax(peak, fixedMax);
  const ticks = [max, max / 2, 0];
  const colors = metric === 'totalRps' ? [TOTAL_COLOR] : SERVER_COLORS;

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={metric}>
      {ticks.map((tick) => {
        const y = yOf(tick, max, plotH);
        return (
          <g key={tick}>
            <line x1={PAD.left} x2={VIEW_W - PAD.right} y1={y} y2={y} className="load-chart-grid" />
            <text x={PAD.left - 6} y={y + 4} className="load-chart-tick" textAnchor="end">
              {formatTick(tick)}
            </text>
          </g>
        );
      })}
      {timeTicks(windowStart, windowMs, plotW).map((tick, slot) => (
        <text key={slot} x={tick.x} y={VIEW_H - 6} className="load-chart-tick" textAnchor={tick.anchor}>
          {tick.label}
        </text>
      ))}
      {series.map((runs, index) => (
        runs.map((run, segment) => (
          <polyline
            key={`${index}-${segment}`}
            points={run.map((point) => `${xOf(point.at, windowStart, windowMs, plotW)},${yOf(point.value, max, plotH)}`).join(' ')}
            fill="none"
            stroke={colors[index % colors.length]}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))
      ))}
    </svg>
  );
}

type PlotPoint = { at: number; value: number };

// Several one-second samples land on the same pixel on a long window and the
// stroke piles up into a thick band. Average each pixel column so the line
// stays thin and readable.
function smoothSeries(
  values: Array<number | null>,
  times: number[],
  windowStart: number,
  windowMs: number,
  plotW: number,
): PlotPoint[][] {
  const bucketMs = Math.max(windowMs / Math.max(plotW / 3, 1), 1);
  const runs: PlotPoint[][] = [];
  let run: PlotPoint[] = [];
  let bucket = -1;
  let sum = 0;
  let count = 0;
  let atSum = 0;
  let tip: PlotPoint | null = null;

  const closeBucket = () => {
    if (count === 0) {
      return;
    }
    run.push({ at: atSum / count, value: sum / count });
    sum = 0;
    count = 0;
    atSum = 0;
  };
  const closeRun = () => {
    closeBucket();
    if (run.length > 0) {
      runs.push(soften(run, tip));
      run = [];
    }
    bucket = -1;
    tip = null;
  };

  values.forEach((value, index) => {
    const at = times[index];
    if (value == null || !Number.isFinite(at)) {
      closeRun();
      return;
    }
    const nextBucket = Math.floor((at - windowStart) / bucketMs);
    if (bucket !== -1 && nextBucket !== bucket) {
      closeBucket();
    }
    bucket = nextBucket;
    sum += value;
    count += 1;
    atSum += at;
    tip = { at, value };
  });
  closeRun();
  return runs;
}

function soften(run: PlotPoint[], tip: PlotPoint | null): PlotPoint[] {
  const smoothed = run.length < 3
    ? run.slice()
    : run.map((point, index) => {
      if (index === 0 || index === run.length - 1) {
        return point;
      }
      const value = (run[index - 1].value + point.value * 2 + run[index + 1].value) / 4;
      return { at: point.at, value };
    });
  if (!tip || smoothed.length === 0) {
    return smoothed;
  }
  const end = smoothed[smoothed.length - 1];
  if (tip.at > end.at) {
    smoothed.push(tip);
  } else {
    smoothed[smoothed.length - 1] = tip;
  }
  return smoothed;
}

function timeTicks(
  windowStart: number,
  windowMs: number,
  plotW: number,
): { x: number; label: string; anchor: 'start' | 'middle' | 'end' }[] {
  return Array.from({ length: TIME_TICKS }, (_, slot) => {
    const ratio = slot / (TIME_TICKS - 1);
    const anchor = slot === 0 ? 'start' : slot === TIME_TICKS - 1 ? 'end' : 'middle';
    return {
      x: PAD.left + ratio * plotW,
      label: formatClock(windowStart + ratio * windowMs),
      anchor,
    };
  });
}

function xOf(at: number, windowStart: number, windowMs: number, plotW: number): number {
  if (windowMs <= 0) {
    return PAD.left;
  }
  const ratio = Math.min(Math.max((at - windowStart) / windowMs, 0), 1);
  return PAD.left + ratio * plotW;
}

function serverNames(history: ServerHistoryPoint[]): string[] {
  const latest = history[history.length - 1];
  return latest ? latest.servers.map((server) => server.name) : [];
}

function metricValue(point: ServerHistoryPoint, name: string, metric: MetricKey): number | null {
  const server = point.servers.find((item) => item.name === name);
  if (!server) {
    return null;
  }
  const raw = Number(server[metric as keyof ServerStatus]);
  return Number.isFinite(raw) ? raw : 0;
}

function weightValue(history: ServerHistoryPoint[], index: number, name: string): number | null {
  const server = history[index]?.servers.find((item) => item.name === name);
  if (!server) {
    return null;
  }
  // A stopped server keeps a line on the zero axis instead of disappearing.
  if (isStopped(server)) {
    return 0;
  }
  const value = Number(server.eds);
  const finite = Number.isFinite(value) ? value : 0;
  if (finite > 0) {
    return finite;
  }
  // A stop can publish a sample where every weight is 0. Keep the last real
  // weight for servers that are still up so the scale does not collapse.
  const outage = history[index].servers.some(isStopped);
  if (!outage) {
    return finite;
  }
  for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
    const previous = history[earlier].servers.find((item) => item.name === name);
    const previousWeight = previous ? Number(previous.eds) : 0;
    if (previous && !isStopped(previous) && Number.isFinite(previousWeight) && previousWeight > 0) {
      return previousWeight;
    }
  }
  return 0;
}

function isStopped(server: ServerStatus): boolean {
  return server.running === false || server.status === 'down';
}

function totalRps(point: ServerHistoryPoint): number {
  return point.servers.reduce((sum, server) => {
    const value = Number(server.rps);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function yOf(value: number, max: number, plotH: number): number {
  if (!Number.isFinite(max) || max <= 0) {
    return PAD.top + plotH;
  }
  const ratio = Math.min(Math.max(value, 0), max) / max;
  return PAD.top + plotH - ratio * plotH;
}

function scaleMax(peak: number, fixedMax: number | null): number {
  if (!Number.isFinite(peak) || peak <= 0) {
    return fixedMax != null && fixedMax > 0 ? fixedMax : 1;
  }
  const auto = niceMax(peak);
  return fixedMax == null ? auto : Math.min(fixedMax, auto);
}

function niceMax(peak: number): number {
  const padded = Math.max(peak * 1.15, 0.1);
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  return Math.ceil(padded / magnitude) * magnitude;
}

function formatTick(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  if (value >= 100 || Number.isInteger(value)) {
    return String(Math.round(value));
  }
  return value.toFixed(1);
}

function formatLatest(history: ServerHistoryPoint[], name: string, metric: MetricKey): string {
  if (metric === 'eds') {
    return formatNumber(weightValue(history, history.length - 1, name) ?? 0);
  }
  const latest = history[history.length - 1];
  const value = latest ? metricValue(latest, name, metric) : 0;
  return formatNumber(value ?? 0);
}

function formatNumber(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function shortName(name: string): string {
  return name.replace('file-farm-', '');
}
