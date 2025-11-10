export interface TestStats {
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
}