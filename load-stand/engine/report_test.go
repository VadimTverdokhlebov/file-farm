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
	before := map[string]envoyEndpointCounters{
		"10.0.0.1_50051": {Requests: 100, Healthy: true},
		"10.0.0.2_50051": {Requests: 100, Healthy: true},
	}
	after := map[string]envoyEndpointCounters{
		"10.0.0.1_50051": {Requests: 200, Healthy: true},
		"10.0.0.2_50051": {Requests: 200, Healthy: true},
	}

	result := summarizeTest(90, 10, latencyBuckets, 10*time.Second, before, after)

	if result.RPS != 10 {
		t.Fatalf("expected 10 RPS, got %v", result.RPS)
	}
	if result.ErrorRatePercent != 10 {
		t.Fatalf("expected 10 percent errors, got %v", result.ErrorRatePercent)
	}
	if result.P50Millis != 20 || result.P99Millis != 200 {
		t.Fatalf("unexpected latency percentiles p50=%v p99=%v", result.P50Millis, result.P99Millis)
	}
	if !result.JainAvailable || result.JainIndex != 1 {
		t.Fatalf("expected Jain index 1, got %v (available=%t)", result.JainIndex, result.JainAvailable)
	}
}

func TestJainIndexIgnoresUnhealthyEndpoints(t *testing.T) {
	before := map[string]envoyEndpointCounters{
		"10.0.0.1_50051": {Requests: 10, Healthy: true},
		"10.0.0.2_50051": {Requests: 10, Healthy: true},
	}
	after := map[string]envoyEndpointCounters{
		"10.0.0.1_50051": {Requests: 110, Healthy: true},
		"10.0.0.2_50051": {Requests: 10, Healthy: false},
	}

	index, available := jainIndex(before, after)
	if !available || index != 1 {
		t.Fatalf("expected healthy-only Jain index 1, got %v (available=%t)", index, available)
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

func TestJainIndexForUnevenTraffic(t *testing.T) {
	before := map[string]envoyEndpointCounters{
		"a": {Requests: 0, Healthy: true},
		"b": {Requests: 0, Healthy: true},
	}
	after := map[string]envoyEndpointCounters{
		"a": {Requests: 100, Healthy: true},
		"b": {Requests: 0, Healthy: true},
	}

	index, available := jainIndex(before, after)
	if !available || math.Abs(index-0.5) > 1e-9 {
		t.Fatalf("expected Jain index 0.5, got %v (available=%t)", index, available)
	}
}
