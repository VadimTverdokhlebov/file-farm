import { useState, useEffect, useRef, useCallback } from 'react';
import { TestStatus, TestConfig, LoadPreset, BalancerAlgorithm, BalancerConfiguration, ServerStatus } from '../types/loadTest';
import { fetchLoadStandJson, getLoadStandWsUrl, postLoadStandJson } from '../config/loadStand';

interface UseLoadTestReturn {
  endpoints: string[];
  presets: LoadPreset[];
  algorithms: BalancerAlgorithm[];
  selectedAlgorithm: string;
  setSelectedAlgorithm: (algorithm: string) => void;
  status: TestStatus;
  startTest: (config: TestConfig) => void;
  stopTest: () => void;
  setServerPower: (name: string, action: 'start' | 'stop') => Promise<void>;
  pendingServer: string | null;
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
  const [presets, setPresets] = useState<LoadPreset[]>([]);
  const [algorithms, setAlgorithms] = useState<BalancerAlgorithm[]>([]);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState('');
  const [status, setStatus] = useState<TestStatus>({
    isRunning: false,
    stats: { successfulRequests: 0, failedRequests: 0, report: null, Servers: defaultServers() },
  });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingServer, setPendingServer] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [endpointsData, presetsData, balancerConfiguration] = await Promise.all([
          fetchLoadStandJson<string[]>('/api/endpoints'),
          fetchLoadStandJson<LoadPreset[]>('/api/presets'),
          fetchLoadStandJson<BalancerConfiguration>('/api/algorithms'),
        ]);

        setEndpoints(endpointsData || []);
        setPresets(presetsData || []);
        setAlgorithms(balancerConfiguration.algorithms || []);
        setSelectedAlgorithm(balancerConfiguration.selected || '');
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
              report: payload.stats.report || null,
              Servers: payload.stats.Servers?.length ? payload.stats.Servers : defaultServers(),
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

  const setServerPower = useCallback(async (name: string, action: 'start' | 'stop') => {
    setPendingServer(name);
    setError(null);
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
    presets,
    algorithms,
    selectedAlgorithm,
    setSelectedAlgorithm,
    status,
    startTest,
    stopTest,
    setServerPower,
    pendingServer,
    error,
    isLoading,
  };
};
