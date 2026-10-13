import { ServerHistoryPoint, ServerStatus } from '../types/loadTest';

const SERVER_COLORS = ['#1f6f5b', '#2563eb', '#d97706', '#be123c'];

type MetricKey = 'cpu' | 'ram' | 'rps' | 'error' | 'eds' | 'mem';

const METRICS: { key: MetricKey; label: string; unit: string; fixedMax: number | null }[] = [
  { key: 'cpu', label: 'CPU', unit: '%', fixedMax: 100 },
  { key: 'ram', label: 'RAM', unit: '%', fixedMax: 100 },
  { key: 'rps', label: 'RPS', unit: '', fixedMax: null },
  { key: 'error', label: 'Ошибки', unit: '%', fixedMax: 100 },
  { key: 'eds', label: 'Вес EDS', unit: '', fixedMax: null },
  { key: 'mem', label: 'Память', unit: 'МБ', fixedMax: null },
];

const VIEW_W = 640;
const VIEW_H = 188;
const PAD = { top: 10, right: 8, bottom: 8, left: 42 };

export function ServerCharts({ history }: { history: ServerHistoryPoint[] }) {
  const names = serverNames(history);

  if (history.length === 0 || names.length === 0) {
    return <p className="load-empty">Графики появятся, когда придёт статус серверов.</p>;
  }

  return (
    <div className="load-charts">
      {METRICS.map((metric) => (
        <article className="load-chart" key={metric.key}>
          <h3>{metric.label}{metric.unit ? `, ${metric.unit}` : ''}</h3>
          <div className="load-legend">
            {names.map((name, index) => (
              <span key={name}>
                <i style={{ background: SERVER_COLORS[index % SERVER_COLORS.length] }} />
                {shortName(name)} {formatLatest(history, name, metric.key)}
              </span>
            ))}
          </div>
          <MetricChart history={history} names={names} metric={metric.key} fixedMax={metric.fixedMax} />
        </article>
      ))}
    </div>
  );
}

function MetricChart({
  history,
  names,
  metric,
  fixedMax,
}: {
  history: ServerHistoryPoint[];
  names: string[];
  metric: MetricKey;
  fixedMax: number | null;
}) {
  const series = names.map((name) => history.map((point) => metricValue(point.servers, name, metric)));
  const peak = Math.max(0, ...series.flat());
  const max = scaleMax(peak, fixedMax);
  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = VIEW_H - PAD.top - PAD.bottom;
  const ticks = [max, max / 2, 0];

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
      {series.map((values, index) => (
        <polyline
          key={names[index]}
          points={values.map((value, pointIndex) => {
            const x = history.length === 1
              ? PAD.left
              : PAD.left + (pointIndex / (history.length - 1)) * plotW;
            return `${x},${yOf(value, max, plotH)}`;
          }).join(' ')}
          fill="none"
          stroke={SERVER_COLORS[index % SERVER_COLORS.length]}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function serverNames(history: ServerHistoryPoint[]): string[] {
  const latest = history[history.length - 1];
  return latest ? latest.servers.map((server) => server.name) : [];
}

function metricValue(servers: ServerStatus[], name: string, metric: MetricKey): number {
  const server = servers.find((item) => item.name === name);
  const value = server ? Number(server[metric]) : 0;
  return Number.isFinite(value) ? value : 0;
}

function yOf(value: number, max: number, plotH: number): number {
  const ratio = Math.min(Math.max(value, 0), max) / max;
  return PAD.top + plotH - ratio * plotH;
}

function scaleMax(peak: number, fixedMax: number | null): number {
  if (fixedMax != null && peak <= 0) {
    return fixedMax;
  }
  const auto = niceMax(Math.max(peak, 0.1));
  return fixedMax == null ? auto : Math.min(fixedMax, auto);
}

function niceMax(peak: number): number {
  const padded = peak * 1.15;
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  return Math.ceil(padded / magnitude) * magnitude;
}

function formatTick(value: number): string {
  if (value >= 100 || Number.isInteger(value)) {
    return String(Math.round(value));
  }
  return value.toFixed(1);
}

function formatLatest(history: ServerHistoryPoint[], name: string, metric: MetricKey): string {
  const latest = history[history.length - 1];
  const value = latest ? metricValue(latest.servers, name, metric) : 0;
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function shortName(name: string): string {
  return name.replace('file-farm-', '');
}
