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

const VIEW_W = 640;
const VIEW_H = 206;
const PAD = { top: 10, right: 8, bottom: 28, left: 42 };
const TIME_TICKS = 4;

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
  const series = metric === 'totalRps'
    ? [history.map((point) => totalRps(point))]
    : names.map((name) => history.map((point, index) => (
      metric === 'eds' ? weightValue(history, index, name) : metricValue(point, name, metric)
    )));
  const finite = series.flat().filter((value): value is number => value != null);
  const peak = finite.length === 0 ? 0 : Math.max(0, ...finite);
  const max = scaleMax(peak, fixedMax);
  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = VIEW_H - PAD.top - PAD.bottom;
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
      {timeTicks(history, plotW).map((tick, slot) => (
        <text key={slot} x={tick.x} y={VIEW_H - 6} className="load-chart-tick" textAnchor={tick.anchor}>
          {tick.label}
        </text>
      ))}
      {series.map((values, index) => (
        segments(values, history.length, plotW, max, plotH).map((points, segment) => (
          <polyline
            key={`${index}-${segment}`}
            points={points}
            fill="none"
            stroke={colors[index % colors.length]}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))
      ))}
    </svg>
  );
}

function segments(
  values: Array<number | null>,
  length: number,
  plotW: number,
  max: number,
  plotH: number,
): string[] {
  const parts: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) {
      parts.push(current.join(' '));
      current = [];
    }
  };

  values.forEach((value, pointIndex) => {
    if (value == null) {
      flush();
      return;
    }
    const x = length === 1 ? PAD.left : PAD.left + (pointIndex / (length - 1)) * plotW;
    current.push(`${x},${yOf(value, max, plotH)}`);
  });
  flush();
  return parts;
}

function timeTicks(
  history: ServerHistoryPoint[],
  plotW: number,
): { x: number; label: string; anchor: 'start' | 'middle' | 'end' }[] {
  if (history.length === 0) {
    return [];
  }
  const last = history.length - 1;
  const slots = Math.min(TIME_TICKS, history.length);
  return Array.from({ length: slots }, (_, slot) => {
    const index = slots === 1 ? 0 : Math.round((slot * last) / (slots - 1));
    const x = history.length === 1 ? PAD.left : PAD.left + (index / last) * plotW;
    const anchor = slot === 0 ? 'start' : slot === slots - 1 ? 'end' : 'middle';
    return { x, label: formatClock(history[index].at), anchor };
  });
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
  if (!server || isStopped(server)) {
    return null;
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
  return null;
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
  const latest = history[history.length - 1];
  const server = latest?.servers.find((item) => item.name === name);
  if (metric === 'eds' && server && isStopped(server)) {
    return 'выкл';
  }
  if (metric === 'eds') {
    return formatNumber(weightValue(history, history.length - 1, name) ?? 0);
  }
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
