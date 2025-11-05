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

init-development:
	@echo ""
	@echo "Initializing environment..."
	@echo ""
	cp ./postgres/.env.development.example ./postgres/.env
	cp ./client/.env.development.example ./client/.env
	cp ./server/.env.development.example ./server/.env
	@echo ""
	@echo "Initializing server..."
	@echo ""
	@cd server && npm ci
	@echo ""
	@echo "Initializing client..."
	@echo ""
	@cd client && npm ci
	@echo ""
	@echo "Initialization complete!"

init-production:
	@echo ""
	@echo "Initializing environment..."
	@echo ""
	cp ./postgres/.env.production.example ./postgres/.env
	cp ./client/.env.production.example ./client/.env
	cp ./server/.env.production.example ./server/.env
	@echo ""
	@echo "Initialization complete!"

up-server:
	@cd server && docker-compose up -d

up-client:
	@cd client && docker-compose up -d

up-envoy:
	@cd envoy && docker-compose up -d

up-postgres:
	@cd postgres && docker-compose up -d
	@sleep 2

up:
	@make up-postgres
	@make up-server
	@make up-envoy
	@make up-client

build-server:
	@cd server && docker-compose build

build-client:
	@cd client && docker-compose build

build-envoy:
	@cd envoy && docker-compose build

build-postgres:
	@cd postgres && docker-compose build

build:
	@make build-server
	@make build-client
	@make build-envoy
	@make build-postgres

rebuild:
	@cd server && docker-compose build --no-cache
	@cd client && docker-compose build --no-cache
	@cd envoy && docker-compose build --no-cache
	@cd postgres && docker-compose build --no-cache

down-server:
	@cd server && docker-compose down

down-client:
	@cd client && docker-compose down

down-envoy:
	@cd envoy && docker-compose down

down-postgres:
	@cd postgres && docker-compose down

down:
	@make down-server
	@make down-client
	@make down-envoy
	@make down-postgres

logs-server:
	@cd server && docker-compose logs -f

logs-postgres:
	@cd postgres && docker-compose logs -f

logs-envoy:
	@cd envoy && docker-compose logs -f

logs-client:
	@cd client && docker-compose logs -f

clean:
	@cd server && docker-compose down -v
	@cd client && docker-compose down -v
	@cd envoy && docker-compose down -v
	@cd postgres && docker-compose down -v
	@-docker network rm appnet 2>/dev/null || true
