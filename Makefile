.PHONY: help build rebuild rebuild-server rebuild-envoy rebuild-postgres up down restart restart-server restart-envoy restart-postgres logs logs-server logs-envoy logs-postgres clean env

# Default environment (can be overridden: make ENV=production build)
ENV ?= development

# Default target
help:
	@echo "Available commands:"
	@echo "  make env [ENV=development|production]  - Generate .env files from templates"
	@echo "  make build [ENV=development|production] - Build all services"
	@echo "  make rebuild [ENV=development|production] - Rebuild all services (no cache)"
	@echo "  make rebuild-server [ENV=development|production] - Rebuild server service (no cache)"
	@echo "  make rebuild-envoy      - Rebuild envoy service"
	@echo "  make rebuild-postgres   - Rebuild postgres service"
	@echo "  make up [ENV=development|production] - Start all services (postgres -> server -> envoy)"
	@echo "  make down               - Stop all services"
	@echo "  make restart            - Restart all services"
	@echo "  make restart-server     - Restart server service"
	@echo "  make restart-envoy      - Restart envoy service"
	@echo "  make restart-postgres   - Restart postgres service"
	@echo "  make logs               - Show logs from all services"
	@echo "  make logs-server        - Show server logs"
	@echo "  make logs-envoy         - Show envoy logs"
	@echo "  make logs-postgres      - Show postgres logs"
	@echo "  make clean              - Stop and remove all containers, networks, volumes"
	@echo ""
	@echo "Examples:"
	@echo "  make env ENV=development  - Generate dev environment files"
	@echo "  make build ENV=production - Build with production config"

# Generate .env files from templates
env:
	@echo "Generating .env files for environment: $(ENV)"
	@./scripts/generate-env.sh $(ENV)

# Build all services
build: env
	@echo "Building postgres..."
	cd postgres && docker-compose build
	@echo "Building server..."
	cd server && docker-compose build
	@echo "Building envoy..."
	cd envoy && docker-compose build

# Rebuild all services (no cache)
rebuild: env
	@echo "Rebuilding postgres..."
	cd postgres && docker-compose build --no-cache
	@echo "Rebuilding server (no cache)..."
	cd server && docker-compose build --no-cache
	@echo "Rebuilding envoy..."
	cd envoy && docker-compose build --no-cache

# Rebuild server only (no cache)
rebuild-server: env
	@echo "Rebuilding server (no cache)..."
	cd server && docker-compose build --no-cache
	cd server && docker-compose up -d

# Rebuild envoy only
rebuild-envoy:
	@echo "Rebuilding envoy..."
	cd envoy && docker-compose build --no-cache
	cd envoy && docker-compose up -d

# Rebuild postgres only
rebuild-postgres:
	@echo "Rebuilding postgres..."
	cd postgres && docker-compose build --no-cache
	cd postgres && docker-compose up -d

# Start all services (order: postgres -> server -> envoy)
up: env
	@echo "Starting postgres..."
	cd postgres && docker-compose up -d
	@echo "Waiting for postgres to be ready..."
	@sleep 3
	@echo "Starting server..."
	cd server && docker-compose up -d
	@echo "Starting envoy..."
	cd envoy && docker-compose up -d
	@echo "All services started!"

# Stop all services
down:
	@echo "Stopping envoy..."
	cd envoy && docker-compose down
	@echo "Stopping server..."
	cd server && docker-compose down
	@echo "Stopping postgres..."
	cd postgres && docker-compose down

# Restart all services
restart: down up

# Restart server only
restart-server:
	@echo "Restarting server..."
	cd server && docker-compose restart

# Restart envoy only
restart-envoy:
	@echo "Restarting envoy..."
	cd envoy && docker-compose restart

# Restart postgres only
restart-postgres:
	@echo "Restarting postgres..."
	cd postgres && docker-compose restart

# Show logs from all services
logs:
	@echo "Server logs:"
	cd server && docker-compose logs -f --tail=50

# Show server logs
logs-server:
	cd server && docker-compose logs -f

# Show envoy logs
logs-envoy:
	cd envoy && docker-compose logs -f

# Show postgres logs
logs-postgres:
	cd postgres && docker-compose logs -f

# Clean everything
clean:
	@echo "Cleaning envoy..."
	cd envoy && docker-compose down -v
	@echo "Cleaning server..."
	cd server && docker-compose down -v
	@echo "Cleaning postgres..."
	cd postgres && docker-compose down -v
	@echo "Removing appnet network if exists..."
	-docker network rm appnet 2>/dev/null || true
	@echo "Cleanup complete!"