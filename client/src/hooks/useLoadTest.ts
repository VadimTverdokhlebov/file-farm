// src/hooks/useLoadTest.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { TestStats, TestStatus, TestConfig } from '../types/loadTest';

// Определяем тип возвращаемого значения хука для удобства
interface UseLoadTestReturn {
  endpoints: string[];
  status: TestStatus;
  startTest: (config: TestConfig) => Promise<void>;
  stopTest: () => Promise<void>;
  error: string | null;
}

export const useLoadTest = (): UseLoadTestReturn => {
  const [endpoints, setEndpoints] = useState<string[]>([]);
  const [status, setStatus] = useState<TestStatus>({
    isRunning: false,
    stats: { successfulRequests: 0, failedRequests: 0 },
  });
  const [error, setError] = useState<string | null>(null);

  const ws = useRef<WebSocket | null>(null);

  // Получаем список эндпоинтов
  useEffect(() => {
    const fetchEndpoints = async () => {
      try {
        const response = await fetch('/api/endpoints');
        if (!response.ok) throw new Error('Failed to fetch endpoints');
        const data: string[] = await response.json();
        setEndpoints(data || []);
      } catch (err: any) {
        setError(err.message);
      }
    };
    fetchEndpoints();
  }, []);

  // Управляем WebSocket соединением
  useEffect(() => {
    const wsUrl = `ws://${window.location.host}/ws`;
    ws.current = new WebSocket(wsUrl);
    ws.current.onopen = () => console.log('WebSocket connected');
    ws.current.onclose = () => console.log('WebSocket disconnected');

    ws.current.onmessage = (event) => {
      try {
        const data: TestStatus = JSON.parse(event.data);
        setStatus(data);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };
    
    const currentWs = ws.current;
    return () => {
      currentWs.close();
    };
  }, []);

  const startTest = useCallback(async (config: TestConfig) => {
    setError(null);
    try {
      const response = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || 'Failed to start test');
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const stopTest = useCallback(async () => {
    setError(null);
    try {
      await fetch('/api/stop', { method: 'POST' });
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  return { endpoints, status, startTest, stopTest, error };
};