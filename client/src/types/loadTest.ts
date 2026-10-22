export interface ServerStatus {
  name: string;
  rps: number;
  error: number;
  eds: number;
  mem: number;
  ram: number;
  cpu: number;
  status: string;
  running?: boolean;
}

export interface TestStats {
  successfulRequests: number;
  failedRequests: number;
  endpointStats?: Record<string, EndpointStat>;
  report?: TestMetrics | null;
  Servers?: ServerStatus[];
  elapsedSeconds?: number;
  durationSeconds?: number;
  waveIteration?: number;
  waveIndex?: number;
  waveCount?: number;
  waveIterations?: number;
}

export interface TestMetrics {
  rps: number;
  p50Millis: number;
  p95Millis?: number;
  p99Millis: number;
  errorRatePercent: number;
  // Mean absolute deviation of the CPU load of the servers, taken every second and averaged
  // over the test, in percentage points of their own limits; lower is better.
  cpuMadMeanPercent?: number;
  cpuMadMeanAvailable?: boolean;
  durationSeconds: number;
}

export interface EndpointStat {
  successfulRequests: number;
  failedRequests: number;
}

export interface ServerHistoryPoint {
  at: number;
  servers: ServerStatus[];
}

export interface TestStatus {
  isRunning: boolean;
  stats: TestStats;
}

export interface TestConfig {
  concurrency: number;
  duration: number;
  endpoints: string[];
  algorithm: string;
  freezeModel?: boolean;
  preset?: string;
  fileSizeKb?: number;
  fileSizeMinKb: number;
  fileSizeMaxKb: number;
  warmupFiles?: number;
  stopServer?: string;
  stopAfterSec?: number;
  outageServers?: string[];
  outageMinSec?: number;
  outageMaxSec?: number;
  outagePlan?: {
    server: string;
    stopAtSec: number;
    startAtSec: number;
  }[];
  waveIterations?: number;
  // A series runs the same test once for every listed algorithm.
  algorithms?: string[];
  cooldownSec?: number;
  phases?: {
    concurrency: number;
    durationSec: number;
    fileSizeMinKb: number;
    fileSizeMaxKb: number;
  }[];
}

export interface BalancerAlgorithm {
  id: string;
  name: string;
}

export interface BalancerConfiguration {
  algorithms: BalancerAlgorithm[];
  selected: string;
}

export interface LoadPreset {
  id: string;
  name: string;
  description: string;
  endpoints: string[];
  fileSizeKb: number;
  warmupFiles: number;
}

// One second of a run of a series, for the whole cluster.
export interface SeriesSample {
  t: number;
  cpuMad: number;
  rps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorPct: number;
  live: number;
}

export type SeriesRunState = 'pending' | 'running' | 'done' | 'stopped' | 'failed';
export type SeriesPhase = 'preparing' | 'running' | 'cooldown' | 'finished' | 'stopped' | 'failed';

export interface SeriesRun {
  algorithm: string;
  state: SeriesRunState;
  error?: string;
  report?: TestMetrics | null;
  samples?: SeriesSample[];
  // When the load began, in Unix milliseconds.
  startedAtMs?: number;
}

export interface SeriesOutage {
  server: string;
  stopAtSec: number;
  startAtSec: number;
}

export interface SeriesStatus {
  active: boolean;
  // Id of the scenario the series was started from.
  preset?: string;
  phase: SeriesPhase;
  current: number;
  cooldownLeftSec: number;
  durationSec: number;
  freezeModel: boolean;
  message?: string;
  outages?: SeriesOutage[];
  runs: SeriesRun[];
  // Time of the whole series so far, the pauses between runs included.
  elapsedSec?: number;
}
