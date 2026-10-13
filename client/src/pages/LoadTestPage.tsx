import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { ServerCharts } from '../components/ServerCharts';
import { ScenarioPhase, maxTestFileSizeKb, scenarioById, trainingScenarios } from '../config/trainingScenarios';
import { useLoadTest } from '../hooks/useLoadTest';
import './LoadTestPage.css';

export const LoadTestPage = () => {
  const {
    endpoints,
    algorithms,
    selectedAlgorithm,
    setSelectedAlgorithm,
    status,
    serverHistory,
    startTest,
    stopTest,
    setServerPower,
    pendingServer,
    error,
    isLoading,
  } = useLoadTest();
  const initialScenario = trainingScenarios[0];
  const [scenarioId, setScenarioId] = useState(initialScenario.id);
  const [concurrency, setConcurrency] = useState(initialScenario.concurrency);
  const [duration, setDuration] = useState(initialScenario.duration);
  const [fileSizeMinKb, setFileSizeMinKb] = useState(initialScenario.fileSizeMinKb);
  const [fileSizeMaxKb, setFileSizeMaxKb] = useState(initialScenario.fileSizeMaxKb);
  const [stopServer, setStopServer] = useState(initialScenario.stopServer);
  const [stopAfterSec, setStopAfterSec] = useState(initialScenario.stopAfterSec);
  const [waveIterations, setWaveIterations] = useState(initialScenario.waveIterations);
  const [phases, setPhases] = useState<ScenarioPhase[]>(initialScenario.phases);
  const [formError, setFormError] = useState<string | null>(null);
  const scenario = scenarioById(scenarioId);

  useEffect(() => {
    if (algorithms.length > 0 && !selectedAlgorithm) {
      setSelectedAlgorithm(algorithms[0].id);
    }
  }, [algorithms, selectedAlgorithm, setSelectedAlgorithm]);

  const handleStart = () => {
    if (endpoints.length === 0) {
      setFormError('Нет доступных методов. Проверьте, что стенд нагрузки запущен.');
      return;
    }
    if (!selectedAlgorithm) {
      setFormError('Выберите алгоритм балансировки.');
      return;
    }
    if (phases.length > 0) {
      const invalidPhase = phases.find((phase) => (
        phase.concurrency < 1
        || phase.durationSec < 5
        || phase.fileSizeMinKb < 1
        || phase.fileSizeMaxKb < phase.fileSizeMinKb
        || phase.fileSizeMaxKb > maxTestFileSizeKb
      ));
      if (invalidPhase) {
        setFormError(`В каждой волне нужен хотя бы 1 клиент, длительность от 5 секунд и размер файла от 1 до ${maxTestFileSizeKb} КБ.`);
        return;
      }
    } else if (fileSizeMinKb < 1 || fileSizeMaxKb < fileSizeMinKb || fileSizeMaxKb > maxTestFileSizeKb) {
      setFormError(`Размер файла должен быть от 1 до ${maxTestFileSizeKb} КБ, минимум не может быть больше максимума.`);
      return;
    }
    const waveDuration = phases.reduce((total, phase) => total + phase.durationSec, 0);
    if (phases.length > 0 && waveIterations < 0) {
      setFormError('Число повторов круга не может быть отрицательным. 0 означает без конца.');
      return;
    }
    if (scenario.stopServer && (stopAfterSec < 5 || (duration > 0 && stopAfterSec >= duration))) {
      setFormError('Останавливайте сервер не раньше чем через 5 секунд и до конца теста.');
      return;
    }

    setFormError(null);
    startTest({
      concurrency: phases.length > 0 ? phases[0].concurrency : concurrency,
      duration: phases.length > 0 ? (waveIterations === 0 ? 0 : waveDuration * waveIterations) : duration,
      endpoints: scenario.endpoints,
      algorithm: selectedAlgorithm,
      preset: scenario.id,
      fileSizeMinKb: phases.length > 0 ? phases[0].fileSizeMinKb : fileSizeMinKb,
      fileSizeMaxKb: phases.length > 0 ? phases[0].fileSizeMaxKb : fileSizeMaxKb,
      warmupFiles: scenario.warmupFiles,
      stopServer: scenario.stopServer ? stopServer : '',
      stopAfterSec: scenario.stopServer ? stopAfterSec : 0,
      waveIterations: phases.length > 0 ? waveIterations : undefined,
      phases: phases.length > 0 ? phases : undefined,
    });
  };

  const applyScenario = (id: string) => {
    const next = scenarioById(id);
    setScenarioId(next.id);
    setConcurrency(next.concurrency);
    setDuration(next.duration);
    setFileSizeMinKb(next.fileSizeMinKb);
    setFileSizeMaxKb(next.fileSizeMaxKb);
    setStopServer(next.stopServer);
    setStopAfterSec(next.stopAfterSec);
    setWaveIterations(next.waveIterations);
    setPhases(next.phases);
    setFormError(null);
  };

  const updatePhase = (index: number, patch: Partial<ScenarioPhase>) => {
    setPhases((current) => current.map((phase, phaseIndex) => (
      phaseIndex === index ? { ...phase, ...patch } : phase
    )));
  };

  const waveDuration = phases.reduce((total, phase) => total + phase.durationSec, 0);

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
          <h2>Сценарии обучения</h2>
          <p className="load-copy">
            Каждый сценарий вызывает загрузку, скачивание, удаление, сжатие, создание и чтение пользователя. Размер файла не превышает лимит сообщения сервера, {maxTestFileSizeKb} КБ. Один и тот же прогон стоит запустить с AM-PPO и с классическим алгоритмом.
          </p>
          <div className="load-scenarios">
            {trainingScenarios.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`load-scenario ${item.id === scenarioId ? 'load-scenario-active' : ''}`}
                onClick={() => applyScenario(item.id)}
                disabled={status.isRunning}
              >
                <strong>{item.name}</strong>
                <span>{item.summary}</span>
              </button>
            ))}
          </div>
          <p className="load-weakness">{scenario.weakness}</p>
          {phases.length > 0 ? (
            <>
              <div className="load-fields">
                <NumberField
                  id="waveIterations"
                  label="Повторы круга"
                  min={0}
                  value={waveIterations}
                  disabled={status.isRunning}
                  onChange={setWaveIterations}
                />
              </div>
              <p className="load-copy">
                Один круг длится {waveDuration} с. 0 повторов — круги без конца.
                {waveIterations > 0 ? ` Всего ${waveDuration * waveIterations} с.` : ' Тест идёт, пока не нажмёте Stop.'}
              </p>
              <div className="load-phases">
                {phases.map((phase, index) => (
                  <div className="load-phase" key={`${scenario.id}-${index}`}>
                    <h3>Волна {index + 1}</h3>
                    <NumberField
                      id={`phase-${index}-concurrency`}
                      label="Клиенты"
                      min={1}
                      value={phase.concurrency}
                      disabled={status.isRunning}
                      onChange={(value) => updatePhase(index, { concurrency: value })}
                    />
                    <NumberField
                      id={`phase-${index}-duration`}
                      label="Секунды"
                      min={5}
                      value={phase.durationSec}
                      disabled={status.isRunning}
                      onChange={(value) => updatePhase(index, { durationSec: value })}
                    />
                    <NumberField
                      id={`phase-${index}-min`}
                      label="Мин. размер, КБ"
                      min={1}
                      max={maxTestFileSizeKb}
                      value={phase.fileSizeMinKb}
                      disabled={status.isRunning}
                      onChange={(value) => updatePhase(index, { fileSizeMinKb: value })}
                    />
                    <NumberField
                      id={`phase-${index}-max`}
                      label="Макс. размер, КБ"
                      min={1}
                      max={maxTestFileSizeKb}
                      value={phase.fileSizeMaxKb}
                      disabled={status.isRunning}
                      onChange={(value) => updatePhase(index, { fileSizeMaxKb: value })}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="load-fields">
              <NumberField
                id="concurrency"
                label="Одновременные клиенты"
                min={1}
                value={concurrency}
                disabled={status.isRunning}
                onChange={setConcurrency}
              />
              <NumberField
                id="duration"
                label="Длительность, секунды"
                min={0}
                value={duration}
                disabled={status.isRunning}
                onChange={setDuration}
              />
              <NumberField
                id="fileSizeMinKb"
                label="Минимальный размер файла, КБ"
                min={1}
                max={maxTestFileSizeKb}
                value={fileSizeMinKb}
                disabled={status.isRunning}
                onChange={setFileSizeMinKb}
              />
              <NumberField
                id="fileSizeMaxKb"
                label="Максимальный размер файла, КБ"
                min={1}
                max={maxTestFileSizeKb}
                value={fileSizeMaxKb}
                disabled={status.isRunning}
                onChange={setFileSizeMaxKb}
              />
              {scenario.stopServer && (
                <>
                  <label className="load-field" htmlFor="stopServer">
                    Сервер, который остановить
                    <select
                      id="stopServer"
                      value={stopServer}
                      disabled={status.isRunning}
                      onChange={(event) => setStopServer(event.target.value)}
                    >
                      {servers.map((server) => (
                        <option key={server.name} value={server.name}>{server.name}</option>
                      ))}
                    </select>
                  </label>
                  <NumberField
                    id="stopAfterSec"
                    label="Остановить через, секунды"
                    min={5}
                    value={stopAfterSec}
                    disabled={status.isRunning}
                    onChange={setStopAfterSec}
                  />
                </>
              )}
            </div>
          )}
          {phases.length === 0 && (
            <p className="load-copy">0 секунд — тест идёт, пока не нажмёте Stop.</p>
          )}

          <div className="load-fields">
            <label className="load-field load-field-wide" htmlFor="algorithm">
              Алгоритм балансировки
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
              <span>Время</span>
              <strong>{formatElapsed(status)}</strong>
            </div>
            {(status.stats.waveCount || 0) > 0 && (
              <div>
                <span>Итерация волн</span>
                <strong>{formatWaveProgress(status.stats)}</strong>
              </div>
            )}
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
                <Metric label="p95, ms ↓" value={(status.stats.report.p95Millis ?? 0).toFixed(2)} />
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
                  <th>Power</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((server) => {
                  const running = server.running ?? server.status === 'up';
                  const pending = pendingServer === server.name;
                  return (
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
                    <td>
                      <Button
                        variant={running ? 'danger' : 'primary'}
                        disabled={pendingServer !== null}
                        onClick={() => setServerPower(server.name, running ? 'stop' : 'start')}
                      >
                        {pending ? (running ? 'Stopping...' : 'Starting...') : (running ? 'Turn off' : 'Turn on')}
                      </Button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="load-card">
          <h2>Графики серверов</h2>
          <p className="load-copy">
            На каждом графике своя линия для каждого сервера. Окно около трёх минут, с началом теста история очищается.
          </p>
          <ServerCharts history={serverHistory} />
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
        onChange={(event) => {
          const parsed = parseInt(event.target.value, 10);
          if (Number.isNaN(parsed) || parsed < min) {
            onChange(min);
            return;
          }
          onChange(max !== undefined && parsed > max ? max : parsed);
        }}
      />
    </label>
  );
}

function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest].map((part) => String(part).padStart(2, '0')).join(':');
}

function formatElapsed(status: { isRunning: boolean; stats: { elapsedSeconds?: number; durationSeconds?: number } }) {
  const elapsed = status.stats.elapsedSeconds || 0;
  const planned = status.stats.durationSeconds || 0;
  const clock = formatClock(elapsed);
  if (planned > 0) {
    return `${clock} / ${formatClock(planned)}`;
  }
  if (status.isRunning || elapsed > 0) {
    return `${clock} / ∞`;
  }
  return clock;
}

function formatWaveProgress(stats: { waveIteration?: number; waveIndex?: number; waveCount?: number; waveIterations?: number }) {
  const iteration = stats.waveIteration || 0;
  const limit = (stats.waveIterations || 0) > 0 ? String(stats.waveIterations) : '∞';
  return `${iteration} / ${limit} · волна ${stats.waveIndex || 0}/${stats.waveCount || 0}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="load-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
