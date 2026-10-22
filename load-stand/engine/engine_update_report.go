package engine

import (
	"time"
)

// recordCPUBalance adds the deviation of the CPU load of this second to the sum that the
// report averages over the test.
func (e *Engine) recordCPUBalance() {
	// Docker-aware, so a stopped server leaves the figures at once, as it does on the charts.
	servers, err := e.fetchServerStatuses()
	if err != nil {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	// One server has nothing to deviate from, so that second says nothing about balance.
	if _, _, mad, live := summarizeLiveCPU(servers); live >= 2 {
		e.cpuMADSum += mad
		e.cpuMADSeconds++
	}
}

func (e *Engine) updateReport() {
	duration := time.Since(e.testStartedAt)
	if duration < time.Millisecond {
		duration = time.Millisecond
	}

	e.recordCPUBalance()

	latencyBuckets := make([]int64, len(e.stats.latencyBuckets))
	for index := range e.stats.latencyBuckets {
		latencyBuckets[index] = e.stats.latencyBuckets[index].Load()
	}
	report := summarizeTest(
		e.stats.SuccessfulRequests.Load(),
		e.stats.FailedRequests.Load(),
		latencyBuckets,
		duration,
	)

	e.mu.Lock()
	e.addMeanMAD(&report)
	e.stats.Report = &report
	e.mu.Unlock()
}

// addMeanMAD puts the deviation averaged over the seconds of the test into the report.
// The caller holds e.mu.
func (e *Engine) addMeanMAD(report *TestMetrics) {
	if e.cpuMADSeconds > 0 {
		report.CPUMADMeanPercent = e.cpuMADSum / float64(e.cpuMADSeconds)
		report.CPUMADMeanAvailable = true
	}
}
