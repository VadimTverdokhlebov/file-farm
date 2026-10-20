import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { AlgorithmComparison } from '../components/AlgorithmComparison';
import { SeriesServerCharts } from '../components/SeriesServerCharts';
import { ServerCharts } from '../components/ServerCharts';
import { liveOutageBands } from '../components/liveOutages';
import { ScenarioPhase, maxTestFileSizeKb, scenarioById, scenarioValues, trainingScenarios, trainingServerNames } from '../config/trainingScenarios';
import { useLoadTest } from '../hooks/useLoadTest';
import { SeriesStatus, TestMetrics } from '../types/loadTest';
import './LoadTestPage.css';

// Pause between two runs of a comparison; the load stand waits this long before the next algorithm.
const seriesCooldownSec = 45;
const comparisonScenario = trainingScenarios.find((item) => item.comparison) ?? trainingScenarios[0];

export const LoadTestPage = () => {
  const {
    endpoints,
    algorithms,
    selectedAlgorithm,
    setSelectedAlgorithm,
    status,
    serverHistory,
    startTest,
    startSeries,
    series,
    seriesResults,
    stopTest,
    setServerPower,
    pendingServer,
    error,
    isLoading,
  } = useLoadTest();
  const initialScenario = trainingScenarios[0];
  const [scenarioId, setScenarioId] = useState(initialScenario.id);
  // The first preset is on by default: its values are what a new page starts with.
  const [quickPresetId, setQuickPresetId] = useState<string | null>(initialScenario.quickPresets?.[0]?.id ?? null);
  const initialValues = scenarioValues(initialScenario, quickPresetId);
  const [concurrency, setConcurrency] = useState(initialValues.concurrency);
  const [duration, setDuration] = useState(initialValues.duration);
  const [fileSizeMinKb, setFileSizeMinKb] = useState(initialValues.fileSizeMinKb);
  const [fileSizeMaxKb, setFileSizeMaxKb] = useState(initialValues.fileSizeMaxKb);
  const [outageServers, setOutageServers] = useState<string[]>(initialScenario.outageServers);
  const [outageMinSec, setOutageMinSec] = useState(initialScenario.outageMinSec);
  const [outageMaxSec, setOutageMaxSec] = useState(initialScenario.outageMaxSec);
  const [waveIterations, setWaveIterations] = useState(initialScenario.waveIterations);
  const [phases, setPhases] = useState<ScenarioPhase[]>(initialScenario.phases);
  const [freezeModel, setFreezeModel] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Algorithms ticked for a comparison; until the first click every algorithm is in.
  const [comparedAlgorithms, setComparedAlgorithms] = useState<string[] | null>(null);
  // A frozen AM-PPO keeps the comparison fair: the model does not change between runs.
  const [compareFreeze, setCompareFreeze] = useState(true);
  const scenario = scenarioById(scenarioId);
  const seriesActive = series?.active ?? false;
  const busy = status.isRunning || seriesActive;
  const compareIds = (comparedAlgorithms ?? algorithms.map((algorithm) => algorithm.id))
    .filter((id) => algorithms.some((algorithm) => algorithm.id === id));
  // A preset with a schedule replaces the random outages.
  const activeOutages = scenarioValues(scenario, quickPresetId).outages;

  // After a reload in the middle of a series, show the page the series belongs to.
  const openedSeries = useRef(false);
  useEffect(() => {
    if (seriesActive && !openedSeries.current) {
      openedSeries.current = true;
      applyScenario(comparisonScenario.id);
    }
    // applyScenario only sets state, so the first sight of an active series is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesActive]);

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
    if (scenario.comparison && compareIds.length === 0) {
      setFormError('Отметьте хотя бы один алгоритм для сравнения.');
      return;
    }
    if (!scenario.comparison && !selectedAlgorithm) {
      setFormError('Выберите алгоритм балансировки.');
      return;
    }
    if (scenario.comparison && duration < 1) {
      setFormError('Для сравнения нужна длительность теста в секундах: 0 означает тест без конца.');
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
    const plannedDuration = phases.length > 0 ? (waveIterations === 0 ? 0 : waveDuration * waveIterations) : duration;
    if (phases.length > 0 && waveIterations < 0) {
      setFormError('Число повторов круга не может быть отрицательным. 0 означает без конца.');
      return;
    }
    const outagePlan = scenarioValues(scenario, quickPresetId).outages;
    if (outagePlan && plannedDuration > 0) {
      // The schedule is in seconds of the test, so a shorter run would never reach it.
      const unreachable = outagePlan.find((outage) => outage.stopAtSec >= plannedDuration);
      if (unreachable) {
        setFormError(`Длительность теста ${plannedDuration} с меньше времени остановки сервера по расписанию. Верните 600 секунд или снимите отметку.`);
        return;
      }
    }
    if (scenario.randomOutages && !outagePlan) {
      if (outageServers.length === 0) {
        setFormError('Отметьте хотя бы один сервер, который может остановиться.');
        return;
      }
      if (outageMinSec < 5 || outageMaxSec < outageMinSec || (plannedDuration > 0 && outageMinSec >= plannedDuration)) {
        setFormError('Диапазон остановки — от 5 секунд, максимум не меньше минимума и минимум меньше длительности теста.');
        return;
      }
    }

    setFormError(null);
    const config = {
      concurrency: phases.length > 0 ? phases[0].concurrency : concurrency,
      duration: plannedDuration,
      endpoints: scenario.endpoints,
      algorithm: selectedAlgorithm,
      freezeModel: selectedAlgorithm === 'am_ppo' ? freezeModel : false,
      preset: scenario.id,
      fileSizeMinKb: phases.length > 0 ? phases[0].fileSizeMinKb : fileSizeMinKb,
      fileSizeMaxKb: phases.length > 0 ? phases[0].fileSizeMaxKb : fileSizeMaxKb,
      warmupFiles: scenario.warmupFiles,
      outageServers: scenario.randomOutages && !outagePlan ? outageServers : undefined,
      outageMinSec: scenario.randomOutages && !outagePlan ? outageMinSec : undefined,
      outageMaxSec: scenario.randomOutages && !outagePlan ? outageMaxSec : undefined,
      outagePlan,
      waveIterations: phases.length > 0 ? waveIterations : undefined,
      phases: phases.length > 0 ? phases : undefined,
    };
    if (scenario.comparison) {
      startSeries({
        ...config,
        algorithm: '',
        algorithms: compareIds,
        freezeModel: compareFreeze,
        cooldownSec: seriesCooldownSec,
      });
      return;
    }
    startTest(config);
  };

  const applyValues = (values: ReturnType<typeof scenarioValues>) => {
    setConcurrency(values.concurrency);
    setDuration(values.duration);
    setFileSizeMinKb(values.fileSizeMinKb);
    setFileSizeMaxKb(values.fileSizeMaxKb);
  };

  // Checking one preset unchecks the other; unchecking returns the scenario defaults.
  const toggleQuickPreset = (id: string, enabled: boolean) => {
    const nextId = enabled ? id : null;
    setQuickPresetId(nextId);
    applyValues(scenarioValues(scenario, nextId));
    setFormError(null);
  };

  const applyScenario = (id: string) => {
    const next = scenarioById(id);
    // Like on first load, the first preset of a scenario is on by default.
    const nextPresetId = next.quickPresets?.[0]?.id ?? null;
    setScenarioId(next.id);
    setQuickPresetId(nextPresetId);
    applyValues(scenarioValues(next, nextPresetId));
    setOutageServers(next.outageServers);
    setOutageMinSec(next.outageMinSec);
    setOutageMaxSec(next.outageMaxSec);
    setWaveIterations(next.waveIterations);
    setPhases(next.phases);
    setFormError(null);
  };

  const toggleComparedAlgorithm = (id: string) => {
    setComparedAlgorithms(compareIds.includes(id) ? compareIds.filter((item) => item !== id) : [...compareIds, id]);
  };

  const toggleOutageServer = (name: string) => {
    setOutageServers((current) => (
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name]
    ));
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
                disabled={busy}
              >
                <strong>{item.name}</strong>
                <span>{item.summary}</span>
              </button>
            ))}
          </div>
          {scenario.quickPresets ? (
            <div className="load-weakness" title={scenario.weakness}>
              {scenario.quickPresets.map((item) => (
                <label className="load-check" htmlFor={item.id} key={item.id}>
                  <input
                    id={item.id}
                    type="checkbox"
                    checked={quickPresetId === item.id}
                    disabled={busy}
                    onChange={(event) => toggleQuickPreset(item.id, event.target.checked)}
                  />
                  {item.label}
                </label>
              ))}
            </div>
          ) : (
            <p className="load-weakness">{scenario.weakness}</p>
          )}
          {phases.length > 0 ? (
            <>
              <div className="load-fields">
                <NumberField
                  id="waveIterations"
                  label="Повторы круга"
                  min={0}
                  value={waveIterations}
                  disabled={busy}
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
                    <h3>{phase.name ?? `Волна ${index + 1}`}</h3>
                    <NumberField
                      id={`phase-${index}-concurrency`}
                      label="Клиенты"
                      min={1}
                      value={phase.concurrency}
                      disabled={busy}
                      onChange={(value) => updatePhase(index, { concurrency: value })}
                    />
                    <NumberField
                      id={`phase-${index}-duration`}
                      label="Секунды"
                      min={5}
                      value={phase.durationSec}
                      disabled={busy}
                      onChange={(value) => updatePhase(index, { durationSec: value })}
                    />
                    <NumberField
                      id={`phase-${index}-min`}
                      label="Мин. размер, КБ"
                      min={1}
                      max={maxTestFileSizeKb}
                      value={phase.fileSizeMinKb}
                      disabled={busy}
                      onChange={(value) => updatePhase(index, { fileSizeMinKb: value })}
                    />
                    <NumberField
                      id={`phase-${index}-max`}
                      label="Макс. размер, КБ"
                      min={1}
                      max={maxTestFileSizeKb}
                      value={phase.fileSizeMaxKb}
                      disabled={busy}
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
                disabled={busy}
                onChange={setConcurrency}
              />
              <NumberField
                id="duration"
                label="Длительность, секунды"
                min={0}
                value={duration}
                disabled={busy}
                onChange={setDuration}
              />
              <NumberField
                id="fileSizeMinKb"
                label="Минимальный размер файла, КБ"
                min={1}
                max={maxTestFileSizeKb}
                value={fileSizeMinKb}
                disabled={busy}
                onChange={setFileSizeMinKb}
              />
              <NumberField
                id="fileSizeMaxKb"
                label="Максимальный размер файла, КБ"
                min={1}
                max={maxTestFileSizeKb}
                value={fileSizeMaxKb}
                disabled={busy}
                onChange={setFileSizeMaxKb}
              />
            </div>
          )}
          {scenario.randomOutages && !activeOutages && (
            <OutageFields
              servers={outageServers}
              minSec={outageMinSec}
              maxSec={outageMaxSec}
              disabled={busy}
              onToggle={toggleOutageServer}
              onMinChange={setOutageMinSec}
              onMaxChange={setOutageMaxSec}
            />
          )}
          {phases.length === 0 && (
            <p className="load-copy">0 секунд — тест идёт, пока не нажмёте Stop.</p>
          )}

          {scenario.comparison ? (
            <>
              <div className="load-fields">
                <fieldset className="load-field load-field-wide" disabled={busy || isLoading}>
                  <legend>Алгоритмы для сравнения</legend>
                  <div className="load-checks">
                    {algorithms.map((algorithm) => (
                      <label className="load-check" key={algorithm.id}>
                        <input
                          type="checkbox"
                          checked={compareIds.includes(algorithm.id)}
                          onChange={() => toggleComparedAlgorithm(algorithm.id)}
                        />
                        {algorithm.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {compareIds.includes('am_ppo') && (
                  <label className="load-check load-field-wide" htmlFor="compareFreeze">
                    <input
                      id="compareFreeze"
                      type="checkbox"
                      checked={compareFreeze}
                      disabled={busy}
                      onChange={(event) => setCompareFreeze(event.target.checked)}
                    />
                    Не обучать модель AM-PPO во время сравнения
                  </label>
                )}
              </div>
              <p className="load-copy">
                Алгоритмы идут по очереди, между прогонами пауза {seriesCooldownSec} секунд и проверка, что все серверы
                работают. {compareIds.length > 0 && duration > 0
                  ? `Всего примерно ${formatSeriesEstimate(compareIds.length, duration)}.`
                  : ''}
              </p>
            </>
          ) : (
            <>
              <div className="load-fields">
                <label className="load-field load-field-wide" htmlFor="algorithm">
                  Алгоритм балансировки
                  <select
                    id="algorithm"
                    value={selectedAlgorithm}
                    onChange={(event) => setSelectedAlgorithm(event.target.value)}
                    disabled={busy || isLoading}
                  >
                    {algorithms.map((algorithm) => (
                      <option key={algorithm.id} value={algorithm.id}>{algorithm.name}</option>
                    ))}
                  </select>
                </label>
                {selectedAlgorithm === 'am_ppo' && (
                  <label className="load-check load-field-wide" htmlFor="freezeModel">
                    <input
                      id="freezeModel"
                      type="checkbox"
                      checked={freezeModel}
                      disabled={busy}
                      onChange={(event) => setFreezeModel(event.target.checked)}
                    />
                    Не обучать модель во время теста
                  </label>
                )}
              </div>
              {selectedAlgorithm === 'am_ppo' && freezeModel && (
                <p className="load-copy">
                  Модель только балансирует: без шума исследования, без накопления переходов и обновления весов.
                </p>
              )}
            </>
          )}

          <div className="load-actions">
            <Button onClick={handleStart} disabled={busy}>
              {busy ? 'Running...' : 'Start'}
            </Button>
            <Button variant="danger" onClick={stopTest} disabled={!busy}>
              Stop
            </Button>
          </div>
          {formError && <p className="load-notice load-notice-error">{formError}</p>}
        </section>

        <section className="load-card">
          <div className="load-card-title">
            <h2>Live status</h2>
            <span className={`load-pill ${busy ? 'load-pill-up' : 'load-pill-idle'}`}>
              {busy ? 'Running' : 'Stopped'}
            </span>
          </div>
          {error && <p className="load-notice load-notice-error">{error}</p>}
          {scenario.comparison && series?.message && (
            <p className="load-notice load-notice-error">{series.message}</p>
          )}
          <div className="load-stats">
            {scenario.comparison && series && (
              <>
                <div>
                  <span>Алгоритм</span>
                  <strong>{currentAlgorithmName(series, algorithms)}</strong>
                </div>
                <div>
                  <span>Прогон</span>
                  <strong>{series.current + 1} / {series.runs.length}</strong>
                </div>
                <div>
                  <span>Этап</span>
                  <strong>{seriesPhaseLabel(series)}</strong>
                </div>
              </>
            )}
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

          {scenario.comparison ? (
            // A finished run keeps its report, so each algorithm adds a block below the previous ones.
            comparisonReports(series, algorithms, status.stats.report).map((item) => (
              <ReportBlock key={item.key} title={`Test report · ${item.name}`} report={item.report} />
            ))
          ) : (
            status.stats.report && <ReportBlock title="Test report" report={status.stats.report} />
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
            На каждом графике своя линия для каждого сервера. Интервал один для всех графиков, с началом теста история очищается.
            {scenario.comparison ? ' Можно открыть сохранённые данные одного из прошедших алгоритмов.' : ''}
          </p>
          {scenario.comparison ? (
            <SeriesServerCharts series={series} algorithms={algorithms} liveHistory={serverHistory} />
          ) : (
            <ServerCharts history={serverHistory} outages={liveOutageBands(serverHistory)} />
          )}
        </section>

        {scenario.comparison && (
          <section className="load-card">
            <h2>Графики сравнения алгоритмов</h2>
            <p className="load-copy">
              Каждый алгоритм — своя линия на общих графиках. Кнопки включают и выключают уже прошедшие алгоритмы,
              линия идущего прогона растёт по мере теста. Данные хранит стенд нагрузки, после обновления страницы они остаются.
            </p>
            <AlgorithmComparison series={seriesResults} algorithms={algorithms} />
          </section>
        )}

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

function OutageFields({
  servers,
  minSec,
  maxSec,
  disabled,
  onToggle,
  onMinChange,
  onMaxChange,
}: {
  servers: string[];
  minSec: number;
  maxSec: number;
  disabled: boolean;
  onToggle: (name: string) => void;
  onMinChange: (value: number) => void;
  onMaxChange: (value: number) => void;
}) {
  return (
    <>
      <p className="load-copy">
        Случайный отмеченный сервер останавливается, затем через случайное время из диапазона запускается снова.
        Следующая остановка ждёт новое случайное время из того же диапазона. Если отмечено несколько серверов, последний работающий не выключается.
        В конце теста остановленный сервер запускается.
      </p>
      <div className="load-fields">
        <NumberField
          id="outageMinSec"
          label="Пауза от, секунды"
          min={5}
          value={minSec}
          disabled={disabled}
          onChange={onMinChange}
        />
        <NumberField
          id="outageMaxSec"
          label="Пауза до, секунды"
          min={5}
          value={maxSec}
          disabled={disabled}
          onChange={onMaxChange}
        />
        <fieldset className="load-field load-field-wide" disabled={disabled}>
          <legend>Серверы, которые могут упасть</legend>
          <div className="load-checks">
            {trainingServerNames.map((name) => (
              <label className="load-check" key={name}>
                <input
                  type="checkbox"
                  checked={servers.includes(name)}
                  onChange={() => onToggle(name)}
                />
                {name}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </>
  );
}

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

function currentAlgorithmName(series: SeriesStatus, algorithms: { id: string; name: string }[]) {
  const id = series.runs[series.current]?.algorithm ?? '';
  return algorithms.find((algorithm) => algorithm.id === id)?.name ?? (id || '—');
}

function seriesPhaseLabel(series: SeriesStatus) {
  switch (series.phase) {
    case 'preparing':
      return 'Подготовка';
    case 'running':
      return 'Идёт тест';
    case 'cooldown':
      return `Пауза ${series.cooldownLeftSec} с`;
    case 'finished':
      return 'Серия завершена';
    case 'stopped':
      return 'Серия остановлена';
    default:
      return 'Ошибка серии';
  }
}

// Runs plus the pauses between them, rounded to minutes; warm-up adds a few seconds per run.
function formatSeriesEstimate(runs: number, durationSec: number) {
  const warmupSec = 10;
  const totalSec = runs * (durationSec + warmupSec) + (runs - 1) * seriesCooldownSec;
  const minutes = Math.round(totalSec / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин` : `${minutes} мин`;
}

// Reports of the runs of a series in the order they ran: finished runs from the series
// itself, the run in progress from the live status.
function comparisonReports(
  series: SeriesStatus | null,
  algorithms: { id: string; name: string }[],
  liveReport: TestMetrics | null | undefined,
) {
  if (!series) {
    return [];
  }
  const items: { key: string; name: string; report: TestMetrics }[] = [];
  series.runs.forEach((run, index) => {
    const name = algorithms.find((algorithm) => algorithm.id === run.algorithm)?.name ?? run.algorithm;
    const live = index === series.current && run.state === 'running' ? liveReport : null;
    const report = run.report ?? live;
    if (report) {
      items.push({ key: run.algorithm, name, report });
    }
  });
  return items;
}

function ReportBlock({ title, report }: { title: string; report: TestMetrics }) {
  return (
    <div className="load-report">
      <h3>{title}</h3>
      <div className="load-report-grid">
        <Metric label="RPS ↑" value={report.rps.toFixed(2)} />
        <Metric label="p50, ms ↓" value={report.p50Millis.toFixed(2)} />
        <Metric label="p95, ms ↓" value={(report.p95Millis ?? 0).toFixed(2)} />
        <Metric label="p99, ms ↓" value={report.p99Millis.toFixed(2)} />
        <Metric label="Errors, % ↓" value={`${report.errorRatePercent.toFixed(2)}%`} />
        <Metric
          label="CPU fairness ↑"
          value={report.cpuFairnessAvailable ? report.cpuFairnessIndex.toFixed(3) : 'N/A'}
        />
      </div>
    </div>
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
