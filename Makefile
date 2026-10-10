help:
	@echo ""
	@echo "Setup:"
	@echo "  make init             - Install npm dependencies for server and client"
	@echo "  make build-env-dev          - Copy development .env files from examples"
	@echo "  make build-env-prod         - Copy production .env files from examples"
	@echo ""
	@echo "Build:"
	@echo "  make build            - Build all services"
	@echo "  make build-server     - Build server only"
	@echo "  make build-client     - Build client only"
	@echo "  make build-load-stand - Build load testing stand only"
	@echo "  make build-lb-controller - Build load balancer controller only"
	@echo "  make rebuild          - Rebuild all services (no cache)"
	@echo ""
	@echo "Run:"
	@echo "  make dev              - Prepare dev env, start infra, and run local services"
	@echo "  make prod             - Prepare prod env, build images, and start containers"
	@echo "  make up               - Start all services"
	@echo "  make up-server        - Start server only"
	@echo "  make up-client        - Start client only"
	@echo "  make up-envoy         - Start envoy only"
	@echo "  make up-lb-controller - Start load balancer controller only"
	@echo "  make up-postgres      - Start postgres only"
	@echo "  make up-prometheus    - Start prometheus only"
	@echo "  make up-grafana       - Start grafana only"
	@echo "  make up-cadvisor      - Start cadvisor only"
	@echo "  make up-load-stand    - Start load testing stand"
	@echo "  make down             - Stop services and permanently clear PostgreSQL data and uploads"
	@echo "  make down-server      - Stop server only"
	@echo "  make down-client      - Stop client only"
	@echo "  make down-envoy       - Stop envoy and lb-controller"
	@echo "  make down-lb-controller - Stop load balancer controller only"
	@echo "  make down-postgres    - Stop postgres only"
	@echo "  make down-prometheus  - Stop prometheus only"
	@echo "  make down-grafana     - Stop grafana only"
	@echo "  make down-cadvisor    - Stop cadvisor only"
	@echo "  make down-load-stand  - Stop load testing stand"
	@echo ""
	@echo "Logs:"
	@echo "  make logs-server      - View server logs"
	@echo "  make logs-postgres    - View database logs"
	@echo "  make logs-envoy       - View envoy logs"
	@echo "  make logs-lb-controller - View lb-controller logs"
	@echo "  make logs-client      - View client logs"
	@echo "  make logs-prometheus  - View prometheus logs"
	@echo "  make logs-grafana     - View grafana logs"
	@echo "  make logs-cadvisor    - View cadvisor logs"
	@echo "  make logs-load-stand  - View load stand logs"
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
	@echo "Initializing load-stand..."
	@echo ""
	@cd load-stand && go mod tidy
	@echo ""
	@echo "Initializing lb-controller..."
	@echo ""
	@cd lb-controller && python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
	@echo ""
	@echo "Initialization complete!"
	
build-env-dev:
	@echo ""
	@echo "Initializing environment..."
	@echo ""
	cp ./postgres/.env.development.example ./postgres/.env
	cp ./client/.env.development.example ./client/.env
	cp ./server/.env.development.example ./server/.env
	cp ./load-stand/.env.development.example ./load-stand/.env
	cp ./lb-controller/.env.development.example ./lb-controller/.env
	@echo ""
	@echo "Initialization complete!"

build-env-prod:
	@echo ""
	@echo "Initializing environment..."
	@echo ""
	cp ./postgres/.env.production.example ./postgres/.env
	cp ./client/.env.production.example ./client/.env
	cp ./server/.env.production.example ./server/.env
	cp ./load-stand/.env.production.example ./load-stand/.env
	cp ./lb-controller/.env.production.example ./lb-controller/.env
	@echo ""
	@echo "Initialization complete!"

up-server:
	@cd server && docker-compose up -d

up-client:
	@cd client && docker-compose down
	@cd client && docker-compose up -d

up-lb-controller:
	@cd lb-controller && docker-compose down
	@cd lb-controller && docker-compose up -d --build

up-load-stand:
	@cd load-stand && docker-compose down
	@cd load-stand && docker-compose up -d --build

up-envoy:
	@cd envoy && docker-compose down
	@cd envoy && docker-compose up -d

up-postgres:
	@cd postgres && docker-compose up -d
	@sleep 1

up-prometheus:
	@cd prometheus && docker-compose up -d

up-grafana:
	@cd grafana && docker-compose up -d

up-cadvisor:
	@cd cadvisor && docker-compose up -d

up:
	@make up-postgres
	@make up-server
	@make up-lb-controller
	@make up-envoy
	@make up-client
	@make up-load-stand
	@make up-prometheus
	@make up-cadvisor
	@make up-grafana

build-server:
	@cd server && docker-compose build

build-client:
	@cd client && docker-compose build

build-load-stand:
	@cd load-stand && docker-compose build

build-lb-controller:
	@cd lb-controller && docker-compose build

build:
	@make build-server
	@make build-client
	@make build-load-stand
	@make build-lb-controller

rebuild:
	@cd server && docker-compose build --no-cache
	@cd client && docker-compose build --no-cache
	@cd load-stand && docker-compose build --no-cache
	@cd lb-controller && docker-compose build --no-cache

down-server:
	@cd server && docker-compose down

down-client:
	@cd client && docker-compose down

down-lb-controller:
	@cd lb-controller && docker-compose down

down-load-stand:
	@cd load-stand && docker-compose down

down-envoy:
	@cd envoy && docker-compose down
	@make down-lb-controller

down-postgres:
	@cd postgres && docker-compose down

down-prometheus:
	@cd prometheus && docker-compose down

down-grafana:
	@cd grafana && docker-compose down

down-cadvisor:
	@cd cadvisor && docker-compose down

down:
	@make down-server
	@make down-client
	@make down-load-stand
	@make down-envoy
	@echo "Deleting PostgreSQL data volume and uploads contents..."
	@cd postgres && docker-compose down -v
	@make down-prometheus
	@make down-grafana
	@make down-cadvisor
	@find uploads -mindepth 1 -maxdepth 1 ! -name .gitignore -exec rm -rf -- {} +

restart:
	@make down
	@make build-env-prod
	@make build
	@make up

logs-server:
	@cd server && docker-compose logs -f

logs-client:
	@cd client && docker-compose logs -f

logs-lb-controller:
	@cd lb-controller && docker-compose logs -f

logs-load-stand:
	@cd load-stand && docker-compose logs -f

logs-postgres:
	@cd postgres && docker-compose logs -f

logs-envoy:
	@cd envoy && docker-compose logs -f

logs-prometheus:
	@cd prometheus && docker-compose logs -f

logs-grafana:
	@cd grafana && docker-compose logs -f

logs-cadvisor:
	@cd cadvisor && docker-compose logs -f

clean:
	@cd server && docker-compose down -v
	@cd client && docker-compose down -v
	@cd envoy && docker-compose down -v
	@cd lb-controller && docker-compose down -v
	@cd postgres && docker-compose down -v
	@cd prometheus && docker-compose down -v
	@cd grafana && docker-compose down -v
	@cd cadvisor && docker-compose down -v
	@cd load-stand && docker-compose down -v
	@-docker network rm appnet 2>/dev/null || true
