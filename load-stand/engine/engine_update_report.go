package engine

import (
	"time"
)

func (e *Engine) recordCPUSample() {
	servers, err := FetchServerStatuses(e.prometheusURL)
	if err != nil {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cpuSamples == nil {
		e.cpuSamples = map[string]cpuSample{}
	}
	recordCPUUtilizations(servers, e.cpuSamples)
}

func (e *Engine) meanCPUUtilizations() []float64 {
	e.mu.Lock()
	defer e.mu.Unlock()
	return meanCPUUtilizations(e.cpuSamples)
}

func (e *Engine) updateReport() {
	duration := time.Since(e.testStartedAt)
	if duration < time.Millisecond {
		duration = time.Millisecond
	}

	e.recordCPUSample()

	latencyBuckets := make([]int64, len(e.stats.latencyBuckets))
	for index := range e.stats.latencyBuckets {
		latencyBuckets[index] = e.stats.latencyBuckets[index].Load()
	}
	report := summarizeTest(
		e.stats.SuccessfulRequests.Load(),
		e.stats.FailedRequests.Load(),
		latencyBuckets,
		duration,
		e.meanCPUUtilizations(),
	)

	e.mu.Lock()
	e.stats.Report = &report
	e.mu.Unlock()
}
