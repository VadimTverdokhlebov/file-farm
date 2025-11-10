import React, { useState } from 'react';
import { useLoadTest } from '../hooks/useLoadTest';
import { TestConfig } from '../types/loadTest';
import './LoadTestPage.css';

export const LoadTestPage = () => {
  const { endpoints, status, startTest, stopTest, error } = useLoadTest();

  const [concurrency, setConcurrency] = useState(50);
  const [duration, setDuration] = useState(60);
  const [selectedEndpoints, setSelectedEndpoints] = useState<Set<string>>(new Set());

  const handleEndpointChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value, checked } = e.target;
    const newSet = new Set(selectedEndpoints);
    if (checked) {
      newSet.add(value);
    } else {
      newSet.delete(value);
    }
    setSelectedEndpoints(newSet);
  };

  const handleStart = () => { // Функция больше не async
    if (selectedEndpoints.size === 0) {
      alert('Please select at least one endpoint to test.');
      return;
    }
    const config: TestConfig = {
      concurrency,
      duration,
      endpoints: Array.from(selectedEndpoints),
    };
    startTest(config); // Просто вызываем, не ждем
  };

  const handleStop = () => { // Функция больше не async
    stopTest();
  };

return (
  <div className="dashboard">
    <div className="form-container">
      <h1>Load Test Control Panel</h1>

      {/* Форма настроек */}
      <div className="form-group">
        <label htmlFor="concurrency">Concurrent Users:</label>
        <input
          id="concurrency"
          type="number"
          value={concurrency}
          onChange={(e) => setConcurrency(parseInt(e.target.value))}
          disabled={status.isRunning}
        />
      </div>

      <div className="form-group">
        <label htmlFor="duration">Duration (seconds, 0 for infinite):</label>
        <input
          id="duration"
          type="number"
          value={duration}
          onChange={(e) => setDuration(parseInt(e.target.value))}
          disabled={status.isRunning}
        />
      </div>

      <div className="endpoints-group">
        <h3>Endpoints to Test:</h3>
        <div className="endpoints-list">
          {endpoints.length > 0 ? (
            endpoints.map((ep) => (
              <div key={ep} className="endpoint-item">
                <input
                  type="checkbox"
                  id={ep}
                  value={ep}
                  onChange={handleEndpointChange}
                  disabled={status.isRunning}
                />
                <label htmlFor={ep}>{ep}</label>
              </div>
            ))
          ) : (
            <p>Loading endpoints...</p>
          )}
        </div>
      </div>

      {/* Кнопки управления */}
      <div className="controls">
        <button onClick={handleStart} disabled={status.isRunning}>Start Test</button>
        <button onClick={handleStop} disabled={!status.isRunning}>Stop Test</button>
      </div>
    </div>

    {/* Статусная панель */}
    <div className="status-container">
      <h2>Live Status: {status.isRunning ? 'Running' : 'Stopped'}</h2>
      {error && <p className="error">Error: {error}</p>}
      <div className="stats">
        <p>Successful Requests: <span>{status.stats.successfulRequests || 0}</span></p>
        <p>Failed Requests: <span>{status.stats.failedRequests || 0}</span></p>
      </div>
    </div>
  </div>
);
};
