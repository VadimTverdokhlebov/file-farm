import { Fragment, useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { AlgorithmComparison } from '../components/AlgorithmComparison';
import { SaveChartsButton } from '../components/SaveChartsButton';
import { SeriesServerCharts } from '../components/SeriesServerCharts';
import {
  ScheduledOutage,
  algorithmShortName,
  maxTestFileSizeKb,
  testEndpoints,
  testPresets,
  testWarmupFiles,
  trainingServerNames,
} from '../config/loadTestConfig';
import { useLoadTest } from '../hooks/useLoadTest';
import { SeriesStatus, TestMetrics } from '../types/loadTest';
import './LoadTestPage.css';

// Values of a page without a preset.
// The algorithm a new page starts with.
const defaultAlgorithmId = 'am_ppo';

const defaultValues = {
  concurrency: 28,
  duration: 180,
  fileSizeMinKb: 512,
  fileSizeMaxKb: 512,
};

export const LoadTestPage = () => {
  const {
    endpoints,
    algorithms,
    status,
    serverHistory,
    startSeries,
    clearResults,
    restartRun,
    series,
    seriesResults,
    stopTest,
    setServerPower,
    manualOutages,
    pendingServer,
    error,
    isLoading,
  } = useLoadTest();
  // No preset is on by default: a new page starts with the default values and no outages.
  const [presetId, setPresetId] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState(defaultValues.concurrency);
  const [duration, setDuration] = useState(defaultValues.duration);
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('min');
  const [fileSizeMinKb, setFileSizeMinKb] = useState(defaultValues.fileSizeMinKb);
  const [fileSizeMaxKb, setFileSizeMaxKb] = useState(defaultValues.fileSizeMaxKb);
  const [fileSizeUnit, setFileSizeUnit] = useState<FileSizeUnit>('KB');
  const [outageUnit, setOutageUnit] = useState<DurationUnit>('min');
  const [outages, setOutages] = useState<ScheduledOutage[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  // Algorithms of the test, one select per row; until the first change only AM-PPO is in.
  const [comparedAlgorithms, setComparedAlgorithms] = useState<string[] | null>(null);
  // A frozen AM-PPO keeps the comparison fair: the model does not change between runs.
  const [compareFreeze, setCompareFreeze] = useState(true);
  const seriesActive = series?.active ?? false;
  const busy = status.isRunning || seriesActive;
  const compareIds = (comparedAlgorithms ?? [defaultAlgorithmId])
    .filter((id) => algorithms.some((algorithm) => algorithm.id === id));
  const unusedAlgorithms = algorithms.filter((algorithm) => !compareIds.includes(algorithm.id));
  const serverChartsRef = useRef<HTMLElement>(null);
  const comparisonChartsRef = useRef<HTMLElement>(null);

  // After a reload in the middle of a series, the form shows what the series was started with.
  const restoredSeries = useRef(false);
  useEffect(() => {
    if (!seriesActive || !series || restoredSeries.current) {
      return;
    }
    restoredSeries.current = true;
    setPresetId(null);
    setDuration(series.durationSec);
    setOutages(series.outages ?? []);
    setComparedAlgorithms(series.runs.map((run) => run.algorithm));
    setCompareFreeze(series.freezeModel);
    // Only the first sight of an active series matters; later updates must not overwrite edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesActive]);

  const handleStart = () => {
    const problem = formProblem({
      hasEndpoints: endpoints.length > 0,
      compareIds,
      concurrency,
      duration,
      fileSizeMinKb,
      fileSizeMaxKb,
      outages,
    });
    if (problem) {
      setFormError(problem);
      return;
    }

    setFormError(null);
    startSeries({
      concurrency,
      duration,
      endpoints: testEndpoints,
      algorithm: '',
      algorithms: compareIds,
      freezeModel: compareFreeze,
      preset: presetId ?? 'custom',
      fileSizeMinKb,
      fileSizeMaxKb,
      warmupFiles: testWarmupFiles,
      outagePlan: outages.length > 0 ? outages : undefined,
    });
  };

  // Checking one preset unchecks the other; unchecking returns the default values without outages.
  const togglePreset = (id: string, enabled: boolean) => {
    const preset = enabled ? testPresets.find((item) => item.id === id) : undefined;
    const values = preset ?? defaultValues;
    setPresetId(preset?.id ?? null);
    setConcurrency(values.concurrency);
    setDuration(values.duration);
    setFileSizeMinKb(values.fileSizeMinKb);
    setFileSizeMaxKb(values.fileSizeMaxKb);
    setOutages(preset ? preset.outages.map((outage) => ({ ...outage })) : []);
    setFormError(null);
  };

  const addAlgorithm = () => {
    if (unusedAlgorithms.length > 0) {
      setComparedAlgorithms([...compareIds, unusedAlgorithms[0].id]);
    }
  };

  const changeAlgorithm = (index: number, id: string) => {
    setComparedAlgorithms(compareIds.map((item, position) => (position === index ? id : item)));
  };

  const removeAlgorithm = (index: number) => {
    setComparedAlgorithms(compareIds.filter((_, position) => position !== index));
  };

  const updateOutage = (index: number, patch: Partial<ScheduledOutage>) => {
    setOutages((current) => current.map((outage, position) => (
      position === index ? { ...outage, ...patch } : outage
    )));
  };

  const addOutage = () => {
    // A free server first, so a new row does not repeat the server of the previous one.
    const free = trainingServerNames.find((name) => !outages.some((outage) => outage.server === name));
    setOutages((current) => current.concat({
      server: free ?? trainingServerNames[0],
      stopAtSec: 60,
      startAtSec: 120,
    }));
  };

  const removeOutage = (index: number) => {
    setOutages((current) => current.filter((_, position) => position !== index));
  };

  const servers = status.stats.Servers ?? [];
  const endpointEntries = Object.entries(status.stats.endpointStats ?? {});

  return (
    <div className="load-page">
      <div className="load-shell">
        <header className="load-header">
          <div>
            <h1>Load panel</h1>
          </div>
          <Link className="load-nav" to="/">Files</Link>
        </header>

        <section className="load-card">
          <h2>Presets</h2>
          <div className="load-weakness">
            {testPresets.map((item) => (
              <label className="load-check" htmlFor={item.id} key={item.id}>
                <input
                  id={item.id}
                  type="checkbox"
                  checked={presetId === item.id}
                  disabled={busy}
                  onChange={(event) => togglePreset(item.id, event.target.checked)}
                />
                {item.label}
              </label>
            ))}
          </div>

          <h3 className="load-subtitle">Load</h3>
          <div className="load-fields load-unit-fields">
            <NumberField
              id="concurrency"
              label="Concurrent clients"
              integer
              min={1}
              value={concurrency}
              disabled={busy}
              onChange={setConcurrency}
            />
            <NumberField
              id="duration"
              label="Duration"
              min={0}
              value={fromSeconds(duration, durationUnit)}
              disabled={busy}
              onChange={(value) => setDuration(toSeconds(value, durationUnit))}
            />
            <SelectField
              label="Duration unit"
              hideLabel
              className="load-unit-select"
              value={durationUnit}
              disabled={busy}
              options={DURATION_UNITS}
              onChange={setDurationUnit}
            />
            <NumberField
              id="fileSizeMinKb"
              label="Min file size"
              min={fromKb(1, fileSizeUnit)}
              max={fromKb(maxTestFileSizeKb, fileSizeUnit)}
              value={fromKb(fileSizeMinKb, fileSizeUnit)}
              disabled={busy}
              onChange={(value) => setFileSizeMinKb(toKb(value, fileSizeUnit))}
            />
            <NumberField
              id="fileSizeMaxKb"
              label="Max file size"
              min={fromKb(1, fileSizeUnit)}
              max={fromKb(maxTestFileSizeKb, fileSizeUnit)}
              value={fromKb(fileSizeMaxKb, fileSizeUnit)}
              disabled={busy}
              onChange={(value) => setFileSizeMaxKb(toKb(value, fileSizeUnit))}
            />
            <SelectField
              label="File size unit"
              hideLabel
              className="load-unit-select"
              value={fileSizeUnit}
              disabled={busy}
              options={FILE_SIZE_UNITS}
              onChange={setFileSizeUnit}
            />
          </div>

          <h3 className="load-subtitle">Server outages</h3>
          <div className="load-fields load-outage-fields">
            {outages.map((outage, index) => (
              <Fragment key={index}>
                <SelectField
                  id={`outage-${index}-server`}
                  label="Server"
                  hideLabel={index > 0}
                  value={outage.server}
                  disabled={busy}
                  options={trainingServerNames.map((name) => ({ id: name, label: serverLabel(name) }))}
                  onChange={(server) => updateOutage(index, { server })}
                />
                <NumberField
                  id={`outage-${index}-stop`}
                  label="Stop at"
                  hideLabel={index > 0}
                  min={0}
                  value={fromSeconds(outage.stopAtSec, outageUnit)}
                  disabled={busy}
                  onChange={(value) => updateOutage(index, { stopAtSec: toSeconds(value, outageUnit) })}
                />
                <NumberField
                  id={`outage-${index}-start`}
                  label="Start at"
                  hideLabel={index > 0}
                  min={0}
                  value={fromSeconds(outage.startAtSec, outageUnit)}
                  disabled={busy}
                  onChange={(value) => updateOutage(index, { startAtSec: toSeconds(value, outageUnit) })}
                />
                {index === 0 ? (
                  <SelectField
                    label="Outage unit"
                    hideLabel
                    className="load-unit-select"
                    value={outageUnit}
                    disabled={busy}
                    options={DURATION_UNITS}
                    onChange={setOutageUnit}
                  />
                ) : (
                  <div />
                )}
                <Button variant="secondary" disabled={busy} onClick={() => removeOutage(index)}>
                  Remove
                </Button>
              </Fragment>
            ))}
          </div>
          <div className="load-actions">
            <Button variant="secondary" disabled={busy || outages.length >= trainingServerNames.length * 2} onClick={addOutage}>
              Add outage
            </Button>
          </div>

          <h3 className="load-subtitle">Algorithms</h3>
          <div className="load-fields load-algorithm-fields">
            {compareIds.map((id, index) => (
              <Fragment key={id}>
                <SelectField
                  id={`algorithm-${index}`}
                  label="Algorithm"
                  hideLabel
                  value={id}
                  disabled={busy || isLoading}
                  options={algorithms
                    .filter((algorithm) => algorithm.id === id || !compareIds.includes(algorithm.id))
                    .map((algorithm) => ({ id: algorithm.id, label: algorithmShortName(algorithm.id, algorithm.name) }))}
                  onChange={(next) => changeAlgorithm(index, next)}
                />
                <Button
                  variant="secondary"
                  disabled={!canRestartRun(series, id)}
                  onClick={() => {
                    const runIndex = seriesRunIndex(series, id);
                    if (runIndex >= 0) {
                      restartRun(runIndex);
                    }
                  }}
                >
                  Restart
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || compareIds.length <= 1}
                  onClick={() => removeAlgorithm(index)}
                >
                  Remove
                </Button>
              </Fragment>
            ))}
          </div>
          <div className="load-actions">
            <Button variant="secondary" disabled={busy || isLoading || unusedAlgorithms.length === 0} onClick={addAlgorithm}>
              Add algorithm
            </Button>
          </div>
          {compareIds.includes('am_ppo') && (
            <label className="load-check" htmlFor="compareFreeze">
              <input
                id="compareFreeze"
                type="checkbox"
                checked={!compareFreeze}
                disabled={busy}
                onChange={(event) => setCompareFreeze(!event.target.checked)}
              />
              Learning
            </label>
          )}

          <div className="load-actions">
            <div className="load-actions-group">
              <Button onClick={handleStart} disabled={busy}>
                {busy ? 'Running...' : 'Start'}
              </Button>
              <Button variant="danger" onClick={stopTest} disabled={!busy}>
                Stop
              </Button>
            </div>
            <Button variant="secondary" onClick={clearResults} disabled={busy}>
              Refresh
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
          {series?.message && (
            <p className="load-notice load-notice-error">{series.message}</p>
          )}
          <div className="load-stats">
            {series && (
              <>
                <Stat label="Algorithm" value={currentAlgorithmName(series, algorithms)} />
                <Stat label="Run" value={`${series.current + 1} / ${series.runs.length}`} />
              </>
            )}
            <Stat label="Time" value={formatClock(series?.elapsedSec ?? 0)} />
            <Stat label="Successful requests" value={status.stats.successfulRequests || 0} />
            <Stat label="Failed requests" value={status.stats.failedRequests || 0} />
          </div>
        </section>

        <section className="load-card">
          <h2>Test report</h2>
          <ReportTable rows={reportRows(series, algorithms, status.stats.report)} />
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
                    <td>{serverLabel(server.name)}</td>
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

        <section className="load-card" ref={serverChartsRef}>
          <div className="load-card-title">
            <h2>Server charts</h2>
            <SaveChartsButton cardRef={serverChartsRef} kind="Server" />
          </div>
          <SeriesServerCharts
            series={series ?? seriesResults}
            algorithms={algorithms}
            liveHistory={serverHistory}
            manualOutages={manualOutages}
          />
        </section>

        <section className="load-card" ref={comparisonChartsRef}>
          <div className="load-card-title">
            <h2>Algorithm comparison charts</h2>
            <SaveChartsButton cardRef={comparisonChartsRef} kind="Algorithm" />
          </div>
          <AlgorithmComparison
            series={seriesResults}
            algorithms={algorithms}
            extraOutages={manualOutages}
            liveReport={status.stats.report}
          />
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

type DurationUnit = 's' | 'min';
type FileSizeUnit = 'KB' | 'MB';
type UnitOption<T extends string> = { id: T; label: string };

const DURATION_UNITS: UnitOption<DurationUnit>[] = [
  { id: 's', label: 'sec' },
  { id: 'min', label: 'min' },
];
const FILE_SIZE_UNITS: UnitOption<FileSizeUnit>[] = [
  { id: 'KB', label: 'KB' },
  { id: 'MB', label: 'MB' },
];
const DURATION_SECONDS: Record<DurationUnit, number> = { s: 1, min: 60 };

function fromSeconds(seconds: number, unit: DurationUnit): number {
  return prettyDiv(seconds, DURATION_SECONDS[unit]);
}

function toSeconds(value: number, unit: DurationUnit): number {
  return Math.max(0, Math.round(value * DURATION_SECONDS[unit]));
}

function fromKb(kb: number, unit: FileSizeUnit): number {
  return unit === 'KB' ? kb : prettyDiv(kb, 1024);
}

function toKb(value: number, unit: FileSizeUnit): number {
  const kb = unit === 'KB' ? value : value * 1024;
  return Math.max(1, Math.round(kb));
}

function prettyDiv(value: number, divisor: number): number {
  return Number((value / divisor).toFixed(4));
}

function clampNumber(raw: string, min: number, max: number | undefined, integer: boolean): number {
  const parsed = integer ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(parsed) || parsed < min) {
    return min;
  }
  return max !== undefined && parsed > max ? max : parsed;
}

function NumberField({
  id,
  label,
  hideLabel,
  integer,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hideLabel?: boolean;
  integer?: boolean;
  value: number;
  min: number;
  max?: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="load-field" htmlFor={id}>
      {hideLabel ? null : label}
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={integer ? 1 : 'any'}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(clampNumber(event.target.value, min, max, integer === true))}
      />
    </label>
  );
}

function SelectField<T extends string>({
  id,
  label,
  hideLabel,
  className,
  value,
  disabled,
  options,
  onChange,
}: {
  id?: string;
  label: string;
  hideLabel?: boolean;
  className?: string;
  value: T;
  disabled: boolean;
  options: UnitOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="load-field" htmlFor={id}>
      {hideLabel ? null : label}
      <select
        id={id}
        className={className}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formProblem({
  hasEndpoints,
  compareIds,
  concurrency,
  duration,
  fileSizeMinKb,
  fileSizeMaxKb,
  outages,
}: {
  hasEndpoints: boolean;
  compareIds: string[];
  concurrency: number;
  duration: number;
  fileSizeMinKb: number;
  fileSizeMaxKb: number;
  outages: ScheduledOutage[];
}): string | null {
  if (!hasEndpoints) {
    return 'No methods available. Check that the load stand is running.';
  }
  if (compareIds.length === 0) {
    return 'Select at least one algorithm.';
  }
  if (concurrency < 1) {
    return 'At least one client is required.';
  }
  if (duration < 0) {
    return 'Duration cannot be negative. 0 means no time limit.';
  }
  if (duration === 0 && compareIds.length !== 1) {
    return 'A test without a time limit (0) takes one algorithm only: algorithms take turns by time.';
  }
  if (fileSizeMinKb < 1 || fileSizeMaxKb < fileSizeMinKb || fileSizeMaxKb > maxTestFileSizeKb) {
    return `File size must be 1 to ${maxTestFileSizeKb} KB, the minimum cannot exceed the maximum.`;
  }
  return outageProblem(outages, duration);
}

// What is wrong with the schedule of outages, or null when it can run. The load stand checks
// the same rules, so a mistake is found here before the first algorithm starts.
function outageProblem(outages: ScheduledOutage[], durationSec: number): string | null {
  for (const [index, outage] of outages.entries()) {
    const row = `Outage ${index + 1}`;
    if (outage.stopAtSec < 5) {
      return `${row}: a server can be stopped no earlier than second 5.`;
    }
    if (outage.startAtSec <= outage.stopAtSec) {
      return `${row}: the start must come after the stop.`;
    }
    // Zero is a test without an end, so any moment is inside it.
    if (durationSec > 0 && outage.stopAtSec >= durationSec) {
      return `${row}: the server stops at second ${outage.stopAtSec}, but the test lasts ${durationSec} s.`;
    }
    for (const other of outages.slice(0, index)) {
      if (other.server === outage.server && outage.stopAtSec < other.startAtSec && other.stopAtSec < outage.startAtSec) {
        return `${row}: ${serverLabel(outage.server)} is already stopped at that time by another row.`;
      }
    }
  }
  // The cluster must keep at least one server: look at the moment each server is switched off.
  for (const outage of outages) {
    const down = new Set(
      outages
        .filter((other) => other.stopAtSec <= outage.stopAtSec && outage.stopAtSec < other.startAtSec)
        .map((other) => other.server),
    );
    if (down.size >= trainingServerNames.length) {
      return `All servers would be down at second ${outage.stopAtSec}. Keep at least one running.`;
    }
  }
  return null;
}

function serverLabel(name: string): string {
  const number = name.replace(/\D+/g, '');
  return number ? `Server ${number}` : name;
}

function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest].map((part) => String(part).padStart(2, '0')).join(':');
}

function seriesRunIndex(series: SeriesStatus | null, algorithmId: string): number {
  return series?.runs.findIndex((run) => run.algorithm === algorithmId) ?? -1;
}

function canRestartRun(series: SeriesStatus | null, algorithmId: string): boolean {
  const index = seriesRunIndex(series, algorithmId);
  const run = index >= 0 ? series?.runs[index] : undefined;
  if (!series || !run) {
    return false;
  }
  if (series.active) {
    return series.current === index && run.state === 'running';
  }
  return run.state === 'done' || run.state === 'stopped' || run.state === 'failed';
}

function currentAlgorithmName(series: SeriesStatus, algorithms: { id: string; name: string }[]) {
  const id = series.runs[series.current]?.algorithm ?? '';
  const name = algorithms.find((algorithm) => algorithm.id === id)?.name;
  return algorithmShortName(id, name) || '—';
}

type ReportRow = { key: string; name: string; running: boolean; report: TestMetrics };

// Rows of the report in the order the runs went: finished runs from the series itself,
// the run in progress from the live status. Every run adds a row below the previous ones.
function reportRows(
  series: SeriesStatus | null,
  algorithms: { id: string; name: string }[],
  liveReport: TestMetrics | null | undefined,
): ReportRow[] {
  if (!series) {
    return [];
  }
  const rows: ReportRow[] = [];
  series.runs.forEach((run, index) => {
    const name = algorithmShortName(
      run.algorithm,
      algorithms.find((algorithm) => algorithm.id === run.algorithm)?.name,
    );
    const live = index === series.current && run.state === 'running' ? liveReport : null;
    const report = run.report ?? live;
    if (report) {
      rows.push({ key: run.algorithm, name, running: !run.report, report });
    }
  });
  return rows;
}

// The report columns: the figure of a run, and whether a higher value is the better one.
const reportColumns: { label: string; pick: (report: TestMetrics) => number | null; higher: boolean; text: (value: number) => string }[] = [
  { label: 'RPS ↑', pick: (report) => report.rps, higher: true, text: (value) => value.toFixed(2) },
  { label: 'p50, ms ↓', pick: (report) => report.p50Millis, higher: false, text: (value) => value.toFixed(2) },
  { label: 'p95, ms ↓', pick: (report) => report.p95Millis ?? 0, higher: false, text: (value) => value.toFixed(2) },
  { label: 'p99, ms ↓', pick: (report) => report.p99Millis, higher: false, text: (value) => value.toFixed(2) },
  {
    label: 'CPU MAD, % ↓',
    pick: (report) => (report.cpuMadMeanAvailable ? report.cpuMadMeanPercent ?? 0 : null),
    higher: false,
    text: (value) => value.toFixed(2),
  },
  { label: 'Errors, % ↓', pick: (report) => report.errorRatePercent, higher: false, text: (value) => value.toFixed(2) },
];

function ReportTable({ rows }: { rows: ReportRow[] }) {
  if (rows.length === 0) {
    return <p className="load-empty">The report appears when the first algorithm finishes.</p>;
  }
  // The best value of a column among the finished runs; the numbers of a run in progress are still moving.
  const finished = rows.filter((row) => !row.running);
  const best = (column: (typeof reportColumns)[number]) => {
    const values = finished.map((row) => column.pick(row.report)).filter((value): value is number => value !== null);
    if (finished.length < 2 || values.length === 0) {
      return null;
    }
    return column.higher ? Math.max(...values) : Math.min(...values);
  };
  const bests = reportColumns.map(best);

  return (
    <div className="load-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Algorithm</th>
            {reportColumns.map((column) => <th key={column.label}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, name, running, report }) => (
            <tr key={key}>
              <td>{running ? `${name} (running)` : name}</td>
              {reportColumns.map((column, index) => {
                const value = column.pick(report);
                const isBest = !running && value !== null && value === bests[index];
                return (
                  <td key={column.label} className={isBest ? 'load-best' : ''}>
                    {value === null ? 'N/A' : column.text(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
