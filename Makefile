.PHONY: help build rebuild rebuild-server rebuild-envoy up down restart restart-server restart-envoy logs logs-server logs-envoy clean

# Default target
help:
	@echo "Available commands:"
	@echo "  make build              - Build all services"
	@echo "  make rebuild            - Rebuild all services (no cache)"
	@echo "  make rebuild-server     - Rebuild server service (no cache)"
	@echo "  make rebuild-envoy      - Rebuild envoy service"
	@echo "  make up                 - Start all services"
	@echo "  make down               - Stop all services"
	@echo "  make restart            - Restart all services"
	@echo "  make restart-server     - Restart server service"
	@echo "  make restart-envoy      - Restart envoy service"
	@echo "  make logs               - Show logs from all services"
	@echo "  make logs-server        - Show server logs"
	@echo "  make logs-envoy         - Show envoy logs"
	@echo "  make clean              - Stop and remove all containers, networks"

# Build all services
build:
	@echo "Building server..."
	cd server && docker-compose build
	@echo "Building envoy..."
	cd envoy && docker-compose build

# Rebuild all services (no cache)
rebuild:
	@echo "Rebuilding server (no cache)..."
	cd server && docker-compose build --no-cache
	@echo "Rebuilding envoy..."
	cd envoy && docker-compose build --no-cache

# Rebuild server only (no cache)
rebuild-server:
	@echo "Rebuilding server (no cache)..."
	cd server && docker-compose build --no-cache
	cd server && docker-compose up -d

# Rebuild envoy only
rebuild-envoy:
	@echo "Rebuilding envoy..."
	cd envoy && docker-compose build --no-cache
	cd envoy && docker-compose up -d

# Start all services
up:
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

# Clean everything
clean:
	@echo "Cleaning envoy..."
	cd envoy && docker-compose down -v
	@echo "Cleaning server..."
	cd server && docker-compose down -v
	@echo "Removing appnet network if exists..."
	-docker network rm appnet 2>/dev/null || true
	@echo "Cleanup complete!"