import { useEffect, useState } from 'react';
import { algorithmShortName } from '../config/loadTestConfig';
import { fetchLoadStandJson } from '../config/loadStand';
import { BalancerAlgorithm, SeriesRun, SeriesStatus, ServerHistoryPoint, SeriesOutage } from '../types/loadTest';
import { testClockOutages } from './chartMath';
import { ServerCharts } from './ServerCharts';
import { liveOutageBands } from './liveOutages';

// Per-server charts for a comparison: the live view, or the saved data of exactly
// one finished run. A saved run does not change, so it is fetched once.
export function SeriesServerCharts({
  series,
  algorithms,
  liveHistory,
  manualOutages,
}: {
  series: SeriesStatus | null;
  algorithms: BalancerAlgorithm[];
  liveHistory: ServerHistoryPoint[];
  manualOutages?: SeriesOutage[];
}) {
  // undefined follows Now (live idle or the run in progress), a number is a saved run.
  const [picked, setPicked] = useState<number | null | undefined>(undefined);
  const nameOf = (id: string) => algorithmShortName(id, algorithms.find((item) => item.id === id)?.name);
  const runs = (series?.runs ?? []).map((run, index) => ({ run, index }));
  const isSaved = (run: SeriesRun) => run.state === 'done' || run.state === 'stopped';
  const live = runs.some(({ run }) => run.state === 'running');
  const selected = picked !== undefined ? picked : null;
  const chosen = runs.find(({ run, index }) => index === selected && isSaved(run));

  useEffect(() => {
    if (live) {
      setPicked(undefined);
    }
  }, [live]);

  return (
    <>
      <div className="load-chart-range" role="group" aria-label="Server chart data">
        <button type="button" aria-pressed={!chosen} onClick={() => setPicked(null)}>
          Now
        </button>
        {runs.map(({ run, index }) => (
          <button
            key={`${run.algorithm}-${index}`}
            type="button"
            aria-pressed={chosen?.index === index}
            // Only a finished run has saved data; the one in progress is the live view.
            disabled={!isSaved(run)}
            onClick={() => setPicked(index)}
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
          index={chosen.index}
          durationSec={series.durationSec}
          originMs={chosen.run.startedAtMs}
          scheduledOutages={testClockOutages(series.outages, manualOutages ?? [])}
          liveFallback={liveHistory}
        />
      ) : (
        <LiveServerCharts series={series} liveHistory={liveHistory} manualOutages={manualOutages ?? []} />
      )}
    </>
  );
}

function runLabel(run: SeriesRun): string {
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

function LiveServerCharts({
  series,
  liveHistory,
  manualOutages,
}: {
  series: SeriesStatus | null;
  liveHistory: ServerHistoryPoint[];
  manualOutages: SeriesOutage[];
}) {
  const run = series?.runs.find((item) => item.state === 'running' && item.startedAtMs != null);
  const originMs = run?.startedAtMs;
  const history = originMs != null
    ? liveHistory.filter((point) => point.at >= originMs)
    : liveHistory;
  const planned = series?.outages ?? [];
  // Only a live run uses the test clock. Idle Now draws from the left on
  // wall time; the saved run still holds the strips from the test.
  const onTestClock = originMs != null;
  return (
    <ServerCharts
      history={history}
      originMs={originMs}
      scheduledOutages={onTestClock ? testClockOutages(planned, manualOutages) : []}
      outages={onTestClock ? [] : liveOutageBands(history)}
    />
  );
}

function SavedRunCharts({
  index,
  durationSec,
  originMs,
  scheduledOutages,
  liveFallback,
}: {
  index: number;
  durationSec: number;
  originMs?: number;
  scheduledOutages?: SeriesStatus['outages'];
  liveFallback: ServerHistoryPoint[];
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
          setError(err instanceof Error ? err.message : 'Failed to load run data');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [index]);

  const fallback = originMs != null
    ? liveFallback.filter((point) => point.at >= originMs)
    : liveFallback;
  const display = history ?? fallback;

  if (error) {
    return <p className="load-notice load-notice-error">{error}</p>;
  }
  if (display.length === 0) {
    return <p className="load-empty">{history ? 'This run has no saved server data.' : 'Loading saved data…'}</p>;
  }
  return (
    <ServerCharts
      history={display}
      initialRangeMs={rangeMsFor(durationSec * 1000)}
      originMs={originMs}
      scheduledOutages={scheduledOutages}
    />
  );
}

// The shortest chart window (3 min, 10 min, 30 min, 1 h) that holds a whole run.
function rangeMsFor(durationMs: number): number {
  const windows = [3, 10, 30, 60].map((minutes) => minutes * 60 * 1000);
  return windows.find((window) => window >= durationMs) ?? windows[windows.length - 1];
}

