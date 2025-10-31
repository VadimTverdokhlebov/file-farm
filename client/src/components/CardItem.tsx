import React, { useState, useEffect, useRef, useCallback } from 'react';
import './CardItem.css';
import { activateLed, getStatusLed } from '../query';

interface CardItemProps {
  itemValue: string;
  onDelete: () => void;
}

const STATUS_DELAYS = {
  PendingRunning: 10000,
  Running: 60000,
  Timeout: 30000,
} as const;

const CardItem: React.FC<CardItemProps> = ({ itemValue, onDelete }) => {
  const [status, setStatus] = useState<'Awating' | 'PendingRunning' | 'Running' | 'Timeout' | 'Failed' | 'Stopped'>('Awating');
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const isMounted = useRef(true);

  // Очистка при размонтировании
  useEffect(() => {
    return () => {
      isMounted.current = false;
      stopProcess();
    };
  }, []);

  const stopProcess = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    setStatus('Stopped');
    setTimeLeft(0);
  }, []);

  const scheduleNextRequest = useCallback((delay: number, requestFn: () => Promise<void>) => {
    if (!isMounted.current) return;

    let currentTime = delay / 1000;
    setTimeLeft(currentTime);

    const updateTimer = () => {
      if (currentTime <= 0) {
        requestFn();
        return;
      }
      setTimeLeft(--currentTime);
      timerRef.current = setTimeout(updateTimer, 1000);
    };

    timerRef.current = setTimeout(updateTimer, 1000);
  }, []);

  const handleStatusResponse = useCallback(async (response: any) => {
    if (!isMounted.current) return;

    switch (response?.led_request_status) {
      case 'PendingRunning':
        setStatus('PendingRunning');
        scheduleNextRequest(STATUS_DELAYS.PendingRunning, handleGetStatus);
        break;
      case 'Running':
        setStatus('Running');
        scheduleNextRequest(STATUS_DELAYS.Running, handleGetStatus);
        break;
      case 'Timeout':
        setStatus('Timeout');
        scheduleNextRequest(STATUS_DELAYS.Timeout, handleRunClick);
        break;
      default:
        setStatus('Failed');
        stopProcess();
    }
  }, [scheduleNextRequest, stopProcess]);

  const handleGetStatus = useCallback(async () => {
    try {
      const result = await getStatusLed(itemValue);
      await handleStatusResponse(result);
    } catch (error) {
      console.error('Status check failed:', error);
      stopProcess();
    }
  }, [itemValue, handleStatusResponse, stopProcess]);

  const handleRunClick = useCallback(async () => {
    stopProcess(); // Остановить предыдущий процесс
    
    try {
      const result = await activateLed(itemValue);
      await handleStatusResponse(result);
    } catch (error) {
      console.error('Activation failed:', error);
      stopProcess();
    }
  }, [itemValue, handleStatusResponse, stopProcess]);

  const handleStopClick = useCallback(() => {
    stopProcess();
  }, [stopProcess]);

  return (
    <div className="card-item">
      <div className="card-header">{itemValue}</div>
      <div className="card-body">
        <p>Status: {status}</p>
        <p>Next request in: {timeLeft}s</p>
        <div className="controls">
          <button 
            onClick={handleRunClick} 
            disabled={status === 'Running' || status === 'PendingRunning'}
          >
            Run
          </button>
          <button 
            onClick={handleStopClick} 
            disabled={status !== 'Running' && status !== 'PendingRunning'}
          >
            Stop
          </button>
          <button onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  );
};

export default CardItem;