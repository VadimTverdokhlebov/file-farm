// api/handler.go
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
		return true // Разрешаем все источники для разработки
	},
}

// Handler управляет API запросами.
type Handler struct {
	engine *engine.Engine
}

func NewHandler(e *engine.Engine) *Handler {
	return &Handler{engine: e}
}

// Определяем структуру для входящих команд от клиента
type wsCommand struct {
	Action  string               `json:"action"`
	Payload engine.TestConfig `json:"payload"`
}

// Определяем "чистую" структуру для JSON-статистики
type jsonStats struct {
	SuccessfulRequests int64 `json:"successfulRequests"`
	FailedRequests     int64 `json:"failedRequests"`
}

// HandleEndpoints по-прежнему отдает список методов по HTTP GET.
// Это удобно для первоначальной загрузки.
func (h *Handler) HandleEndpoints(w http.ResponseWriter, r *http.Request) {
	endpoints := h.engine.GetAvailableMethods()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(endpoints)
}

// HandleWebSocket теперь - наш ЕДИНСТВЕННЫЙ способ общения в реальном времени.
func (h *Handler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Ошибка обновления до WebSocket:", err)
		return
	}
	defer conn.Close()

	// Запускаем горутину для отправки статистики каждую секунду
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	// Канал для завершения горутины-отправщика
	done := make(chan struct{})
	defer close(done)

	go func() {
		for {
			select {
			case <-ticker.C:
				isRunning, stats := h.engine.GetStatus()
				dataToSend := map[string]interface{}{
					"type": "status", // Добавляем тип сообщения
					"payload": map[string]interface{}{
						"isRunning": isRunning,
						"stats": jsonStats{
							SuccessfulRequests: stats.SuccessfulRequests.Load(),
							FailedRequests:     stats.FailedRequests.Load(),
						},
					},
				}
				if err := conn.WriteJSON(dataToSend); err != nil {
					// Если клиент отключился, просто выходим из горутины
					return
				}
			case <-done:
				return
			}
		}
	}()

	// Главный цикл для чтения команд от клиента
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			// Клиент отключился, завершаем работу
			break
		}

		var cmd wsCommand
		if err := json.Unmarshal(message, &cmd); err != nil {
			log.Println("Ошибка разбора JSON команды:", err)
			continue
		}

		// Обрабатываем команду
		switch cmd.Action {
		case "start":
			log.Println("Получена команда 'start'")
			if err := h.engine.StartTest(cmd.Payload); err != nil {
				log.Printf("Ошибка при запуске теста: %v", err)
				// Можно отправить сообщение об ошибке обратно клиенту
				conn.WriteJSON(map[string]interface{}{
					"type": "error",
					"payload": map[string]string{"message": err.Error()},
				})
			}
		case "stop":
			log.Println("Получена команда 'stop'")
			h.engine.StopTest()
		default:
			log.Printf("Получена неизвестная команда: %s", cmd.Action)
		}
	}
}