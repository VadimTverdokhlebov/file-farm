import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
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
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (algorithms.length > 0 && !selectedAlgorithm) {
      setSelectedAlgorithm(algorithms[0].id);
    }
  }, [algorithms, selectedAlgorithm, setSelectedAlgorithm]);

  const handleStart = () => {
    if (endpoints.length === 0) {
      setFormError('No endpoints available. Check that the load stand is running.');
      return;
    }
    if (!selectedAlgorithm) {
      setFormError('Select a load-balancing algorithm.');
      return;
    }
    if (fileSizeMinKb < 1 || fileSizeMaxKb < fileSizeMinKb || fileSizeMaxKb > 47 * 1024) {
      setFormError('File size must be between 1 KB and 47 MB, and the minimum cannot exceed the maximum.');
      return;
    }

    setFormError(null);
    startTest({
      concurrency,
      duration,
      endpoints,
      algorithm: selectedAlgorithm,
      fileSizeMinKb,
      fileSizeMaxKb,
      warmupFiles,
    });
  };

  const servers = status.stats.Servers ?? [];
  const endpointEntries = Object.entries(status.stats.endpointStats ?? {});

  return (
    <div className="load-page">
      <div className="load-shell">
        <header className="load-header">
          <div>
            <p className="load-kicker">File Farm</p>
            <h1>Load test</h1>
            <p className="load-lead">
              Configure a run for testing and learning. Every available request is used, and files created by the test are deleted afterwards.
            </p>
          </div>
          <Link className="load-nav" to="/">Files</Link>
        </header>

        <section className="load-card">
          <h2>Run</h2>
          <p className="load-copy">The selected algorithm is applied by the load balancer before the test starts.</p>

          <div className="load-fields">
            <label className="load-field load-field-wide" htmlFor="algorithm">
              Load-balancing algorithm
              <select
                id="algorithm"
                value={selectedAlgorithm}
                onChange={(event) => setSelectedAlgorithm(event.target.value)}
                disabled={status.isRunning || isLoading}
              >
                {algorithms.map((algorithm) => (
                  <option key={algorithm.id} value={algorithm.id}>{algorithm.name}</option>
                ))}
              </select>
            </label>

            <NumberField
              id="concurrency"
              label="Concurrent clients"
              min={1}
              value={concurrency}
              disabled={status.isRunning}
              onChange={setConcurrency}
            />
            <NumberField
              id="duration"
              label="Duration, seconds (0 = infinite)"
              min={0}
              value={duration}
              disabled={status.isRunning}
              onChange={setDuration}
            />
            <NumberField
              id="fileSizeMinKb"
              label="Minimum file size, KB"
              min={1}
              max={47 * 1024}
              value={fileSizeMinKb}
              disabled={status.isRunning}
              onChange={setFileSizeMinKb}
            />
            <NumberField
              id="fileSizeMaxKb"
              label="Maximum file size, KB"
              min={1}
              max={47 * 1024}
              value={fileSizeMaxKb}
              disabled={status.isRunning}
              onChange={setFileSizeMaxKb}
            />
            <NumberField
              id="warmupFiles"
              label="Warmup uploads"
              min={0}
              value={warmupFiles}
              disabled={status.isRunning}
              onChange={setWarmupFiles}
            />
          </div>

          <div className="load-actions">
            <Button onClick={handleStart} disabled={status.isRunning}>
              {status.isRunning ? 'Running...' : 'Start'}
            </Button>
            <Button variant="danger" onClick={stopTest} disabled={!status.isRunning}>
              Stop
            </Button>
          </div>
          {formError && <p className="load-notice load-notice-error">{formError}</p>}
        </section>

        <section className="load-card">
          <div className="load-card-title">
            <h2>Live status</h2>
            <span className={`load-pill ${status.isRunning ? 'load-pill-up' : 'load-pill-idle'}`}>
              {status.isRunning ? 'Running' : 'Stopped'}
            </span>
          </div>
          {error && <p className="load-notice load-notice-error">{error}</p>}
          <div className="load-stats">
            <div>
              <span>Successful requests</span>
              <strong>{status.stats.successfulRequests || 0}</strong>
            </div>
            <div>
              <span>Failed requests</span>
              <strong>{status.stats.failedRequests || 0}</strong>
            </div>
          </div>

          {status.stats.report && (
            <div className="load-report">
              <h3>Test report</h3>
              <div className="load-report-grid">
                <Metric label="RPS ↑" value={status.stats.report.rps.toFixed(2)} />
                <Metric label="p50, ms ↓" value={status.stats.report.p50Millis.toFixed(2)} />
                <Metric label="p99, ms ↓" value={status.stats.report.p99Millis.toFixed(2)} />
                <Metric label="Errors, % ↓" value={`${status.stats.report.errorRatePercent.toFixed(2)}%`} />
                <Metric
                  label="Jain"
                  value={status.stats.report.jainAvailable ? status.stats.report.jainIndex.toFixed(3) : 'N/A'}
                />
              </div>
            </div>
          )}
        </section>

        <section className="load-card">
          <h2>Server status</h2>
          <div className="load-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Server</th>
                  <th>RPS</th>
                  <th>Error</th>
                  <th>EDS</th>
                  <th>Mem</th>
                  <th>RAM</th>
                  <th>CPU</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((server) => (
                  <tr key={server.name} className={server.status === 'up' ? '' : 'load-row-down'}>
                    <td>{server.name}</td>
                    <td>{server.rps?.toFixed(1) || '0.0'}</td>
                    <td className={(server.error || 0) > 0 ? 'load-danger' : ''}>
                      {server.error?.toFixed(2) || '0.0'}%
                    </td>
                    <td>{server.eds || 0}</td>
                    <td>{server.mem?.toFixed(1) || '0.0'} MB</td>
                    <td>{server.ram?.toFixed(1) || '0.0'}%</td>
                    <td>{server.cpu?.toFixed(1) || '0.0'}%</td>
                    <td>
                      <span className={`load-pill ${server.status === 'up' ? 'load-pill-up' : 'load-pill-down'}`}>
                        {server.status === 'up' ? 'Online' : 'Offline'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="load-card">
          <h2>Per endpoint</h2>
          {endpointEntries.length > 0 ? (
            <div className="load-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Endpoint</th>
                    <th>Success</th>
                    <th>Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {endpointEntries.map(([endpoint, stats]) => (
                    <tr key={endpoint}>
                      <td>{endpoint}</td>
                      <td>{stats.successfulRequests}</td>
                      <td>{stats.failedRequests}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="load-empty">Per-endpoint counts appear after a test starts.</p>
          )}
        </section>
      </div>
    </div>
  );
};

function NumberField({
  id,
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max?: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="load-field" htmlFor={id}>
      {label}
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(parseInt(event.target.value, 10) || min)}
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="load-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
