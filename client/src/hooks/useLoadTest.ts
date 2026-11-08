import { useState, useEffect, useRef, useCallback } from 'react';
import { TestStatus, TestConfig, BalancerAlgorithm, BalancerConfiguration, ServerStatus, ServerHistoryPoint, SeriesStatus, SeriesOutage } from '../types/loadTest';
import { fetchLoadStandJson, getLoadStandWsUrl, postLoadStandJson } from '../config/loadStand';

interface UseLoadTestReturn {
  endpoints: string[];
  algorithms: BalancerAlgorithm[];
  status: TestStatus;
  serverHistory: ServerHistoryPoint[];
  startSeries: (config: TestConfig) => void;
  // Same wipe Start does, without starting a run.
  clearResults: () => void;
  restartRun: (index: number) => void;
  // Light status from the one-second message: phase, current run, run states.
  series: SeriesStatus | null;
  // The same series with every sample, fetched over HTTP.
  seriesResults: SeriesStatus | null;
  stopTest: () => void;
  setServerPower: (name: string, action: 'start' | 'stop') => Promise<void>;
  // Manual stops on the test clock, so the red strip matches the planned one.
  manualOutages: SeriesOutage[];
  pendingServer: string | null;
  error: string | null;
  isLoading: boolean;
}

interface StatusPayload {
  isRunning: boolean;
  series?: SeriesStatus | null;
  stats: TestStatus['stats'];
}

interface ErrorPayload {
  message: string;
}

interface WebSocketMessage {
  type: 'status' | 'error';
  payload: StatusPayload | ErrorPayload;
}

const HISTORY_MS = 60 * 60 * 1000;
const SERIES_POLL_MS = 3000;
const HISTORY_STORAGE = 'file-farm-server-history';

const defaultServers = (): ServerStatus[] =>
  [1, 2, 3, 4].map((index) => ({
    name: `file-farm-server-${index}`,
    rps: 0,
    error: 0,
    eds: 0,
    mem: 0,
    ram: 0,
    cpu: 0,
    status: 'down',
    running: false,
  }));

export const useLoadTest = (): UseLoadTestReturn => {
  const [endpoints, setEndpoints] = useState<string[]>([]);
  const [algorithms, setAlgorithms] = useState<BalancerAlgorithm[]>([]);
  const [status, setStatus] = useState<TestStatus>({
    isRunning: false,
    stats: { successfulRequests: 0, failedRequests: 0, report: null, Servers: defaultServers() },
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingServer, setPendingServer] = useState<string | null>(null);
  const [serverHistory, setServerHistory] = useState<ServerHistoryPoint[]>(() => loadStoredHistory());
  const [series, setSeries] = useState<SeriesStatus | null>(null);
  const [seriesResults, setSeriesResults] = useState<SeriesStatus | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const elapsedRef = useRef(0);
  const runningRef = useRef(false);
  // After Refresh, ignore leftover series until the next Start.
  const discardResults = useRef(false);
  const [manualOutages, setManualOutages] = useState<ManualOutage[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [endpointsData, balancerConfiguration, seriesData] = await Promise.all([
          fetchLoadStandJson<string[]>('/api/endpoints'),
          fetchLoadStandJson<BalancerConfiguration>('/api/algorithms'),
          fetchLoadStandJson<SeriesStatus | null>('/api/series').catch(() => null),
        ]);

        setEndpoints(endpointsData || []);
        setAlgorithms(balancerConfiguration.algorithms || []);
        setSeriesResults(seriesData ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    const wsUrl = getLoadStandWsUrl();
    ws.current = new WebSocket(wsUrl);

    ws.current.onerror = () => {
      setError('WebSocket connection to load stand failed. Run: make up-load-stand');
    };

    ws.current.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        if (message.type === 'status') {
          const payload = message.payload as StatusPayload;
          const servers = payload.stats.Servers?.length ? payload.stats.Servers : defaultServers();
          setStatus({
            isRunning: payload.isRunning,
            stats: {
              successfulRequests: Number(payload.stats.successfulRequests) || 0,
              failedRequests: Number(payload.stats.failedRequests) || 0,
              endpointStats: payload.stats.endpointStats || {},
              report: payload.stats.report || null,
              Servers: servers,
              elapsedSeconds: Number(payload.stats.elapsedSeconds) || 0,
              durationSeconds: Number(payload.stats.durationSeconds) || 0,
              waveIteration: Number(payload.stats.waveIteration) || 0,
              waveIndex: Number(payload.stats.waveIndex) || 0,
              waveCount: Number(payload.stats.waveCount) || 0,
              waveIterations: Number(payload.stats.waveIterations) || 0,
            },
          });
          setSeries(discardResults.current ? null : (payload.series ?? null));
          setServerHistory((current) => appendHistory(current, { at: historyTime(payload), servers }));
          const run = payload.series?.runs[payload.series.current];
          const elapsed = Number(payload.stats.elapsedSeconds) || 0;
          const running = Boolean(payload.isRunning && run?.state === 'running');
          const previousElapsed = elapsedRef.current;
          elapsedRef.current = elapsed;
          if (runningRef.current && !running) {
            const atSec = Math.max(previousElapsed, elapsed);
            setManualOutages((current) => current.map((outage) => (
              outage.open
                ? { ...outage, startAtSec: Math.max(outage.startAtSec, atSec), open: false }
                : outage
            )));
          } else if (running) {
            setManualOutages((current) => growOpenOutages(current, elapsed));
          }
          runningRef.current = running;
        } else if (message.type === 'error') {
          const payload = message.payload as ErrorPayload;
          setError(payload.message);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    return () => ws.current?.close();
  }, []);

  const refreshSeriesResults = useCallback(async () => {
    try {
      const results = await fetchLoadStandJson<SeriesStatus | null>('/api/series');
      setSeriesResults(discardResults.current ? null : (results ?? null));
    } catch {
      // The next poll tries again; the one-second status already shows the series state.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (serverHistory.length === 0) {
          sessionStorage.removeItem(HISTORY_STORAGE);
        } else {
          sessionStorage.setItem(HISTORY_STORAGE, JSON.stringify(serverHistory));
        }
      } catch {
        // Private mode or a full store must not break the live charts.
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [serverHistory]);

  const seed = runHistorySeed(seriesResults ?? series);
  const seedKey = seed ? `${seed.index}:${seed.startedAtMs}` : '';
  useEffect(() => {
    if (!seedKey) {
      return undefined;
    }
    const index = Number(seedKey.slice(0, seedKey.indexOf(':')));
    let cancelled = false;
    fetchLoadStandJson<ServerHistoryPoint[]>(`/api/series/runs/${index}/servers`)
      .then((points) => {
        if (!cancelled && !discardResults.current && points?.length) {
          setServerHistory((current) => mergeHistory(points, current));
        }
      })
      .catch(() => {
        // An older load-stand only serves a finished run; the socket still fills the rest.
      });
    return () => {
      cancelled = true;
    };
  }, [seedKey]);

  // Samples are too big for the one-second message, so they are fetched separately,
  // every few seconds while a series runs.
  const seriesActive = series?.active ?? false;
  useEffect(() => {
    // Runs on load and again whenever the series starts or ends, so the final
    // samples are fetched after the last second.
    void refreshSeriesResults();
    if (!seriesActive) {
      return undefined;
    }
    const timer = window.setInterval(() => void refreshSeriesResults(), SERIES_POLL_MS);
    return () => window.clearInterval(timer);
  }, [seriesActive, refreshSeriesResults]);

  const sendCommand = useCallback((action: string, payload: TestConfig | Record<string, never> = {}) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      setError(null);
      ws.current.send(JSON.stringify({ action, payload }));
    } else {
      setError('WebSocket is not connected. Run: make up-load-stand');
    }
  }, []);

  const clearLocalResults = useCallback(() => {
    setManualOutages([]);
    setServerHistory([]);
    try {
      sessionStorage.removeItem(HISTORY_STORAGE);
    } catch {
      // Ignore a missing store; the in-memory history is already empty.
    }
  }, []);

  const startSeries = useCallback((config: TestConfig) => {
    discardResults.current = false;
    clearLocalResults();
    sendCommand('startSeries', config);
  }, [sendCommand, clearLocalResults]);

  const clearResults = useCallback(() => {
    discardResults.current = true;
    clearLocalResults();
    setSeries(null);
    setSeriesResults(null);
    setStatus((current) => ({
      ...current,
      stats: {
        ...current.stats,
        successfulRequests: 0,
        failedRequests: 0,
        endpointStats: {},
        report: null,
        elapsedSeconds: 0,
        waveIteration: 0,
        waveIndex: 0,
        waveCount: 0,
        waveIterations: 0,
      },
    }));
    sendCommand('clear');
  }, [sendCommand, clearLocalResults]);

  const stopTest = useCallback(() => sendCommand('stop'), [sendCommand]);

  const restartRun = useCallback((index: number) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      setError(null);
      ws.current.send(JSON.stringify({ action: 'restartRun', index }));
    } else {
      setError('WebSocket is not connected. Run: make up-load-stand');
    }
  }, []);

  const setServerPower = useCallback(async (name: string, action: 'start' | 'stop') => {
    setPendingServer(name);
    setError(null);
    if (runningRef.current) {
      const atSec = elapsedRef.current;
      setManualOutages((current) => action === 'stop'
        ? current.filter((outage) => outage.server !== name || !outage.open).concat({
          server: name,
          stopAtSec: atSec,
          startAtSec: atSec,
          open: true,
        })
        : current.map((outage) => (
          outage.server === name && outage.open
            ? { ...outage, startAtSec: Math.max(outage.startAtSec, atSec), open: false }
            : outage
        )));
    }
    try {
      await postLoadStandJson(`/api/servers/${encodeURIComponent(name)}`, { action });
      setStatus((current) => ({
        ...current,
        stats: {
          ...current.stats,
          Servers: current.stats.Servers?.map((server) => (
            server.name === name
              ? { ...server, running: action === 'start', status: action === 'start' ? server.status : 'down' }
              : server
          )),
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change server power');
    } finally {
      setPendingServer((current) => (current === name ? null : current));
    }
  }, []);

  return {
    endpoints,
    algorithms,
    status,
    serverHistory,
    startSeries,
    clearResults,
    restartRun,
    series,
    seriesResults,
    stopTest,
    setServerPower,
    manualOutages: manualOutages.map(({ server, stopAtSec, startAtSec }) => ({ server, stopAtSec, startAtSec })),
    pendingServer,
    error,
    isLoading,
  };
};

// During a run the chart uses the same clock as the samples and the outage
// schedule: start of the test plus elapsed seconds. The wall clock of this
// machine jumps ahead of the Go timers, so Date.now() puts a stop 20 s late.
type ManualOutage = SeriesOutage & { open: boolean };

function growOpenOutages(current: ManualOutage[], elapsed: number): ManualOutage[] {
  if (!current.some((outage) => outage.open)) {
    return current;
  }
  return current.map((outage) => (
    outage.open ? { ...outage, startAtSec: Math.max(outage.startAtSec, elapsed) } : outage
  ));
}

function loadStoredHistory(): ServerHistoryPoint[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_STORAGE);
    if (!raw) {
      return [];
    }
    const points = JSON.parse(raw) as ServerHistoryPoint[];
    if (!Array.isArray(points) || points.length === 0) {
      return [];
    }
    const latest = points[points.length - 1]?.at;
    if (!Number.isFinite(latest) || Date.now() - latest > HISTORY_MS) {
      return [];
    }
    return points.filter((point) => Number.isFinite(point.at) && Array.isArray(point.servers));
  } catch {
    return [];
  }
}

function runHistorySeed(series: SeriesStatus | null): { index: number; startedAtMs: number } | null {
  if (!series?.runs.length) {
    return null;
  }
  const from = (index: number) => {
    const startedAtMs = series.runs[index]?.startedAtMs;
    return startedAtMs ? { index, startedAtMs } : null;
  };
  const current = from(series.current);
  if (current) {
    return current;
  }
  for (let index = series.runs.length - 1; index >= 0; index -= 1) {
    const found = from(index);
    if (found) {
      return found;
    }
  }
  return null;
}

function appendHistory(current: ServerHistoryPoint[], point: ServerHistoryPoint): ServerHistoryPoint[] {
  const last = current[current.length - 1];
  const next = last && last.at === point.at
    ? current.slice(0, -1).concat(point)
    : last && point.at < last.at
      ? current
      : current.concat(point);
  const cutoff = next[next.length - 1].at - HISTORY_MS;
  const start = next.findIndex((item) => item.at >= cutoff);
  return start > 0 ? next.slice(start) : next;
}

function mergeHistory(base: ServerHistoryPoint[], extra: ServerHistoryPoint[]): ServerHistoryPoint[] {
  const byAt = new Map<number, ServerHistoryPoint>();
  for (const point of base) {
    byAt.set(point.at, point);
  }
  for (const point of extra) {
    byAt.set(point.at, point);
  }
  return [...byAt.values()].sort((left, right) => left.at - right.at);
}

function historyTime(payload: StatusPayload): number {
  const series = payload.series;
  const run = series?.runs[series.current];
  const elapsed = Number(payload.stats.elapsedSeconds) || 0;
  if (payload.isRunning && run?.state === 'running' && run.startedAtMs) {
    return run.startedAtMs + elapsed * 1000;
  }
  return Date.now();
}
