import { useState } from 'react';
import { BalancerAlgorithm, SeriesRun, SeriesSample, SeriesStatus, TestMetrics } from '../types/loadTest';
import { formatTick, niceMax } from './chartMath';

const COLORS = ['#1f6f5b', '#2563eb', '#d97706', '#be123c', '#7c3aed', '#0891b2', '#65a30d', '#6b7280'];

type MetricKey = 'cpuSpread' | 'meanCpu' | 'maxCpu' | 'rps' | 'p50Ms' | 'p95Ms' | 'p99Ms' | 'errorPct';

const METRICS: { key: MetricKey; label: string; unit: string; fixedMax: number | null; digits: number }[] = [
  { key: 'cpuSpread', label: 'Разброс CPU между серверами (макс − мин)', unit: '%', fixedMax: 100, digits: 1 },
  { key: 'meanCpu', label: 'Средний CPU работающих серверов', unit: '%', fixedMax: 100, digits: 1 },
  { key: 'maxCpu', label: 'CPU самого загруженного сервера', unit: '%', fixedMax: 100, digits: 1 },
  { key: 'rps', label: 'RPS — успешные запросы в секунду', unit: '', fixedMax: null, digits: 1 },
  { key: 'p50Ms', label: 'Задержка p50', unit: 'мс', fixedMax: null, digits: 1 },
  { key: 'p95Ms', label: 'Задержка p95', unit: 'мс', fixedMax: null, digits: 0 },
  { key: 'p99Ms', label: 'Задержка p99', unit: 'мс', fixedMax: null, digits: 0 },
  { key: 'errorPct', label: 'Ошибки', unit: '%', fixedMax: 100, digits: 2 },
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

export function AlgorithmComparison({
  series,
  algorithms,
}: {
  series: SeriesStatus | null;
  algorithms: BalancerAlgorithm[];
}) {
  const [hidden, setHidden] = useState<string[]>([]);

  if (!series || series.runs.length === 0) {
    return <p className="load-empty">Прогонов пока нет. Отметьте алгоритмы и нажмите Start.</p>;
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
  const toggle = (id: string) => {
    setHidden((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  return (
    <>
      <div className="load-chart-range" role="group" aria-label="Алгоритмы на графиках">
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
      <div className="load-charts">
        {METRICS.map((metric) => (
          <article className="load-chart" key={metric.key}>
            <h3>{metric.label}{metric.unit ? `, ${metric.unit}` : ''}</h3>
            <div className="load-legend">
              {shown.length === 0 ? (
                <span>Включите алгоритм, чтобы увидеть линию</span>
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
              durationSec={series.durationSec}
              series={series}
            />
          </article>
        ))}
      </div>
      <p className="load-copy">
        По горизонтали минуты теста. Красные полосы — сервер остановлен по расписанию, у всех алгоритмов в одни и те же
        секунды. Линии сглажены скользящим средним за {SMOOTH_HALF_WIDTH * 2 + 1} с, число в легенде — среднее за прогон
        по исходным точкам. CPU берётся из Prometheus как скорость за 15 с, поэтому реагирует на остановку сервера с
        задержкой; RPS, задержки и ошибки стенд считает по окну в 5 с.
      </p>
      <SummaryTable series={series} nameOf={nameOf} />
    </>
  );
}

function runSuffix(run: SeriesRun): string {
  switch (run.state) {
    case 'running':
      return ' · идёт';
    case 'pending':
      return ' · ждёт';
    case 'failed':
      return ' · ошибка';
    case 'stopped':
      return ' · прерван';
    default:
      return '';
  }
}

function ComparisonChart({
  runs,
  metric,
  fixedMax,
  durationSec,
  series,
}: {
  runs: { run: SeriesRun; color: string }[];
  metric: MetricKey;
  fixedMax: number | null;
  durationSec: number;
  series: SeriesStatus;
}) {
  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = VIEW_H - PAD.top - PAD.bottom;
  const lines = runs.map(({ run, color }) => ({
    id: run.algorithm,
    color,
    points: smooth(run.samples ?? [], metric),
  }));
  const peak = Math.max(0, ...lines.flatMap((line) => line.points.map((point) => point.value)));
  const max = scaleMax(peak, fixedMax);
  const yTicks = [max, max / 2, 0];
  const bottom = PAD.top + plotH;
  const xOf = (sec: number) => PAD.left + Math.min(Math.max(sec / durationSec, 0), 1) * plotW;
  const yOf = (value: number) => PAD.top + plotH - (Math.min(Math.max(value, 0), max) / max) * plotH;

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={metric}>
      {(series.outages ?? []).map((outage) => (
        <g key={`${outage.server}-${outage.stopAtSec}`}>
          <rect
            x={xOf(outage.stopAtSec)}
            y={PAD.top}
            width={Math.max(xOf(outage.startAtSec) - xOf(outage.stopAtSec), 0)}
            height={plotH}
            className="load-chart-outage"
          >
            <title>{`${outage.server} остановлен с ${formatSeconds(outage.stopAtSec)} до ${formatSeconds(outage.startAtSec)}`}</title>
          </rect>
          <text x={xOf(outage.stopAtSec) + 3} y={PAD.top + 10} className="load-chart-outage-label">
            {`S${outage.server.replace(/\D+/g, '')}`}
          </text>
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
      {rulerTicks(durationSec).map((tick) => (
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

function SummaryTable({ series, nameOf }: { series: SeriesStatus; nameOf: (id: string) => string }) {
  const finished = series.runs.filter((run) => run.state === 'done' && run.report);
  if (finished.length === 0) {
    return null;
  }
  const fullCluster = Math.max(0, ...series.runs.flatMap((run) => (run.samples ?? []).map((sample) => sample.live)));
  const rows = finished.map((run) => {
    const samples = run.samples ?? [];
    const report = run.report as TestMetrics;
    const together = samples.filter((sample) => sample.live >= 2);
    const degraded = together.filter((sample) => sample.live < fullCluster);
    return {
      run,
      report,
      spread: together.length > 0 ? mean(together, 'cpuSpread') : null,
      spreadDegraded: degraded.length > 0 ? mean(degraded, 'cpuSpread') : null,
    };
  });
  const best = (pick: (row: (typeof rows)[number]) => number | null, higher: boolean) => {
    const values = rows.map(pick).filter((value): value is number => value !== null);
    if (rows.length < 2 || values.length === 0) {
      return null;
    }
    return higher ? Math.max(...values) : Math.min(...values);
  };
  const columns = [
    { label: 'RPS ↑', pick: (row: (typeof rows)[number]) => row.report.rps, higher: true, text: (v: number) => v.toFixed(1) },
    { label: 'p95, мс ↓', pick: (row: (typeof rows)[number]) => row.report.p95Millis ?? 0, higher: false, text: (v: number) => v.toFixed(0) },
    { label: 'p99, мс ↓', pick: (row: (typeof rows)[number]) => row.report.p99Millis, higher: false, text: (v: number) => v.toFixed(0) },
    { label: 'Ошибки, % ↓', pick: (row: (typeof rows)[number]) => row.report.errorRatePercent, higher: false, text: (v: number) => v.toFixed(2) },
    {
      label: 'CPU fairness ↑',
      pick: (row: (typeof rows)[number]) => (row.report.cpuFairnessAvailable ? row.report.cpuFairnessIndex : null),
      higher: true,
      text: (v: number) => v.toFixed(3),
    },
    { label: 'Разброс CPU, % ↓', pick: (row: (typeof rows)[number]) => row.spread, higher: false, text: (v: number) => v.toFixed(1) },
    {
      label: 'Разброс CPU при остановленном сервере, % ↓',
      pick: (row: (typeof rows)[number]) => row.spreadDegraded,
      higher: false,
      text: (v: number) => v.toFixed(1),
    },
  ];

  return (
    <div className="load-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Алгоритм</th>
            {columns.map((column) => <th key={column.label}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.run.algorithm}>
              <td>{nameOf(row.run.algorithm)}</td>
              {columns.map((column) => {
                const value = column.pick(row);
                const top = best(column.pick, column.higher);
                return (
                  <td key={column.label} className={value !== null && value === top ? 'load-best' : ''}>
                    {value === null ? 'N/A' : column.text(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="load-copy">
        Жирным выделено лучшее значение в столбце. Каждый алгоритм прошёл тест один раз, поэтому маленькая разница
        может быть шумом, а не преимуществом.
      </p>
    </div>
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
// labelled step; the start of the test has no label. For a ten minute test that is a
// tick every 30 s and ten labels, one per minute.
function rulerTicks(durationSec: number): { sec: number; label: string | null }[] {
  const majorSec = MAJOR_STEPS_SEC.find((step) => durationSec / step <= 10) ?? MAJOR_STEPS_SEC[MAJOR_STEPS_SEC.length - 1];
  const minorSec = majorSec / 2;
  const ticks: { sec: number; label: string | null }[] = [];
  for (let sec = 0; sec <= durationSec; sec += minorSec) {
    ticks.push({ sec, label: sec > 0 && sec % majorSec === 0 ? formatSeconds(sec) : null });
  }
  return ticks;
}

function formatSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
