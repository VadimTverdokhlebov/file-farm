export interface TestStats {
  successfulRequests: number;
  failedRequests: number;
  endpointStats?: Record<string, EndpointStat>;
  report?: TestMetrics | null;
}

export interface TestMetrics {
  rps: number;
  p50Millis: number;
  p99Millis: number;
  errorRatePercent: number;
  jainIndex: number;
  jainAvailable: boolean;
  durationSeconds: number;
}

export interface EndpointStat {
  successfulRequests: number;
  failedRequests: number;
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
  preset?: string;
  fileSizeKb?: number;
  fileSizeMinKb: number;
  fileSizeMaxKb: number;
  warmupFiles?: number;
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
