package engine

import (
	"context"
	"fmt"
	"log"
	"math"
	"time"
)

const (
	defaultSeriesCooldownSec = 45
	minSeriesCooldownSec     = 10
	maxSeriesAlgorithms      = 8
	// seriesWindowSamples is how many one-second snapshots the RPS, error and p95
	// figures of a sample are averaged over.
	seriesWindowSamples = 5
	seriesReadyTimeout  = 90 * time.Second
	seriesStopTimeout   = 30 * time.Second
)

// Phases of a series.
const (
	SeriesPreparing = "preparing"
	SeriesRunning   = "running"
	SeriesCooldown  = "cooldown"
	SeriesFinished  = "finished"
	SeriesStopped   = "stopped"
	SeriesFailed    = "failed"
)

// States of one run inside a series.
const (
	RunPending = "pending"
	RunRunning = "running"
	RunDone    = "done"
	RunStopped = "stopped"
	RunFailed  = "failed"
)

// SeriesSample is one second of a run. Every figure is for the whole cluster,
// so runs of different algorithms can be drawn over each other.
type SeriesSample struct {
	AtSec        int     `json:"t"`
	MeanCPU      float64 `json:"meanCpu"`
	MaxCPU       float64 `json:"maxCpu"`
	CPUMAD       float64 `json:"cpuMad"`
	RPS          float64 `json:"rps"`
	P50Millis    float64 `json:"p50Ms"`
	P95Millis    float64 `json:"p95Ms"`
	P99Millis    float64 `json:"p99Ms"`
	ErrorPercent float64 `json:"errorPct"`
	LiveServers  int     `json:"live"`
}

type SeriesRun struct {
	Algorithm string         `json:"algorithm"`
	State     string         `json:"state"`
	Error     string         `json:"error,omitempty"`
	Report    *TestMetrics   `json:"report,omitempty"`
	Samples   []SeriesSample `json:"samples,omitempty"`
	// StartedAtMs is when the load began, in Unix milliseconds.
	StartedAtMs int64 `json:"startedAtMs,omitempty"`
	// servers is the per-server status of every sample. It is big, so it is served
	// separately and only for a run that is over.
	servers []ServerHistoryPoint
}

// ServerHistoryPoint is the status of every server at one moment of a run.
type ServerHistoryPoint struct {
	At      int64          `json:"at"`
	Servers []ServerStatus `json:"servers"`
}

// SeriesStatus is the state of the last series. It stays after the series is over
// so the results can be looked at until the next series starts.
type SeriesStatus struct {
	Active bool `json:"active"`
	// Preset is the scenario the series was started from, so a reloaded page can open it.
	Preset          string          `json:"preset,omitempty"`
	Phase           string          `json:"phase"`
	Current         int             `json:"current"`
	CooldownLeftSec int             `json:"cooldownLeftSec"`
	DurationSec     int             `json:"durationSec"`
	FreezeModel     bool            `json:"freezeModel"`
	Message         string          `json:"message,omitempty"`
	Outages         []PlannedOutage `json:"outages,omitempty"`
	Runs            []SeriesRun     `json:"runs"`
	// ElapsedSec is the time of the whole series so far, pauses between the runs included.
	// It stops growing when the series ends.
	ElapsedSec int `json:"elapsedSec"`

	startedAt time.Time
	endedAt   time.Time
}

// SeriesSnapshot returns a copy of the series state. Samples are left out unless
// asked for, so the one-second status message stays small.
func (e *Engine) SeriesSnapshot(withSamples bool) *SeriesStatus {
	e.seriesMu.Lock()
	defer e.seriesMu.Unlock()
	if e.series == nil {
		return nil
	}
	snapshot := *e.series
	snapshot.ElapsedSec = seriesElapsedSec(e.series.startedAt, e.series.endedAt)
	snapshot.Outages = append([]PlannedOutage(nil), e.series.Outages...)
	snapshot.Runs = make([]SeriesRun, len(e.series.Runs))
	for index, run := range e.series.Runs {
		copied := run
		copied.servers = nil
		if run.Report != nil {
			report := *run.Report
			copied.Report = &report
		}
		if withSamples {
			copied.Samples = append([]SeriesSample(nil), run.Samples...)
		} else {
			copied.Samples = nil
		}
		snapshot.Runs[index] = copied
	}
	return &snapshot
}

// SeriesServerHistory returns the per-server samples of a run, including one that
// is still going, so a reloaded page can draw the same charts again.
func (e *Engine) SeriesServerHistory(index int) ([]ServerHistoryPoint, error) {
	e.seriesMu.Lock()
	defer e.seriesMu.Unlock()
	if e.series == nil || index < 0 || index >= len(e.series.Runs) {
		return nil, fmt.Errorf("no such run")
	}
	run := e.series.Runs[index]
	return append([]ServerHistoryPoint(nil), run.servers...), nil
}

func (e *Engine) SeriesActive() bool {
	e.seriesMu.Lock()
	defer e.seriesMu.Unlock()
	return e.series != nil && e.series.Active
}

// ClearResults drops a finished series and the last report, the same wipe a
// new Start does before it records anything. A run that is still going stays.
func (e *Engine) ClearResults() error {
	e.mu.Lock()
	running := e.isRunning
	e.mu.Unlock()
	e.seriesMu.Lock()
	active := e.series != nil && e.series.Active
	if running || active {
		e.seriesMu.Unlock()
		return fmt.Errorf("a series is running; stop it first")
	}
	e.series = nil
	e.seriesCancel = nil
	e.seriesMu.Unlock()

	e.mu.Lock()
	e.resetLoadStats()
	e.stats.Report = nil
	e.testStartedAt = time.Time{}
	e.mu.Unlock()
	return nil
}

// StopAll ends a series, if one is going, together with the test inside it.
func (e *Engine) StopAll() {
	e.seriesMu.Lock()
	cancel := e.seriesCancel
	e.seriesMu.Unlock()
	if cancel != nil {
		cancel()
	}
	e.StopTest()
}

// StartSeries runs the same test once for every algorithm in the config.
func (e *Engine) StartSeries(rawConfig TestConfig) error {
	config := rawConfig.WithDefaults()
	algorithms, err := cleanSeriesAlgorithms(config.Algorithms)
	if err != nil {
		return err
	}
	if config.Duration < 0 {
		return fmt.Errorf("test duration must not be negative")
	}
	// Algorithms take turns by the clock, so only a single run can go on until it is stopped.
	if config.Duration == 0 && len(algorithms) != 1 {
		return fmt.Errorf("an open-ended test needs exactly one algorithm")
	}
	if len(config.Phases) > 0 {
		return fmt.Errorf("a series does not support load waves")
	}
	config.Algorithm = ""
	if err := validateTestConfig(config); err != nil {
		return err
	}
	cooldownSec := config.CooldownSec
	if cooldownSec <= 0 {
		cooldownSec = defaultSeriesCooldownSec
	}
	if cooldownSec < minSeriesCooldownSec {
		cooldownSec = minSeriesCooldownSec
	}

	lookupCtx, lookupCancel := context.WithTimeout(context.Background(), 5*time.Second)
	configuration, err := e.GetBalancerConfiguration(lookupCtx)
	lookupCancel()
	if err != nil {
		return fmt.Errorf("failed to read load-balancing algorithms: %w", err)
	}
	if err := checkKnownAlgorithms(algorithms, configuration.Algorithms); err != nil {
		return err
	}

	e.mu.Lock()
	running := e.isRunning
	e.mu.Unlock()
	if running {
		return fmt.Errorf("test already running")
	}

	runs := make([]SeriesRun, len(algorithms))
	for index, algorithm := range algorithms {
		runs[index] = SeriesRun{Algorithm: algorithm, State: RunPending}
	}
	ctx, cancel := context.WithCancel(context.Background())

	e.seriesMu.Lock()
	if e.series != nil && e.series.Active {
		e.seriesMu.Unlock()
		cancel()
		return fmt.Errorf("a series is already running")
	}
	e.series = &SeriesStatus{
		Active:      true,
		Preset:      config.Preset,
		Phase:       SeriesPreparing,
		DurationSec: config.Duration,
		startedAt:   time.Now(),
		FreezeModel: config.FreezeModel,
		Outages:     append([]PlannedOutage(nil), config.OutagePlan...),
		Runs:        runs,
	}
	e.seriesCancel = cancel
	e.seriesMu.Unlock()

	log.Printf("Starting series: algorithms=%v duration=%ds cooldown=%ds", algorithms, config.Duration, cooldownSec)
	go e.runSeries(ctx, config, cooldownSec)
	return nil
}

// seriesElapsedSec counts up to now while the series goes, and up to its end afterwards.
func seriesElapsedSec(startedAt time.Time, endedAt time.Time) int {
	if startedAt.IsZero() {
		return 0
	}
	if endedAt.IsZero() {
		endedAt = time.Now()
	}
	return int(endedAt.Sub(startedAt).Seconds())
}

func cleanSeriesAlgorithms(algorithms []string) ([]string, error) {
	if len(algorithms) == 0 {
		return nil, fmt.Errorf("select at least one algorithm for the series")
	}
	if len(algorithms) > maxSeriesAlgorithms {
		return nil, fmt.Errorf("a series compares at most %d algorithms", maxSeriesAlgorithms)
	}
	seen := map[string]struct{}{}
	cleaned := make([]string, 0, len(algorithms))
	for _, algorithm := range algorithms {
		if algorithm == "" {
			return nil, fmt.Errorf("algorithm id must not be empty")
		}
		if _, duplicate := seen[algorithm]; duplicate {
			return nil, fmt.Errorf("algorithm %q is listed twice", algorithm)
		}
		seen[algorithm] = struct{}{}
		cleaned = append(cleaned, algorithm)
	}
	return cleaned, nil
}

func checkKnownAlgorithms(wanted []string, known []BalancerAlgorithm) error {
	available := map[string]struct{}{}
	for _, algorithm := range known {
		available[algorithm.ID] = struct{}{}
	}
	for _, algorithm := range wanted {
		if _, ok := available[algorithm]; !ok {
			return fmt.Errorf("the load balancer does not know algorithm %q", algorithm)
		}
	}
	return nil
}

func (e *Engine) runSeries(ctx context.Context, config TestConfig, cooldownSec int) {
	runCount := len(e.SeriesSnapshot(false).Runs)
	for index := 0; index < runCount; index++ {
		if index > 0 && !e.seriesCooldown(ctx, index, cooldownSec) {
			e.finishSeries(SeriesStopped, "")
			return
		}
		e.updateSeries(func(series *SeriesStatus) {
			series.Phase = SeriesPreparing
			series.Current = index
			series.CooldownLeftSec = 0
		})
		if err := e.waitForAllServers(ctx); err != nil {
			e.failSeriesRun(ctx, index, err)
			return
		}

		algorithm := e.SeriesSnapshot(false).Runs[index].Algorithm
		runConfig := config
		runConfig.Algorithm = algorithm
		// Only the AM-PPO policy can be frozen; the flag means nothing to the rest.
		runConfig.FreezeModel = config.FreezeModel && algorithm == "am_ppo"
		if err := e.StartTest(runConfig); err != nil {
			e.failSeriesRun(ctx, index, err)
			return
		}
		e.mu.Lock()
		startedAt := e.testStartedAt
		e.mu.Unlock()
		e.updateSeries(func(series *SeriesStatus) {
			series.Phase = SeriesRunning
			series.Runs[index].State = RunRunning
			series.Runs[index].StartedAtMs = startedAt.UnixMilli()
		})

		stopped := e.collectSeriesRun(ctx, index)
		if stopped {
			e.finishSeries(SeriesStopped, "")
			return
		}
	}
	e.finishSeries(SeriesFinished, "")
}

func (e *Engine) updateSeries(update func(series *SeriesStatus)) {
	e.seriesMu.Lock()
	defer e.seriesMu.Unlock()
	if e.series != nil {
		update(e.series)
	}
}

func (e *Engine) failSeriesRun(ctx context.Context, index int, err error) {
	if ctx.Err() != nil {
		e.finishSeries(SeriesStopped, "")
		return
	}
	log.Printf("Series run %d failed: %v", index+1, err)
	e.updateSeries(func(series *SeriesStatus) {
		series.Runs[index].State = RunFailed
		series.Runs[index].Error = err.Error()
	})
	e.finishSeries(SeriesFailed, err.Error())
}

func (e *Engine) finishSeries(phase string, message string) {
	e.seriesMu.Lock()
	defer e.seriesMu.Unlock()
	if e.series != nil {
		e.series.Active = false
		e.series.endedAt = time.Now()
		e.series.Phase = phase
		e.series.CooldownLeftSec = 0
		e.series.Message = message
	}
	if e.seriesCancel != nil {
		e.seriesCancel()
		e.seriesCancel = nil
	}
	log.Printf("Series ended: %s", phase)
}

// seriesCooldown waits between two runs so the cluster settles after the
// previous one. It reports false when the series was stopped meanwhile.
func (e *Engine) seriesCooldown(ctx context.Context, next int, cooldownSec int) bool {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for left := cooldownSec; left > 0; left-- {
		e.updateSeries(func(series *SeriesStatus) {
			series.Phase = SeriesCooldown
			series.Current = next
			series.CooldownLeftSec = left
		})
		select {
		case <-ctx.Done():
			return false
		case <-ticker.C:
		}
	}
	return ctx.Err() == nil
}

// waitForAllServers holds the run back until every server is up, because a run
// that starts on a smaller cluster cannot be compared with the others.
func (e *Engine) waitForAllServers(ctx context.Context) error {
	deadline := time.Now().Add(seriesReadyTimeout)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		servers, err := FetchServerStatuses(e.prometheusURL)
		if err == nil {
			down := downServers(servers)
			if len(down) == 0 {
				return nil
			}
			if time.Now().After(deadline) {
				return fmt.Errorf("servers are still down after %s: %v", seriesReadyTimeout, down)
			}
		} else if time.Now().After(deadline) {
			return fmt.Errorf("cannot read server status: %w", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func downServers(servers []ServerStatus) []string {
	down := []string{}
	for _, server := range servers {
		if server.Status != "up" {
			down = append(down, server.Name)
		}
	}
	return down
}

// collectSeriesRun records one sample per second until the test ends. It reports
// true when the series was stopped during the run.
func (e *Engine) collectSeriesRun(ctx context.Context, index int) bool {
	window := newSeriesWindow(seriesWindowSamples)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	stopped := false
	lastSecond := -1

	for !stopped {
		select {
		case <-ctx.Done():
			stopped = true
			e.StopTest()
		case <-ticker.C:
			e.mu.Lock()
			running := e.isRunning
			startedAt := e.testStartedAt
			e.mu.Unlock()
			if !running {
				return e.endSeriesRun(ctx, index)
			}

			window.add(e.counterSnapshot())
			if len(window.snapshots) < 2 {
				// One snapshot has no rate yet; a zero would draw a false dip at the start.
				continue
			}
			second := int(math.Round(time.Since(startedAt).Seconds()))
			if second <= lastSecond {
				continue
			}
			servers, err := e.fetchServerStatuses()
			if err != nil {
				continue
			}
			lastSecond = second
			sample := buildSeriesSample(second, servers, window)
			// Stamped on the clock of the test, like the sample and the outage schedule. The wall
			// clock of this machine jumps ahead every half a minute while the timers do not, so
			// wall stamps put a stop at second 300 about 20 s after the strip that marks it.
			point := ServerHistoryPoint{At: runPointTime(startedAt, second), Servers: withPowerState(servers)}
			e.updateSeries(func(series *SeriesStatus) {
				run := &series.Runs[index]
				run.Samples = append(run.Samples, sample)
				run.servers = append(run.servers, point)
			})
		}
	}
	e.waitForTestEnd(seriesStopTimeout)
	e.endSeriesRun(ctx, index)
	return true
}

func (e *Engine) endSeriesRun(ctx context.Context, index int) bool {
	e.mu.Lock()
	var report *TestMetrics
	if e.stats.Report != nil {
		copied := *e.stats.Report
		report = &copied
	}
	e.mu.Unlock()

	stopped := ctx.Err() != nil
	e.updateSeries(func(series *SeriesStatus) {
		series.Runs[index].Report = report
		if stopped {
			series.Runs[index].State = RunStopped
		} else {
			series.Runs[index].State = RunDone
		}
	})
	return stopped
}

func (e *Engine) waitForTestEnd(timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		e.mu.Lock()
		running := e.isRunning
		e.mu.Unlock()
		if !running {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func (e *Engine) counterSnapshot() counterSnapshot {
	buckets := make([]int64, len(e.stats.latencyBuckets))
	for index := range e.stats.latencyBuckets {
		buckets[index] = e.stats.latencyBuckets[index].Load()
	}
	return counterSnapshot{
		at:      time.Now(),
		success: e.stats.SuccessfulRequests.Load(),
		failed:  e.stats.FailedRequests.Load(),
		buckets: buckets,
	}
}

type counterSnapshot struct {
	at      time.Time
	success int64
	failed  int64
	buckets []int64
}

// seriesWindow keeps the last few counter snapshots, so a sample can report
// request rate, error share and p95 over the recent seconds instead of one noisy second.
type seriesWindow struct {
	size      int
	snapshots []counterSnapshot
}

func newSeriesWindow(size int) *seriesWindow {
	return &seriesWindow{size: size}
}

func (w *seriesWindow) add(snapshot counterSnapshot) {
	w.snapshots = append(w.snapshots, snapshot)
	if len(w.snapshots) > w.size {
		w.snapshots = w.snapshots[len(w.snapshots)-w.size:]
	}
}

// windowRates are the figures of one sample, taken over the window.
type windowRates struct {
	RPS          float64
	ErrorPercent float64
	P50Millis    float64
	P95Millis    float64
	P99Millis    float64
}

func (w *seriesWindow) rates() windowRates {
	if len(w.snapshots) < 2 {
		return windowRates{}
	}
	first := w.snapshots[0]
	last := w.snapshots[len(w.snapshots)-1]
	seconds := last.at.Sub(first.at).Seconds()
	succeeded := last.success - first.success
	failed := last.failed - first.failed
	var rates windowRates
	if seconds > 0 {
		rates.RPS = float64(succeeded) / seconds
	}
	if total := succeeded + failed; total > 0 {
		rates.ErrorPercent = float64(failed) / float64(total) * 100
	}
	diff := make([]int64, len(last.buckets))
	for index := range diff {
		diff[index] = last.buckets[index]
		if index < len(first.buckets) {
			diff[index] -= first.buckets[index]
		}
	}
	rates.P50Millis = percentileMillis(diff, 0.5)
	rates.P95Millis = percentileMillis(diff, 0.95)
	rates.P99Millis = percentileMillis(diff, 0.99)
	return rates
}

func buildSeriesSample(second int, servers []ServerStatus, window *seriesWindow) SeriesSample {
	mean, peak, mad, live := summarizeLiveCPU(servers)
	rates := window.rates()
	return SeriesSample{
		AtSec:        second,
		MeanCPU:      mean,
		MaxCPU:       peak,
		CPUMAD:       mad,
		RPS:          rates.RPS,
		P50Millis:    rates.P50Millis,
		P95Millis:    rates.P95Millis,
		P99Millis:    rates.P99Millis,
		ErrorPercent: rates.ErrorPercent,
		LiveServers:  live,
	}
}

// summarizeLiveCPU looks only at servers that are up: a stopped container reports
// no load, and counting it would pull the mean down and stretch the deviation.
// CPU is a share of each server's own limit. The deviation is the mean absolute
// deviation of the servers from their mean, in percentage points.
func summarizeLiveCPU(servers []ServerStatus) (mean float64, peak float64, mad float64, live int) {
	loads := make([]float64, 0, len(servers))
	sum := 0.0
	for _, server := range servers {
		if server.Status != "up" {
			continue
		}
		loads = append(loads, server.CPU)
		sum += server.CPU
		if server.CPU > peak {
			peak = server.CPU
		}
	}
	live = len(loads)
	if live == 0 {
		return 0, 0, 0, 0
	}
	return sum / float64(live), peak, meanAbsoluteDeviation(loads), live
}

// runPointTime is the moment, in Unix milliseconds, of the given second of a run.
func runPointTime(startedAt time.Time, second int) int64 {
	return startedAt.UnixMilli() + int64(second)*1000
}

// withPowerState copies the servers and fills in what the charts read as "stopped":
// a Docker stop or a Prometheus down both count, and Prometheus "up" must not
// revive a container that is already marked not running.
func withPowerState(servers []ServerStatus) []ServerStatus {
	copied := append([]ServerStatus(nil), servers...)
	for index := range copied {
		if copied[index].Status != "up" || !copied[index].Running {
			copied[index].Running = false
			copied[index].Status = "down"
			clearDownServer(&copied[index])
		}
	}
	return copied
}
