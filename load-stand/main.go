package main

import (
	"fmt"
	"log"
	"net/http"

	"load-stand/api"
	"load-stand/config"
	"load-stand/engine"
)

func main() {
	cfg := config.New()

	loadEngine, err := engine.NewEngine(cfg.GrpcTarget, cfg.ProtoDir)
	if err != nil {
		log.Fatalf("Error start load engine engine: %v", err)
	}

	apiHandler := api.NewHandler(loadEngine)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/endpoints", apiHandler.HandleEndpoints)
	mux.HandleFunc("/ws", apiHandler.HandleWebSocket)

	listenAddr := fmt.Sprintf(":%d", cfg.HttpPort)
	log.Printf("Load stand server listening at http://localhost%s", listenAddr)
	if err := http.ListenAndServe(listenAddr, mux); err != nil {
		log.Fatalf("Error start server: %v", err)
	}
}
