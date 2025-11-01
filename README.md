# File Farm

gRPC-based file storage service with React frontend.

## Quick Start

### 1. Install Environment Variables

```bash
# Development (default)
make env

# Production
make env ENV=production
```

This generates `.env` files from templates (`.env.development.example` or `.env.production.example`).

### 2. Start Services

```bash
# Start all services (automatically generates env if needed)
make up

# Or with specific environment
make up ENV=production
```

### 3. Stop Services

```bash
make down
```

## Available Commands

```bash
make env              # Generate .env files (development)
make env ENV=production # Generate .env files (production)
make up               # Start all services
make down             # Stop all services
make build            # Build all Docker images
make rebuild          # Rebuild all Docker images (no cache)
make logs-server      # View server logs
make logs-postgres    # View database logs
make logs-envoy       # View envoy logs
make logs-client      # View client logs
make clean            # Remove all containers, volumes, networks
```

## Project Structure

```
file-farm/
├── server/          # gRPC server (TypeScript, TypeORM, PostgreSQL)
├── client/          # React frontend
├── postgres/        # PostgreSQL database service
├── envoy/           # gRPC-Web proxy
├── protos/          # Protocol Buffer definitions
└── uploads/         # Uploaded files storage
```

## Environment Variables

Templates are located in root:
- `.env.development.example` - Development configuration
- `.env.production.example` - Production configuration

Generated `.env` files are created in:
- `.env` (root)
- `server/.env`
- `postgres/.env`
- `envoy/.env`
- `client/.env`

## Development

### Run Client Locally (Dev Mode)

```bash
cd client
npm install
npm run dev
# Client will be available at http://localhost:5173
```

### Generate Proto Files

```bash
# Server
cd server && npm run gen:proto

# Client
cd client && npm run gen:proto
```

## Access Points

- **Client**: http://localhost:5173
- **Envoy Proxy**: http://localhost:8080
- **gRPC Server**: localhost:50051
- **PostgreSQL**: localhost:5432

## Requirements

- Docker & Docker Compose
- Make
- Node.js 16+ (for local development)
