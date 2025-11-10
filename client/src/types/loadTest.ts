// src/types/loadTest.ts
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
  duration: number; // в секундах
  endpoints: string[];
}