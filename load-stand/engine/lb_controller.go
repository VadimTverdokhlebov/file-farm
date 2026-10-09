package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type BalancerAlgorithm struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type BalancerConfiguration struct {
	Algorithms []BalancerAlgorithm `json:"algorithms"`
	Selected   string               `json:"selected"`
}

func (e *Engine) GetBalancerConfiguration(ctx context.Context) (BalancerConfiguration, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, e.loadBalancerURL+"/api/algorithms", nil)
	if err != nil {
		return BalancerConfiguration{}, err
	}
	response, err := (&http.Client{}).Do(request)
	if err != nil {
		return BalancerConfiguration{}, fmt.Errorf("requesting load-balancer algorithms: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return BalancerConfiguration{}, fmt.Errorf("load balancer returned %s", response.Status)
	}
	var configuration BalancerConfiguration
	if err := json.NewDecoder(response.Body).Decode(&configuration); err != nil {
		return BalancerConfiguration{}, fmt.Errorf("decoding load-balancer configuration: %w", err)
	}
	return configuration, nil
}

func (e *Engine) SetBalancerAlgorithm(ctx context.Context, algorithm string) error {
	body, err := json.Marshal(map[string]string{"algorithm": algorithm})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		e.loadBalancerURL+"/api/algorithm",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{}).Do(request)
	if err != nil {
		return fmt.Errorf("selecting load-balancer algorithm: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusOK {
		return nil
	}
	message, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	return fmt.Errorf("load balancer returned %s: %s", response.Status, strings.TrimSpace(string(message)))
}