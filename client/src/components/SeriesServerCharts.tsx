import { useEffect, useState } from 'react';
import { fetchLoadStandJson } from '../config/loadStand';
import { BalancerAlgorithm, SeriesRun, SeriesStatus, ServerHistoryPoint } from '../types/loadTest';
import { ServerCharts, ServerOutageBand } from './ServerCharts';
import { liveOutageBands } from './liveOutages';

// Per-server charts for a comparison: the live view, or the saved data of exactly
// one finished run. A saved run does not change, so it is fetched once.
export function SeriesServerCharts({
  series,
  algorithms,
  liveHistory,
}: {
  series: SeriesStatus | null;
  algorithms: BalancerAlgorithm[];
  liveHistory: ServerHistoryPoint[];
}) {
  // null is the live view, a number is the index of a saved run.
  const [selected, setSelected] = useState<number | null>(null);
  const nameOf = (id: string) => algorithms.find((item) => item.id === id)?.name ?? id;
  const runs = (series?.runs ?? []).map((run, index) => ({ run, index }));
  const isSaved = (run: SeriesRun) => run.state === 'done' || run.state === 'stopped';
  const chosen = runs.find(({ run, index }) => index === selected && isSaved(run));

  return (
    <>
      <div className="load-chart-range" role="group" aria-label="Данные графиков серверов">
        <button type="button" aria-pressed={!chosen} onClick={() => setSelected(null)}>
          Сейчас
        </button>
        {runs.map(({ run, index }) => (
          <button
            key={`${run.algorithm}-${index}`}
            type="button"
            aria-pressed={chosen?.index === index}
            // Only a finished run has saved data; the one in progress is the live view.
            disabled={!isSaved(run)}
            onClick={() => setSelected(index)}
          >
            {nameOf(run.algorithm)}
            {runLabel(run)}
          </button>
        ))}
      </div>
      {chosen && series ? (
        <SavedRunCharts
          // A new series or a new run starts from a fresh fetch.
          key={`${chosen.run.startedAtMs ?? 0}-${chosen.index}`}
          run={chosen.run}
          index={chosen.index}
          durationSec={series.durationSec}
          outages={outageBands(series, chosen.run)}
        />
      ) : (
        <ServerCharts history={liveHistory} outages={liveOutageBands(liveHistory)} />
      )}
    </>
  );
}

function runLabel(run: SeriesRun): string {
  switch (run.state) {
    case 'running':
      return ' · идёт';
    case 'pending':
      return ' · ждёт';
    case 'failed':
      return ' · ошибка';
    default:
      return '';
  }
}

// The planned outages of a series as time spans on the clock of one run.
function outageBands(series: SeriesStatus, run: SeriesRun): ServerOutageBand[] {
  if (!run.startedAtMs) {
    return [];
  }
  const startedAt = run.startedAtMs;
  return (series.outages ?? []).map((outage) => ({
    server: outage.server,
    fromMs: startedAt + outage.stopAtSec * 1000,
    // A server still down when the run ends is started again at that moment.
    toMs: startedAt + Math.min(outage.startAtSec, series.durationSec) * 1000,
  }));
}

function SavedRunCharts({
  run,
  index,
  durationSec,
  outages,
}: {
  run: SeriesRun;
  index: number;
  durationSec: number;
  outages: ServerOutageBand[];
}) {
  const [history, setHistory] = useState<ServerHistoryPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLoadStandJson<ServerHistoryPoint[]>(`/api/series/runs/${index}/servers`)
      .then((points) => {
        if (!cancelled) {
          setHistory(points ?? []);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Не удалось загрузить данные прогона');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [index]);

  if (error) {
    return <p className="load-notice load-notice-error">{error}</p>;
  }
  if (!history) {
    return <p className="load-empty">Загрузка сохранённых данных…</p>;
  }
  if (history.length === 0) {
    return <p className="load-empty">У этого прогона нет сохранённых данных серверов.</p>;
  }
  return (
    <>
      <p className="load-copy">
        Сохранённые данные прогона{run.startedAtMs ? `, начало ${formatStart(run.startedAtMs)}` : ''}. Они не меняются,
        время на оси — время, когда прогон шёл.
      </p>
      <ServerCharts history={history} initialRangeMs={rangeMsFor(durationSec * 1000)} outages={outages} />
    </>
  );
}

// The shortest chart window (3 min, 10 min, 30 min, 1 h) that holds a whole run.
function rangeMsFor(durationMs: number): number {
  const windows = [3, 10, 30, 60].map((minutes) => minutes * 60 * 1000);
  return windows.find((window) => window >= durationMs) ?? windows[windows.length - 1];
}

function formatStart(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
