package metrics

import (
	"strconv"
	"sync"

	"github.com/prometheus/client_golang/prometheus"
)

var (
	testRunning = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "load_stand_test_running",
		Help: "Whether a load test is currently running (1 = running, 0 = stopped)",
	})

	testInfo = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "load_stand_test_info",
		Help: "Active load test configuration (value 1 while test runs)",
	}, []string{"preset", "concurrency", "duration_sec", "file_size_kb"})

	requestsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "load_stand_requests_total",
		Help: "Total load generator requests by RPC endpoint and result",
	}, []string{"endpoint", "result"})

	mu sync.Mutex
)

func init() {
	prometheus.MustRegister(testRunning, testInfo, requestsTotal)
}

func SetTestRunning(preset string, concurrency, durationSec, fileSizeKb int) {
	mu.Lock()
	defer mu.Unlock()

	testInfo.Reset()
	testRunning.Set(1)
	testInfo.WithLabelValues(
		preset,
		strconv.Itoa(concurrency),
		strconv.Itoa(durationSec),
		strconv.Itoa(fileSizeKb),
	).Set(1)
}

func SetTestStopped() {
	mu.Lock()
	defer mu.Unlock()

	testRunning.Set(0)
	testInfo.Reset()
}

func RecordRequest(endpoint string, success bool) {
	result := "success"
	if !success {
		result = "failure"
	}
	requestsTotal.WithLabelValues(endpoint, result).Inc()
}
