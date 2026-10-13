package api

import (
	"encoding/json"
	"load-stand/engine"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Handler struct {
	engine *engine.Engine
}

func NewHandler(e *engine.Engine) *Handler {
	return &Handler{engine: e}
}

type wsCommand struct {
	Action  string            `json:"action"`
	Payload engine.TestConfig `json:"payload"`
}

type jsonStats struct {
	SuccessfulRequests int64                       `json:"successfulRequests"`
	FailedRequests     int64                       `json:"failedRequests"`
	EndpointStats      map[string]map[string]int64 `json:"endpointStats,omitempty"`
	Report             *engine.TestMetrics         `json:"report,omitempty"`
	Servers            []engine.ServerStatus       `json:"Servers,omitempty"`
	ElapsedSeconds     int                         `json:"elapsedSeconds"`
	DurationSeconds    int                         `json:"durationSeconds"`
	WaveIteration      int                         `json:"waveIteration"`
	WaveIndex          int                         `json:"waveIndex"`
	WaveCount          int                         `json:"waveCount"`
	WaveIterations     int                         `json:"waveIterations"`
}

func (h *Handler) HandleEndpoints(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.engine.GetAvailableMethods())
}

func (h *Handler) HandlePresets(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(engine.GetPresets())
}

func (h *Handler) HandleAlgorithms(w http.ResponseWriter, r *http.Request) {
	configuration, err := h.engine.GetBalancerConfiguration(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(configuration)
}

func (h *Handler) HandleServerPower(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	name := strings.TrimPrefix(r.URL.Path, "/api/servers/")
	var body struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.engine.SetServerPower(r.Context(), name, body.Action); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"name": name, "action": body.Action})
}

func (h *Handler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}
	defer conn.Close()

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	done := make(chan struct{})
	defer close(done)

	go func() {
		for {
			select {
			case <-ticker.C:
				isRunning, stats := h.engine.GetStatus()
				body, err := json.Marshal(map[string]interface{}{
					"type": "status",
					"payload": map[string]interface{}{
						"isRunning": isRunning,
						"stats": jsonStats{
							SuccessfulRequests: stats.SuccessfulRequests,
							FailedRequests:     stats.FailedRequests,
							EndpointStats:      stats.EndpointStats,
							Report:             stats.Report,
							Servers:            stats.Servers,
							ElapsedSeconds:     stats.ElapsedSeconds,
							DurationSeconds:    stats.DurationSeconds,
							WaveIteration:      stats.WaveIteration,
							WaveIndex:          stats.WaveIndex,
							WaveCount:          stats.WaveCount,
							WaveIterations:     stats.WaveIterations,
						},
					},
				})
				if err != nil {
					log.Printf("status encode error: %v", err)
					continue
				}
				if err := conn.WriteMessage(websocket.TextMessage, body); err != nil {
					return
				}
			case <-done:
				return
			}
		}
	}()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var cmd wsCommand
		if err := json.Unmarshal(message, &cmd); err != nil {
			log.Println("JSON parse error:", err)
			continue
		}

		switch cmd.Action {
		case "start":
			if err := h.engine.StartTest(cmd.Payload); err != nil {
				conn.WriteJSON(map[string]interface{}{
					"type":    "error",
					"payload": map[string]string{"message": err.Error()},
				})
			}
		case "stop":
			h.engine.StopTest()
		}
	}
}
