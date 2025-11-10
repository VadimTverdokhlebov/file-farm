// src/hooks/useLoadTest.ts

import { useState, useEffect, useRef, useCallback } from 'react';
import { TestStatus, TestConfig } from '../types/loadTest';

interface UseLoadTestReturn {
  endpoints: string[];
  status: TestStatus;
  startTest: (config: TestConfig) => void; // Больше не async
  stopTest: () => void; // Больше не async
  error: string | null;
}

// Определяем тип для входящих сообщений с сервера
interface WebSocketMessage {
  type: 'status' | 'error';
  payload: any;
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
    // Получение эндпоинтов остается по HTTP, т.к. это разовая операция при загрузке
    const fetchEndpoints = async () => {
      try {
        const response = await fetch('/api/endpoints');
        if (!response.ok) throw new Error('Failed to fetch endpoints from server.');
        const data: string[] = await response.json();
        setEndpoints(data || []);
      } catch (err: any) {
        setError(err.message);
      }
    };
    fetchEndpoints();

    // Настраиваем WebSocket
    const wsUrl = `ws://${window.location.host}/ws`;
    ws.current = new WebSocket(wsUrl);
    ws.current.onopen = () => console.log('WebSocket connected');
    ws.current.onclose = () => console.log('WebSocket disconnected');

    ws.current.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);

        // Обрабатываем сообщения в зависимости от их типа
        if (message.type === 'status') {
          const newStatus: TestStatus = {
            isRunning: message.payload.isRunning,
            stats: {
              successfulRequests: Number(message.payload.stats.successfulRequests) || 0,
              failedRequests: Number(message.payload.stats.failedRequests) || 0,
            },
          };
          setStatus(newStatus);
        } else if (message.type === 'error') {
          setError(message.payload.message);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };
    
    const currentWs = ws.current;
    return () => {
      currentWs.close();
    };
  }, []);

  // Отправляем команду "start" через WebSocket
  const startTest = useCallback((config: TestConfig) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      setError(null);
      ws.current.send(JSON.stringify({
        action: 'start',
        payload: config,
      }));
    } else {
      setError('WebSocket is not connected.');
    }
  }, []);

  // Отправляем команду "stop" через WebSocket
  const stopTest = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      setError(null);
      ws.current.send(JSON.stringify({
        action: 'stop',
        payload: {}, // payload не нужен, но для консистентности отправляем пустой объект
      }));
    } else {
      setError('WebSocket is not connected.');
    }
  }, []);

  return { endpoints, status, startTest, stopTest, error };
};