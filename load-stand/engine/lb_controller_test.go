package engine

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBalancerConfigurationAndSelectionProxy(t *testing.T) {
	selected := "ema"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/algorithms":
			json.NewEncoder(w).Encode(BalancerConfiguration{
				Algorithms: []BalancerAlgorithm{{ID: "ema", Name: "EMA"}},
				Selected:   selected,
			})
		case "/api/algorithm":
			var request map[string]string
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			selected = request["algorithm"]
			json.NewEncoder(w).Encode(BalancerConfiguration{Selected: selected})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	engine := &Engine{loadBalancerURL: server.URL}

	configuration, err := engine.GetBalancerConfiguration(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if configuration.Selected != "ema" || len(configuration.Algorithms) != 1 {
		t.Fatalf("unexpected balancer configuration: %+v", configuration)
	}
	if err := engine.SetBalancerAlgorithm(context.Background(), "round_robin"); err != nil {
		t.Fatal(err)
	}
	if selected != "round_robin" {
		t.Fatalf("expected round_robin selection, got %s", selected)
	}
}