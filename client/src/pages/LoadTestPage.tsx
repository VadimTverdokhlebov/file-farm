import { useState, useEffect } from 'react';
import { useLoadTest } from '../hooks/useLoadTest';
import './LoadTestPage.css';

export const LoadTestPage = () => {
  const {
    endpoints,
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

  // Automatically select the first algorithm if not selected yet
  useEffect(() => {
    if (algorithms.length > 0 && !selectedAlgorithm) {
      setSelectedAlgorithm(algorithms[0].id);
    }
  }, [algorithms, selectedAlgorithm, setSelectedAlgorithm]);

  const handleStart = () => {
    if (endpoints.length === 0) {
      alert('No endpoints available to test. Check that load stand is running.');
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
      endpoints: endpoints, // Use all endpoints
      algorithm: selectedAlgorithm,
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
          Configure parameters for testing and learning. All available requests will be used. Created files will be automatically deleted.
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

        <div className="form-group">
          <label htmlFor="concurrency">Concurrent clients</label>
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
              onChange={(e) => setFileSizeMinKb(parseInt(e.target.value, 10) || 1)}
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
              onChange={(e) => setFileSizeMaxKb(parseInt(e.target.value, 10) || 1)}
              disabled={status.isRunning}
            />
          </div>

          <div className="form-group">
            <label htmlFor="warmupFiles">Warmup uploads</label>
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

        <div className="controls">
          <button onClick={handleStart} disabled={status.isRunning}>Start learning / testing</button>
          <button onClick={stopTest} disabled={!status.isRunning}>Stop</button>
        </div>
      </div>

      <div className="status-container">
        <h2>Live status: {status.isRunning ? 'Running' : 'Stopped'}</h2>
        {error && <p className="error">Error: {error}</p>}
        <div className="stats">
          <p>Successful requests: <span>{status.stats.successfulRequests || 0}</span></p>
          <p>Failed requests: <span>{status.stats.failedRequests || 0}</span></p>
        </div>

        {status.stats.report && (
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
