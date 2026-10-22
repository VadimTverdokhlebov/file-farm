package engine

import (
	"context"
	"math"
	"strings"
	"testing"
	"time"
)

func TestCleanSeriesAlgorithms(t *testing.T) {
	if _, err := cleanSeriesAlgorithms(nil); err == nil {
		t.Fatal("an empty list must be rejected")
	}
	if _, err := cleanSeriesAlgorithms([]string{"am_ppo", "am_ppo"}); err == nil {
		t.Fatal("a repeated algorithm must be rejected")
	}
	if _, err := cleanSeriesAlgorithms([]string{"am_ppo", ""}); err == nil {
		t.Fatal("an empty id must be rejected")
	}
	got, err := cleanSeriesAlgorithms([]string{"am_ppo", "ema"})
	if err != nil || len(got) != 2 || got[0] != "am_ppo" || got[1] != "ema" {
		t.Fatalf("unexpected result %v, %v", got, err)
	}
}

func TestCheckKnownAlgorithms(t *testing.T) {
	known := []BalancerAlgorithm{{ID: "am_ppo"}, {ID: "ema"}}
	if err := checkKnownAlgorithms([]string{"ema"}, known); err != nil {
		t.Fatalf("known algorithm rejected: %v", err)
	}
	if err := checkKnownAlgorithms([]string{"ema", "random"}, known); err == nil {
		t.Fatal("unknown algorithm must be rejected")
	}
}

func TestSummarizeLiveCPUIgnoresStoppedServers(t *testing.T) {
	servers := []ServerStatus{
		{Name: "a", Status: "up", CPU: 40},
		{Name: "b", Status: "up", CPU: 60},
		{Name: "c", Status: "down", CPU: 0},
		{Name: "d", Status: "up", CPU: 80},
	}
	mean, peak, mad, live := summarizeLiveCPU(servers)
	// 40, 60 and 80 sit 20, 0 and 20 points from their mean of 60.
	if live != 3 || mean != 60 || peak != 80 || math.Abs(mad-40.0/3) > 1e-9 {
		t.Fatalf("got mean=%v peak=%v mad=%v live=%d", mean, peak, mad, live)
	}
}

func TestSummarizeLiveCPUWithNoServers(t *testing.T) {
	mean, peak, mad, live := summarizeLiveCPU([]ServerStatus{{Name: "a", Status: "down"}})
	if live != 0 || mean != 0 || peak != 0 || mad != 0 {
		t.Fatalf("got mean=%v peak=%v mad=%v live=%d", mean, peak, mad, live)
	}
}

func TestSeriesWindowRates(t *testing.T) {
	window := newSeriesWindow(3)
	if rates := window.rates(); rates.RPS != 0 {
		t.Fatalf("no snapshots must give no rate, got %v", rates.RPS)
	}
	start := time.Now()
	buckets := func(fast, slow int64) []int64 {
		counts := make([]int64, len(latencyBucketBounds)+1)
		counts[0] = fast
		counts[len(counts)-2] = slow
		return counts
	}
	window.add(counterSnapshot{at: start, success: 100, failed: 0, buckets: buckets(100, 0)})
	window.add(counterSnapshot{at: start.Add(time.Second), success: 190, failed: 5, buckets: buckets(190, 5)})
	window.add(counterSnapshot{at: start.Add(2 * time.Second), success: 280, failed: 10, buckets: buckets(280, 10)})

	rates := window.rates()
	rps, errorPercent, p50, p95, p99 := rates.RPS, rates.ErrorPercent, rates.P50Millis, rates.P95Millis, rates.P99Millis
	if math.Abs(rps-90) > 0.001 {
		t.Fatalf("rps = %v, want 90", rps)
	}
	if want := 10.0 / 190.0 * 100; math.Abs(errorPercent-want) > 0.001 {
		t.Fatalf("error percent = %v, want %v", errorPercent, want)
	}
	if p50 <= 0 || p50 >= p95 || p95 > p99 {
		t.Fatalf("want 0 < p50 < p95 <= p99, got p50=%v p95=%v p99=%v", p50, p95, p99)
	}
}

func TestSeriesWindowKeepsOnlyTheLastSnapshots(t *testing.T) {
	window := newSeriesWindow(2)
	start := time.Now()
	for second := 0; second < 5; second++ {
		window.add(counterSnapshot{at: start.Add(time.Duration(second) * time.Second), success: int64(second * 10)})
	}
	if len(window.snapshots) != 2 {
		t.Fatalf("kept %d snapshots, want 2", len(window.snapshots))
	}
	if rates := window.rates(); math.Abs(rates.RPS-10) > 0.001 {
		t.Fatalf("rps = %v, want 10", rates.RPS)
	}
}

func TestSeriesSnapshotIsACopy(t *testing.T) {
	engine := &Engine{}
	if engine.SeriesSnapshot(true) != nil {
		t.Fatal("no series yet, expected nil")
	}
	engine.series = &SeriesStatus{
		Active: true,
		Runs: []SeriesRun{{
			Algorithm: "ema",
			Samples:   []SeriesSample{{AtSec: 1}},
		}},
	}
	light := engine.SeriesSnapshot(false)
	if len(light.Runs[0].Samples) != 0 {
		t.Fatal("samples must be left out of the light snapshot")
	}
	full := engine.SeriesSnapshot(true)
	full.Runs[0].Samples[0].AtSec = 99
	if engine.series.Runs[0].Samples[0].AtSec != 1 {
		t.Fatal("the snapshot must not share samples with the engine")
	}
}

func TestSeriesCooldownStopsWhenCancelled(t *testing.T) {
	engine := &Engine{series: &SeriesStatus{Active: true, Runs: make([]SeriesRun, 2)}}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if engine.seriesCooldown(ctx, 1, 30) {
		t.Fatal("a cancelled series must not wait out the cooldown")
	}
}

func TestSeriesCooldownRecordsTheWait(t *testing.T) {
	engine := &Engine{series: &SeriesStatus{Active: true, Runs: make([]SeriesRun, 2)}}
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	if engine.seriesCooldown(ctx, 1, 30) {
		t.Fatal("the context ran out before the cooldown, expected false")
	}
	status := engine.SeriesSnapshot(false)
	if status.Phase != SeriesCooldown || status.Current != 1 || status.CooldownLeftSec >= 30 || status.CooldownLeftSec <= 0 {
		t.Fatalf("unexpected status %+v", status)
	}
}

func TestSeriesServerHistoryServesARunningRun(t *testing.T) {
	engine := &Engine{series: &SeriesStatus{Runs: []SeriesRun{
		{Algorithm: "a", State: RunDone, servers: []ServerHistoryPoint{{At: 1}}},
		{Algorithm: "b", State: RunRunning, servers: []ServerHistoryPoint{{At: 2}}},
	}}}
	history, err := engine.SeriesServerHistory(0)
	if err != nil || len(history) != 1 || history[0].At != 1 {
		t.Fatalf("finished run: %v, %v", history, err)
	}
	running, err := engine.SeriesServerHistory(1)
	if err != nil || len(running) != 1 || running[0].At != 2 {
		t.Fatalf("running run: %v, %v", running, err)
	}
	if _, err := engine.SeriesServerHistory(5); err == nil {
		t.Fatal("an unknown run must be an error")
	}
	if light := engine.SeriesSnapshot(true); light.Runs[0].servers != nil {
		t.Fatal("the snapshot must not carry per-server samples")
	}
}

func TestWithPowerStateMarksDownServersStopped(t *testing.T) {
	servers := []ServerStatus{
		{Name: "a", Status: "up", Running: true, EDS: 250},
		{Name: "b", Status: "down", EDS: 250, RPS: 20},
		{Name: "c", Status: "up", Running: false, EDS: 180},
	}
	copied := withPowerState(servers)
	if !copied[0].Running || copied[0].EDS != 250 {
		t.Fatalf("live server changed: %+v", copied[0])
	}
	if copied[1].Running || copied[1].EDS != 0 || copied[1].RPS != 0 {
		t.Fatalf("stopped server not marked: %+v", copied[1])
	}
	if copied[2].Running || copied[2].Status != "down" || copied[2].EDS != 0 {
		t.Fatalf("a Docker stop must stay down even if Prometheus still says up: %+v", copied[2])
	}
	if servers[1].EDS != 250 {
		t.Fatal("the input must not be modified")
	}
}

func TestRunPointTimeFollowsTestSeconds(t *testing.T) {
	startedAt := time.UnixMilli(1_000_000)
	if got := runPointTime(startedAt, 300); got != 1_300_000 {
		t.Fatalf("second 300 should be 300 s after the start, got %d", got)
	}
}

func TestStartSeriesOpenEndedNeedsOneAlgorithm(t *testing.T) {
	engine := &Engine{}
	err := engine.StartSeries(TestConfig{Concurrency: 1, Duration: 0, Algorithms: []string{"round_robin", "ema"}})
	if err == nil || !strings.Contains(err.Error(), "open-ended") {
		t.Fatalf("expected an open-ended test with two algorithms to be refused, got %v", err)
	}
}

func TestSeriesElapsedStopsAtTheEnd(t *testing.T) {
	start := time.Now().Add(-90 * time.Second)
	if got := seriesElapsedSec(time.Time{}, time.Time{}); got != 0 {
		t.Fatalf("a series that never started has no time, got %d", got)
	}
	if got := seriesElapsedSec(start, time.Time{}); got < 90 || got > 91 {
		t.Fatalf("a running series counts up to now, got %d", got)
	}
	if got := seriesElapsedSec(start, start.Add(60*time.Second)); got != 60 {
		t.Fatalf("a finished series counts up to its end, got %d", got)
	}
}

func TestClearResultsDropsAFinishedSeries(t *testing.T) {
	engine := &Engine{}
	engine.series = &SeriesStatus{
		Active: false,
		Phase:  SeriesStopped,
		Runs:   []SeriesRun{{Algorithm: "am_ppo", State: RunStopped}},
	}
	engine.stats.Report = &TestMetrics{RPS: 12}

	if err := engine.ClearResults(); err != nil {
		t.Fatalf("clearing a finished series: %v", err)
	}
	if engine.SeriesSnapshot(true) != nil {
		t.Fatal("the last series must be gone")
	}
	if engine.stats.Report != nil {
		t.Fatal("the last report must be gone")
	}
}

func TestClearResultsKeepsARunningSeries(t *testing.T) {
	engine := &Engine{}
	engine.series = &SeriesStatus{Active: true, Phase: SeriesRunning}
	if err := engine.ClearResults(); err == nil {
		t.Fatal("clearing while a series is running must be refused")
	}
	if engine.series == nil || !engine.series.Active {
		t.Fatal("the running series must stay")
	}
}
