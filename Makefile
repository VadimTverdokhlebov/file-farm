help:
	@echo ""
	@echo "Setup:"
	@echo "  make init             - Install npm dependencies for server and client"
	@echo "  make env-dev          - Copy development .env files from examples"
	@echo "  make env-prod         - Copy production .env files from examples"
	@echo ""
	@echo "Build:"
	@echo "  make build            - Build all services"
	@echo "  make build-server     - Build server only"
	@echo "  make build-client     - Build client only"
	@echo "  make build-envoy      - Build envoy only"
	@echo "  make build-postgres   - Build postgres only"
	@echo "  make rebuild          - Rebuild all services (no cache)"
	@echo ""
	@echo "Run:"
	@echo "  make up               - Start all services"
	@echo "  make up-server        - Start server only"
	@echo "  make up-client        - Start client only"
	@echo "  make up-envoy         - Start envoy only"
	@echo "  make up-postgres      - Start postgres only"
	@echo "  make up-prometheus    - Start prometheus only"
	@echo "  make down             - Stop all services"
	@echo "  make down-server      - Stop server only"
	@echo "  make down-client      - Stop client only"
	@echo "  make down-envoy       - Stop envoy only"
	@echo "  make down-postgres    - Stop postgres only"
	@echo "  make down-prometheus  - Stop prometheus only"
	@echo ""
	@echo "Logs:"
	@echo "  make logs-server      - View server logs"
	@echo "  make logs-postgres    - View database logs"
	@echo "  make logs-envoy       - View envoy logs"
	@echo "  make logs-client      - View client logs"
	@echo "  make logs-prometheus  - View prometheus logs"
	@echo ""
	@echo "Maintenance:"
	@echo "  make clean            - Remove all containers, volumes and networks"

init:
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
	@echo ""
	
env-dev:
	@echo ""
	@echo "Initializing environment..."
	@echo ""
	cp ./postgres/.env.development.example ./postgres/.env
	cp ./client/.env.development.example ./client/.env
	cp ./server/.env.development.example ./server/.env
	@echo ""
	@echo "Initialization complete!"

env-prod:
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
	@sleep 1

up-prometheus:
	@cd prometheus && docker-compose up -d

up:
	@make up-postgres
	@make up-server
	@make up-envoy
	@make up-client
	@make up-prometheus

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

down-prometheus:
	@cd prometheus && docker-compose down

down:
	@make down-server
	@make down-client
	@make down-envoy
	@make down-postgres
	@make down-prometheus

logs-server:
	@cd server && docker-compose logs -f

logs-postgres:
	@cd postgres && docker-compose logs -f

logs-envoy:
	@cd envoy && docker-compose logs -f

logs-client:
	@cd client && docker-compose logs -f

logs-prometheus:
	@cd prometheus && docker-compose logs -f

clean:
	@cd server && docker-compose down -v
	@cd client && docker-compose down -v
	@cd envoy && docker-compose down -v
	@cd postgres && docker-compose down -v
	@cd prometheus && docker-compose down -v
	@-docker network rm appnet 2>/dev/null || true
