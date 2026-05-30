import { useState, useEffect, useRef, useCallback } from 'react';
import { TestStatus, TestConfig, LoadPreset } from '../types/loadTest';
import { fetchLoadStandJson, getLoadStandWsUrl } from '../config/loadStand';

interface UseLoadTestReturn {
  endpoints: string[];
  presets: LoadPreset[];
  status: TestStatus;
  startTest: (config: TestConfig) => void;
  stopTest: () => void;
  error: string | null;
  isLoading: boolean;
}

interface StatusPayload {
  isRunning: boolean;
  stats: TestStatus['stats'];
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
  const [presets, setPresets] = useState<LoadPreset[]>([]);
  const [status, setStatus] = useState<TestStatus>({
    isRunning: false,
    stats: { successfulRequests: 0, failedRequests: 0 },
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [endpointsData, presetsData] = await Promise.all([
          fetchLoadStandJson<string[]>('/api/endpoints'),
          fetchLoadStandJson<LoadPreset[]>('/api/presets'),
        ]);

        setEndpoints(endpointsData || []);
        setPresets(presetsData || []);
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
          setStatus({
            isRunning: payload.isRunning,
            stats: {
              successfulRequests: Number(payload.stats.successfulRequests) || 0,
              failedRequests: Number(payload.stats.failedRequests) || 0,
              endpointStats: payload.stats.endpointStats || {},
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
      setError('WebSocket is not connected. Run: make up-load-stand');
    }
  }, []);

  const startTest = useCallback((config: TestConfig) => sendCommand('start', config), [sendCommand]);
  const stopTest = useCallback(() => sendCommand('stop'), [sendCommand]);

  return { endpoints, presets, status, startTest, stopTest, error, isLoading };
};
