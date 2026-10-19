package engine

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSummarizeTestMetrics(t *testing.T) {
	latencyBuckets := make([]int64, len(latencyBucketBounds)+1)
	latencyBuckets[latencyBucketIndex(20*time.Millisecond)] = 50
	latencyBuckets[latencyBucketIndex(200*time.Millisecond)] = 49
	latencyBuckets[latencyBucketIndex(2*time.Second)] = 1

	result := summarizeTest(90, 10, latencyBuckets, 10*time.Second, []float64{0.5, 0.5})

	if result.RPS != 10 {
		t.Fatalf("expected 10 RPS, got %v", result.RPS)
	}
	if result.ErrorRatePercent != 10 {
		t.Fatalf("expected 10 percent errors, got %v", result.ErrorRatePercent)
	}
	if result.P50Millis != 20 || result.P99Millis != 200 {
		t.Fatalf("unexpected latency percentiles p50=%v p99=%v", result.P50Millis, result.P99Millis)
	}
	if math.Abs(result.P95Millis-195.918367) > 0.001 {
		t.Fatalf("unexpected p95 %v", result.P95Millis)
	}
	if !result.CpuFairnessAvailable || result.CpuFairnessIndex != 1 {
		t.Fatalf("expected CPU fairness 1, got %v (available=%t)", result.CpuFairnessIndex, result.CpuFairnessAvailable)
	}
}

func TestCPUFairnessSkipsStoppedServers(t *testing.T) {
	samples := map[string]cpuSample{}
	recordCPUUtilizations([]ServerStatus{
		{Name: "file-farm-server-1", Status: "up", CPU: 100},
		{Name: "file-farm-server-2", Status: "down", CPU: 0},
		{Name: "file-farm-server-3", Status: "up", CPU: 50},
	}, samples)

	index, available := cpuFairnessIndex(meanCPUUtilizations(samples))
	if !available || math.Abs(index-0.9) > 1e-9 {
		t.Fatalf("expected CPU fairness 0.9, got %v (available=%t)", index, available)
	}
}

func TestParseEnvoyEndpointCounters(t *testing.T) {
	var payload envoyStatsResponse
	data := []byte(`{"stats":[{"name":"cluster.grpc_backend.endpoint.10.0.0.1_50051.rq_total","value":42},{"name":"cluster.grpc_backend.endpoint.10.0.0.1_50051.healthy","value":1}]}`)
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatal(err)
	}

	counters := parseEnvoyEndpointCounters(payload)["10.0.0.1_50051"]
	if counters.Requests != 42 || !counters.Healthy {
		t.Fatalf("unexpected endpoint counters: %+v", counters)
	}
}

func TestFetchEnvoyEndpointCountersUsesStatsEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/stats" {
			t.Errorf("expected /stats path, got %s", r.URL.Path)
		}
		if r.URL.Query().Get("format") != "json" {
			t.Errorf("expected JSON stats format")
		}
		if r.URL.Query().Get("filter") != envoyEndpointStatsPrefix {
			t.Errorf("unexpected Envoy stats filter %q", r.URL.Query().Get("filter"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"stats":[{"name":"cluster.grpc_backend.endpoint.10.0.0.1_50051.rq_total","value":42},{"name":"cluster.grpc_backend.endpoint.10.0.0.1_50051.healthy","value":1}]}`))
	}))
	defer server.Close()

	counters, err := fetchEnvoyEndpointCounters(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if counters["10.0.0.1_50051"].Requests != 42 {
		t.Fatalf("unexpected request counter: %+v", counters)
	}
}

func TestCPUFairnessForUnevenUtilization(t *testing.T) {
	index, available := cpuFairnessIndex([]float64{1, 0})
	if !available || math.Abs(index-0.5) > 1e-9 {
		t.Fatalf("expected CPU fairness 0.5, got %v (available=%t)", index, available)
	}
}

func TestCPUFairnessIsUnavailableWhenEveryServerIsIdle(t *testing.T) {
	index, available := cpuFairnessIndex([]float64{0, 0})
	if available || index != 0 {
		t.Fatalf("expected idle cluster to omit fairness, got %v (available=%t)", index, available)
	}
}
