package api

import (
	"encoding/json"
	"load-stand/engine"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Для разработки разрешаем все источники
	},
}

// Handler управляет API запросами.
type Handler struct {
	engine *engine.Engine
}

func NewHandler(e *engine.Engine) *Handler {
	return &Handler{engine: e}
}

// HandleEndpoints возвращает список доступных методов.
func (h *Handler) HandleEndpoints(w http.ResponseWriter, r *http.Request) {
	endpoints := h.engine.GetAvailableMethods()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(endpoints)
}

// HandleStart запускает тест.
func (h *Handler) HandleStart(w http.ResponseWriter, r *http.Request) {
	var config engine.TestConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.engine.StartTest(config); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Тест запущен"})
}

// HandleStop останавливает тест.
func (h *Handler) HandleStop(w http.ResponseWriter, r *http.Request) {
	h.engine.StopTest()
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Тест остановлен"})
}

// Определяем "чистую" структуру для JSON
type jsonStats struct {
	SuccessfulRequests int64 `json:"successfulRequests"`
	FailedRequests     int64 `json:"failedRequests"`
}

// HandleWebSocket обрабатывает WebSocket соединения для отправки статистики.
func (h *Handler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Ошибка обновления до WebSocket:", err)
		return
	}
	defer conn.Close()

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			isRunning, stats := h.engine.GetStatus()
			
			// Создаем и заполняем "чистую" структуру
			dataToSend := map[string]interface{}{
				"isRunning": isRunning,
				"stats": jsonStats{
					SuccessfulRequests: stats.SuccessfulRequests.Load(), // Используем .Load() для получения числа
					FailedRequests:     stats.FailedRequests.Load(),     // Используем .Load() для получения числа
				},
			}

			if err := conn.WriteJSON(dataToSend); err != nil {
				// Ошибка "concurrent write to websocket connection" нормальна, если клиент отключается
				// log.Println("Ошибка отправки по WebSocket:", err)
				return
			}
		case <-r.Context().Done():
			return
		}
	}
}