package main

import (
	"fmt"
	"log"
	"net/http"

	"load-stand/api"
	"load-stand/config"
	"load-stand/engine"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func main() {
	cfg := config.New()

	loadEngine, err := engine.NewEngine(cfg.GrpcTarget, cfg.ProtoDir, cfg.EnvoyAdminURL, cfg.LoadBalancerURL, cfg.PrometheusURL, cfg.DockerSocket)
	if err != nil {
		log.Fatalf("Failed to start load engine: %v", err)
	}

	apiHandler := api.NewHandler(loadEngine)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/endpoints", apiHandler.HandleEndpoints)
	mux.HandleFunc("/api/presets", apiHandler.HandlePresets)
	mux.HandleFunc("/api/algorithms", apiHandler.HandleAlgorithms)
	mux.HandleFunc("/api/series", apiHandler.HandleSeries)
	mux.HandleFunc("/api/series/runs/", apiHandler.HandleSeriesServers)
	mux.HandleFunc("/api/servers/", apiHandler.HandleServerPower)
	mux.HandleFunc("/ws", apiHandler.HandleWebSocket)
	mux.Handle("/metrics", promhttp.Handler())

	listenAddr := fmt.Sprintf(":%d", cfg.HttpPort)
	log.Printf("Load stand server listening at http://localhost%s", listenAddr)
	if err := http.ListenAndServe(listenAddr, withCORS(mux)); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
