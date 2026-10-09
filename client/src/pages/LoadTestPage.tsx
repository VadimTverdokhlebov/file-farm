import React, { useState } from 'react';
import { useLoadTest } from '../hooks/useLoadTest';
import { LoadPreset } from '../types/loadTest';
import './LoadTestPage.css';

export const LoadTestPage = () => {
  const {
    endpoints,
    presets,
    algorithms,
    selectedAlgorithm,
    setSelectedAlgorithm,
    status,
    startTest,
    stopTest,
    error,
    isLoading,
  } = useLoadTest();
  const [concurrency, setConcurrency] = useState(30);
  const [duration, setDuration] = useState(120);
  const [fileSizeMinKb, setFileSizeMinKb] = useState(128);
  const [fileSizeMaxKb, setFileSizeMaxKb] = useState(1024);
  const [warmupFiles, setWarmupFiles] = useState(20);
  const [selectedPreset, setSelectedPreset] = useState<string>('mixed-files');
  const [selectedEndpoints, setSelectedEndpoints] = useState<Set<string>>(new Set());

  const applyPreset = (preset: LoadPreset) => {
    setSelectedPreset(preset.id);
    setSelectedEndpoints(new Set(preset.endpoints));
    setFileSizeMinKb(preset.fileSizeKb || 128);
    setFileSizeMaxKb(preset.fileSizeKb || 128);
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
    if (!selectedAlgorithm) {
      alert('Select a load-balancing algorithm');
      return;
    }
    if (fileSizeMinKb < 1 || fileSizeMaxKb < fileSizeMinKb || fileSizeMaxKb > 47 * 1024) {
      alert('File size range must be between 1 KB and 47 MB, with minimum no greater than maximum');
      return;
    }

    startTest({
      concurrency,
      duration,
      endpoints: Array.from(selectedEndpoints),
      algorithm: selectedAlgorithm,
      preset: selectedPreset || undefined,
      fileSizeMinKb,
      fileSizeMaxKb,
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

        <div className="form-group">
          <label htmlFor="algorithm">Load-balancing algorithm</label>
          <select
            id="algorithm"
            value={selectedAlgorithm}
            onChange={(e) => setSelectedAlgorithm(e.target.value)}
            disabled={status.isRunning || isLoading}
          >
            {algorithms.map((algorithm) => (
              <option key={algorithm.id} value={algorithm.id}>{algorithm.name}</option>
            ))}
          </select>
        </div>

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
            <label htmlFor="fileSizeMinKb">Minimum file size (KB)</label>
            <input
              id="fileSizeMinKb"
              type="number"
              min={1}
              max={47 * 1024}
              value={fileSizeMinKb}
              onChange={(e) => {
                setFileSizeMinKb(parseInt(e.target.value, 10) || 1);
                setSelectedPreset('');
              }}
              disabled={status.isRunning}
            />
          </div>

          <div className="form-group">
            <label htmlFor="fileSizeMaxKb">Maximum file size (KB)</label>
            <input
              id="fileSizeMaxKb"
              type="number"
              min={1}
              max={47 * 1024}
              value={fileSizeMaxKb}
              onChange={(e) => {
                setFileSizeMaxKb(parseInt(e.target.value, 10) || 1);
                setSelectedPreset('');
              }}
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

        {!status.isRunning && status.stats.report && (
          <section className="completion-report" aria-live="polite">
            <h3>Test report</h3>
            <div className="report-grid">
              <div className="report-metric">
                <span>RPS ↑</span>
                <strong>{status.stats.report.rps.toFixed(2)}</strong>
              </div>
              <div className="report-metric">
                <span>p50, мс ↓</span>
                <strong>{status.stats.report.p50Millis.toFixed(2)}</strong>
              </div>
              <div className="report-metric">
                <span>p99, мс ↓</span>
                <strong>{status.stats.report.p99Millis.toFixed(2)}</strong>
              </div>
              <div className="report-metric">
                <span>Ошибки, % ↓</span>
                <strong>{status.stats.report.errorRatePercent.toFixed(2)}%</strong>
              </div>
              <div className="report-metric">
                <span>Jain</span>
                <strong>
                  {status.stats.report.jainAvailable
                    ? status.stats.report.jainIndex.toFixed(3)
                    : 'N/A'}
                </strong>
              </div>
            </div>
          </section>
        )}

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
