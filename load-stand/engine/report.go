package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

var latencyBucketBounds = []time.Duration{
	time.Millisecond,
	2 * time.Millisecond,
	3 * time.Millisecond,
	5 * time.Millisecond,
	7 * time.Millisecond,
	10 * time.Millisecond,
	15 * time.Millisecond,
	20 * time.Millisecond,
	30 * time.Millisecond,
	50 * time.Millisecond,
	75 * time.Millisecond,
	100 * time.Millisecond,
	150 * time.Millisecond,
	200 * time.Millisecond,
	300 * time.Millisecond,
	500 * time.Millisecond,
	750 * time.Millisecond,
	time.Second,
	1500 * time.Millisecond,
	2 * time.Second,
	3 * time.Second,
	5 * time.Second,
	10 * time.Second,
	30 * time.Second,
	60 * time.Second,
	120 * time.Second,
}

const defaultEnvoyAdminURL = "http://localhost:9901"
const envoyEndpointStatsPrefix = "cluster.grpc_backend.endpoint."

type TestMetrics struct {
	RPS                  float64 `json:"rps"`
	P50Millis            float64 `json:"p50Millis"`
	P95Millis            float64 `json:"p95Millis"`
	P99Millis            float64 `json:"p99Millis"`
	ErrorRatePercent     float64 `json:"errorRatePercent"`
	CpuFairnessIndex     float64 `json:"cpuFairnessIndex"`
	CpuFairnessAvailable bool    `json:"cpuFairnessAvailable"`
	DurationSeconds      float64 `json:"durationSeconds"`
}

type envoyEndpointCounters struct {
	Requests int64
	Healthy  bool
}

type envoyStatsResponse struct {
	Stats []struct {
		Name  string      `json:"name"`
		Value json.Number `json:"value"`
	} `json:"stats"`
}

func fetchEnvoyEndpointCounters(adminURL string) (map[string]envoyEndpointCounters, error) {
	parsedURL, err := url.Parse(adminURL)
	if err != nil {
		return nil, fmt.Errorf("invalid Envoy admin URL: %w", err)
	}
	parsedURL.Path = strings.TrimRight(parsedURL.Path, "/") + "/stats"
	query := parsedURL.Query()
	query.Set("format", "json")
	query.Set("filter", envoyEndpointStatsPrefix)
	parsedURL.RawQuery = query.Encode()

	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get(parsedURL.String())
	if err != nil {
		return nil, fmt.Errorf("querying Envoy admin API: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Envoy admin API returned %s", response.Status)
	}

	decoder := json.NewDecoder(response.Body)
	decoder.UseNumber()
	var payload envoyStatsResponse
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("decoding Envoy admin stats: %w", err)
	}
	return parseEnvoyEndpointCounters(payload), nil
}

func parseEnvoyEndpointCounters(payload envoyStatsResponse) map[string]envoyEndpointCounters {
	result := make(map[string]envoyEndpointCounters)
	for _, stat := range payload.Stats {
		name := strings.TrimPrefix(stat.Name, envoyEndpointStatsPrefix)
		if name == stat.Name {
			continue
		}
		separator := strings.LastIndexByte(name, '.')
		if separator < 0 {
			continue
		}
		endpoint, metric := name[:separator], name[separator+1:]
		value, err := stat.Value.Int64()
		if err != nil {
			continue
		}
		counters := result[endpoint]
		switch metric {
		case "rq_total":
			counters.Requests = value
		case "healthy":
			counters.Healthy = value == 1
		default:
			continue
		}
		result[endpoint] = counters
	}
	return result
}

type cpuSample struct {
	sum   float64
	count int
}

func summarizeTest(
	successfulRequests int64,
	failedRequests int64,
	latencyBuckets []int64,
	duration time.Duration,
	cpuUtilizations []float64,
) TestMetrics {
	result := TestMetrics{DurationSeconds: duration.Seconds()}
	totalRequests := successfulRequests + failedRequests
	if duration > 0 {
		result.RPS = float64(totalRequests) / duration.Seconds()
	}
	if totalRequests > 0 {
		result.ErrorRatePercent = float64(failedRequests) / float64(totalRequests) * 100
	}
	result.P50Millis = percentileMillis(latencyBuckets, 0.50)
	result.P95Millis = percentileMillis(latencyBuckets, 0.95)
	result.P99Millis = percentileMillis(latencyBuckets, 0.99)
	result.CpuFairnessIndex, result.CpuFairnessAvailable = cpuFairnessIndex(cpuUtilizations)
	return result
}

func recordCPUUtilizations(servers []ServerStatus, samples map[string]cpuSample) {
	if samples == nil {
		return
	}
	for _, server := range servers {
		if server.Status != "up" || math.IsNaN(server.CPU) || math.IsInf(server.CPU, 0) {
			continue
		}
		utilization := server.CPU / 100
		if utilization < 0 {
			utilization = 0
		}
		if utilization > 1 {
			utilization = 1
		}
		sample := samples[server.Name]
		sample.sum += utilization
		sample.count++
		samples[server.Name] = sample
	}
}

func meanCPUUtilizations(samples map[string]cpuSample) []float64 {
	utilizations := make([]float64, 0, len(samples))
	for _, sample := range samples {
		if sample.count == 0 {
			continue
		}
		utilizations = append(utilizations, sample.sum/float64(sample.count))
	}
	return utilizations
}

func percentileMillis(bucketCounts []int64, percentile float64) float64 {
	var totalCount int64
	for _, count := range bucketCounts {
		totalCount += count
	}
	if totalCount == 0 {
		return 0
	}
	rank := percentile * float64(totalCount)
	var cumulative int64
	for index, count := range bucketCounts {
		prevCumulative := cumulative
		cumulative += count
		if float64(cumulative) >= rank {
			var lowerBound time.Duration
			if index > 0 {
				lowerBound = latencyBucketBounds[index-1]
			}
			if index >= len(latencyBucketBounds) {
				return float64(latencyBucketBounds[len(latencyBucketBounds)-1].Milliseconds())
			}
			upperBound := latencyBucketBounds[index]
			if count == 0 {
				return float64(upperBound.Nanoseconds()) / float64(time.Millisecond)
			}
			fraction := (rank - float64(prevCumulative)) / float64(count)
			interpolated := lowerBound + time.Duration(fraction*float64(upperBound-lowerBound))
			return float64(interpolated.Nanoseconds()) / float64(time.Millisecond)
		}
	}

	return 0
}

// cpuFairnessIndex is Jain's index on CPU utilization in [0, 1].
// 1 means every included server sat at the same fraction of its own limit.
func cpuFairnessIndex(utilizations []float64) (float64, bool) {
	if len(utilizations) == 0 {
		return 0, false
	}
	var sum, sumSquares float64
	for _, utilization := range utilizations {
		if math.IsNaN(utilization) || math.IsInf(utilization, 0) {
			return 0, false
		}
		if utilization < 0 {
			utilization = 0
		}
		if utilization > 1 {
			utilization = 1
		}
		sum += utilization
		sumSquares += utilization * utilization
	}
	if sumSquares == 0 {
		return 0, false
	}
	count := float64(len(utilizations))
	return sum * sum / (count * sumSquares), true
}

func latencyBucketIndex(duration time.Duration) int {
	return sort.Search(len(latencyBucketBounds), func(index int) bool {
		return duration <= latencyBucketBounds[index]
	})
}
