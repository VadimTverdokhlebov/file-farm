package main

import (
	"log"
	"net/http"

	"load-stand/api"
	"load-stand/engine"
)

const (
	httpPort = ":8081"         // Порт для дашборда
	protoDir = "../protos"        // Директория с .proto файлами
	grpcTarget = "localhost:8080" // Цель для gRPC нагрузки
	// grpcTarget = "envoy:8080" // using docker
)

func main() {
	// Инициализируем ядро нагрузочного стенда
	loadEngine, err := engine.NewEngine(grpcTarget, protoDir)
	if err != nil {
		log.Fatalf("Не удалось запустить движок: %v", err)
	}

	// Инициализируем обработчик API
	apiHandler := api.NewHandler(loadEngine)

	// Настраиваем маршруты
	mux := http.NewServeMux()
	mux.HandleFunc("/api/endpoints", apiHandler.HandleEndpoints)
	mux.HandleFunc("/api/start", apiHandler.HandleStart)
	mux.HandleFunc("/api/stop", apiHandler.HandleStop)
	mux.HandleFunc("/ws", apiHandler.HandleWebSocket)
	// TODO: Добавить обработчик для раздачи статических файлов вашего React-приложения

	log.Printf("Сервер нагрузочного стенда запущен на порту %s", httpPort)
	if err := http.ListenAndServe(httpPort, mux); err != nil {
		log.Fatalf("Сервер упал: %v", err)
	}
}