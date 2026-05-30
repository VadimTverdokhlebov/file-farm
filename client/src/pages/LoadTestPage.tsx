import React, { useState } from 'react';
import { useLoadTest } from '../hooks/useLoadTest';
import { LoadPreset } from '../types/loadTest';
import './LoadTestPage.css';

export const LoadTestPage = () => {
  const { endpoints, presets, status, startTest, stopTest, error, isLoading } = useLoadTest();
  const [concurrency, setConcurrency] = useState(30);
  const [duration, setDuration] = useState(120);
  const [fileSizeKb, setFileSizeKb] = useState(256);
  const [warmupFiles, setWarmupFiles] = useState(20);
  const [selectedPreset, setSelectedPreset] = useState<string>('mixed-files');
  const [selectedEndpoints, setSelectedEndpoints] = useState<Set<string>>(new Set());

  const applyPreset = (preset: LoadPreset) => {
    setSelectedPreset(preset.id);
    setSelectedEndpoints(new Set(preset.endpoints));
    setFileSizeKb(preset.fileSizeKb || 256);
    setWarmupFiles(preset.warmupFiles || 0);
  };

  const handleEndpointChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value, checked } = e.target;
    const newSet = new Set(selectedEndpoints);
    if (checked) {
      newSet.add(value);
    } else {
      newSet.delete(value);
    }
    setSelectedEndpoints(newSet);
    setSelectedPreset('');
  };

  const handleStart = () => {
    if (selectedEndpoints.size === 0) {
      alert('Select at least one endpoint or choose a preset');
      return;
    }

    startTest({
      concurrency,
      duration,
      endpoints: Array.from(selectedEndpoints),
      preset: selectedPreset || undefined,
      fileSizeKb,
      warmupFiles,
    });
  };

  return (
    <div className="dashboard">
      <div className="form-container">
        <h1>Load Test Control Panel</h1>
        <p className="hint">
          Run a preset, then change Envoy <code>lb_policy</code> and repeat the same test to compare Grafana dashboards.
        </p>

        <div className="presets-group">
          <h3>Presets</h3>
          <div className="presets-grid">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`preset-card ${selectedPreset === preset.id ? 'preset-card-active' : ''}`}
                onClick={() => applyPreset(preset)}
                disabled={status.isRunning}
              >
                <strong>{preset.name}</strong>
                <span>{preset.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="concurrency">Concurrent users</label>
          <input
            id="concurrency"
            type="number"
            min={1}
            value={concurrency}
            onChange={(e) => setConcurrency(parseInt(e.target.value, 10) || 1)}
            disabled={status.isRunning}
          />
        </div>

        <div className="form-group">
          <label htmlFor="duration">Duration (seconds, 0 = infinite)</label>
          <input
            id="duration"
            type="number"
            min={0}
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value, 10) || 0)}
            disabled={status.isRunning}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="fileSizeKb">Upload file size (KB)</label>
            <input
              id="fileSizeKb"
              type="number"
              min={1}
              value={fileSizeKb}
              onChange={(e) => setFileSizeKb(parseInt(e.target.value, 10) || 1)}
              disabled={status.isRunning}
            />
          </div>

          <div className="form-group">
            <label htmlFor="warmupFiles">Warmup uploads before download</label>
            <input
              id="warmupFiles"
              type="number"
              min={0}
              value={warmupFiles}
              onChange={(e) => setWarmupFiles(parseInt(e.target.value, 10) || 0)}
              disabled={status.isRunning}
            />
          </div>
        </div>

        <div className="endpoints-group">
          <h3>Endpoints</h3>
          <div className="endpoints-list">
            {isLoading ? (
              <p>Loading endpoints...</p>
            ) : endpoints.length > 0 ? (
              endpoints.map((ep) => (
                <div key={ep} className="endpoint-item">
                  <input
                    type="checkbox"
                    id={ep}
                    value={ep}
                    checked={selectedEndpoints.has(ep)}
                    onChange={handleEndpointChange}
                    disabled={status.isRunning}
                  />
                  <label htmlFor={ep}>{ep}</label>
                </div>
              ))
            ) : (
              <p>No endpoints loaded. Check that load stand is running.</p>
            )}
          </div>
        </div>

        <div className="controls">
          <button onClick={handleStart} disabled={status.isRunning}>Start test</button>
          <button onClick={stopTest} disabled={!status.isRunning}>Stop test</button>
        </div>
      </div>

      <div className="status-container">
        <h2>Live status: {status.isRunning ? 'Running' : 'Stopped'}</h2>
        {error && <p className="error">Error: {error}</p>}
        <div className="stats">
          <p>Successful requests: <span>{status.stats.successfulRequests || 0}</span></p>
          <p>Failed requests: <span>{status.stats.failedRequests || 0}</span></p>
        </div>

        {status.stats.endpointStats && Object.keys(status.stats.endpointStats).length > 0 && (
          <div className="endpoint-stats">
            <h3>Per endpoint</h3>
            <table>
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Success</th>
                  <th>Failed</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(status.stats.endpointStats).map(([endpoint, stats]) => (
                  <tr key={endpoint}>
                    <td>{endpoint}</td>
                    <td>{stats.successfulRequests}</td>
                    <td>{stats.failedRequests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
