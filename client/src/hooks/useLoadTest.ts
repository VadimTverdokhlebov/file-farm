import { useState, useEffect, useRef, useCallback } from 'react';
import { TestStatus, TestConfig } from '../types/loadTest';

interface UseLoadTestReturn {
  endpoints: string[];
  status: TestStatus;
  startTest: (config: TestConfig) => void;
  stopTest: () => void;
  error: string | null;
}

interface StatusPayload {
  isRunning: boolean;
  stats: {
    successfulRequests: number;
    failedRequests: number;
  };
}

interface ErrorPayload {
  message: string;
}

interface WebSocketMessage {
  type: 'status' | 'error';
  payload: StatusPayload | ErrorPayload;
}

export const useLoadTest = (): UseLoadTestReturn => {
  const [endpoints, setEndpoints] = useState<string[]>([]);
  const [status, setStatus] = useState<TestStatus>({
    isRunning: false,
    stats: { successfulRequests: 0, failedRequests: 0 },
  });
  const [error, setError] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    const fetchEndpoints = async () => {
      try {
        const response = await fetch('/api/endpoints');
        if (!response.ok) throw new Error('Failed to fetch endpoints');
        const data: string[] = await response.json();
        setEndpoints(data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    };

    fetchEndpoints();

    const wsUrl = `ws://${window.location.host}/ws`;
    ws.current = new WebSocket(wsUrl);

    ws.current.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        if (message.type === 'status') {
          const payload = message.payload as StatusPayload;
          setStatus({
            isRunning: payload.isRunning,
            stats: {
              successfulRequests: Number(payload.stats.successfulRequests) || 0,
              failedRequests: Number(payload.stats.failedRequests) || 0,
            },
          });
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

  const sendCommand = useCallback((action: string, payload: TestConfig | Record<string, never> = {}) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      setError(null);
      ws.current.send(JSON.stringify({ action, payload }));
    } else {
      setError('WebSocket is not connected');
    }
  }, []);

  const startTest = useCallback((config: TestConfig) => sendCommand('start', config), [sendCommand]);
  const stopTest = useCallback(() => sendCommand('stop'), [sendCommand]);

  return { endpoints, status, startTest, stopTest, error };
};