.PHONY: help env build rebuild up down logs-server logs-postgres logs-envoy logs-client clean

help:
	@echo "File Farm - gRPC File Storage Service"
	@echo ""
	@echo "Build & Run:"
	@echo "  make build            - Build all services"
	@echo "  make rebuild          - Rebuild all services (no cache)"
	@echo "  make up               - Start all services"
	@echo "  make down             - Stop all services"
	@echo ""
	@echo "Logs:"
	@echo "  make logs-server      - Server logs"
	@echo "  make logs-postgres    - Database logs"
	@echo "  make logs-envoy       - Envoy logs"
	@echo "  make logs-client      - Client logs"
	@echo ""
	@echo "Maintenance:"
	@echo "  make clean            - Remove all containers and volumes"

env:
	cp .env ./postgres/.env
	cp .env ./server/.env
	cp .env ./envoy/.env
	cp .env ./client/.env

build:
	@cd postgres && docker-compose build
	@cd server && docker-compose build
	@cd envoy && docker-compose build
	@cd client && docker-compose build

rebuild:
	@cd postgres && docker-compose build --no-cache
	@cd server && docker-compose build --no-cache
	@cd envoy && docker-compose build --no-cache
	@cd client && docker-compose build --no-cache

up:
	@cd postgres && docker-compose up -d
	@sleep 3
	@cd server && docker-compose up -d
	@cd envoy && docker-compose up -d
	@cd client && docker-compose up -d
	@echo "All services started!"

down:
	@cd client && docker-compose down
	@cd envoy && docker-compose down
	@cd server && docker-compose down
	@cd postgres && docker-compose down

logs-server:
	@cd server && docker-compose logs -f

logs-postgres:
	@cd postgres && docker-compose logs -f

logs-envoy:
	@cd envoy && docker-compose logs -f

logs-client:
	@cd client && docker-compose logs -f

clean:
	@cd client && docker-compose down -v
	@cd envoy && docker-compose down -v
	@cd server && docker-compose down -v
	@cd postgres && docker-compose down -v
	@-docker network rm appnet 2>/dev/null || true
