package engine

import (
	"time"
)

func (e *Engine) updateReport() {
	duration := time.Since(e.testStartedAt)
	if duration < time.Millisecond {
		duration = time.Millisecond
	}

	var after map[string]envoyEndpointCounters
	if counters, err := fetchEnvoyEndpointCounters(e.envoyAdminURL); err != nil {
		// Just skip Jain index if we can't fetch it, don't spam logs every second
	} else {
		after = counters
	}

	latencyBuckets := make([]int64, len(e.stats.latencyBuckets))
	for index := range e.stats.latencyBuckets {
		latencyBuckets[index] = e.stats.latencyBuckets[index].Load()
	}
	report := summarizeTest(
		e.stats.SuccessfulRequests.Load(),
		e.stats.FailedRequests.Load(),
		latencyBuckets,
		duration,
		e.backendCounters,
		after,
	)

	e.mu.Lock()
	e.stats.Report = &report
	e.mu.Unlock()
}
