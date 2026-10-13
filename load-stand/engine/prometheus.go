package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const serverCount = 4

type ServerStatus struct {
	Name    string  `json:"name"`
	RPS     float64 `json:"rps"`
	Error   float64 `json:"error"`
	EDS     float64 `json:"eds"`
	Mem     float64 `json:"mem"`
	RAM     float64 `json:"ram"`
	CPU     float64 `json:"cpu"`
	Status  string  `json:"status"` // "up" or "down"
	Running bool    `json:"running"`
}

var prometheusClient = &http.Client{Timeout: 2 * time.Second}

func FetchServerStatuses(prometheusURL string) ([]ServerStatus, error) {
	queries := map[string]string{
		"rps": `sum by(exported_instance) (rate(file_farm_grpc_requests_total[15s]))`,
		// clamp_min avoids 0/0, which Prometheus returns as NaN and which cannot be sent over JSON.
		"errors": `(sum by(exported_instance) (rate(file_farm_grpc_requests_total{status!="ok"}[15s])) or (sum by(exported_instance) (rate(file_farm_grpc_requests_total[15s])) * 0)) / clamp_min(sum by(exported_instance) (rate(file_farm_grpc_requests_total[15s])), 1e-9) * 100`,
		"eds":    `lb_controller_endpoint_weight`,
		"cpu":    `max by(name) (rate(container_cpu_usage_seconds_total{name=~"file-farm-server-[1-4]"}[15s])) / on(name) clamp_min(max by(name) (container_spec_cpu_quota{name=~"file-farm-server-[1-4]"}) / on(name) max by(name) (container_spec_cpu_period{name=~"file-farm-server-[1-4]"}), 1e-9) * 100`,
		"mem":    `max by(name) (container_memory_usage_bytes{name=~"file-farm-server-[1-4]"} / 1024 / 1024)`,
		"ram":    `max by(name) (container_memory_usage_bytes{name=~"file-farm-server-[1-4]"} / container_spec_memory_limit_bytes{name=~"file-farm-server-[1-4]"}) * 100`,
		"up":     `up{job="server"}`,
	}

	results := make(map[string]map[string]float64)
	var mu sync.Mutex
	var wg sync.WaitGroup

	for metric, query := range queries {
		wg.Add(1)
		go func(metric, query string) {
			defer wg.Done()
			values, err := queryPrometheus(prometheusURL, query)
			if err != nil {
				return
			}
			mu.Lock()
			results[metric] = values
			mu.Unlock()
		}(metric, query)
	}
	wg.Wait()

	servers := make([]ServerStatus, 0, serverCount)
	for i := 1; i <= serverCount; i++ {
		name := fmt.Sprintf("file-farm-server-%d", i)
		server := ServerStatus{Name: name, Status: "down"}
		if value, ok := lookupServerValue(results, "up", name); ok && value == 1 {
			server.Status = "up"
		}
		server.RPS = lookupServerValueOrZero(results, "rps", name)
		server.Error = lookupServerValueOrZero(results, "errors", name)
		server.EDS = lookupServerValueOrZero(results, "eds", name)
		server.CPU = lookupServerValueOrZero(results, "cpu", name)
		server.Mem = lookupServerValueOrZero(results, "mem", name)
		server.RAM = lookupServerValueOrZero(results, "ram", name)
		servers = append(servers, server)
	}

	return servers, nil
}

func queryPrometheus(prometheusURL, query string) (map[string]float64, error) {
	if prometheusURL == "" {
		return nil, fmt.Errorf("prometheus url is empty")
	}

	endpoint := fmt.Sprintf("%s/api/v1/query?query=%s", strings.TrimRight(prometheusURL, "/"), url.QueryEscape(query))
	resp, err := prometheusClient.Get(endpoint)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("prometheus query failed: %s", resp.Status)
	}

	var data struct {
		Status string `json:"status"`
		Data   struct {
			Result []struct {
				Metric map[string]string `json:"metric"`
				Value  []interface{}     `json:"value"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	if data.Status != "" && data.Status != "success" {
		return nil, fmt.Errorf("prometheus query status %s", data.Status)
	}

	values := make(map[string]float64)
	for _, sample := range data.Data.Result {
		server := serverNameFromMetric(sample.Metric)
		if server == "" || len(sample.Value) != 2 {
			continue
		}
		raw, ok := sample.Value[1].(string)
		if !ok {
			continue
		}
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			continue
		}
		values[server] = finiteFloat(value)
	}
	return values, nil
}

func serverNameFromMetric(metric map[string]string) string {
	if instanceID, ok := metric["exported_instance"]; ok && instanceID != "" {
		if strings.HasPrefix(instanceID, "file-farm-server-") {
			return instanceID
		}
		return "file-farm-server-" + instanceID
	}
	if host, ok := metric["host"]; ok && host != "" {
		return host
	}
	if name, ok := metric["name"]; ok && name != "" {
		return name
	}
	instance, ok := metric["instance"]
	if !ok || instance == "" {
		return ""
	}
	if portSep := strings.LastIndex(instance, ":"); portSep > 0 {
		instance = instance[:portSep]
	}
	return instance
}

func lookupServerValue(results map[string]map[string]float64, metric, name string) (float64, bool) {
	values, ok := results[metric]
	if !ok {
		return 0, false
	}
	value, ok := values[name]
	return value, ok
}

func lookupServerValueOrZero(results map[string]map[string]float64, metric, name string) float64 {
	value, _ := lookupServerValue(results, metric, name)
	return finiteFloat(value)
}

func finiteFloat(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return value
}
