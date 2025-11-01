# Environment Variables Guide

## Overview

The project uses a centralized environment configuration system with templates and automatic generation.

## Structure

```
file-farm/
├── .env.development.example    # Development template
├── .env.production.example     # Production template
├── .env                        # Root .env (generated, not in git)
├── server/.env                 # Server-specific .env (generated)
├── postgres/.env               # Postgres-specific .env (generated)
└── envoy/.env                  # Envoy-specific .env (generated)
```

## How It Works

### 1. Templates

Environment templates are stored in `.env.*.example` files:
- `.env.development.example` - For development environment
- `.env.production.example` - For production environment

These files are committed to git and serve as templates.

### 2. Generation Script

The `scripts/generate-env.sh` script:
- Reads template based on environment (development/production)
- Creates root `.env` file if it doesn't exist
- Creates service-specific `.env` files in each service directory
- Adds service-specific variables where needed

### 3. Docker Compose Loading

Each `docker-compose.yml` is configured to load environment variables in this order:
1. **Service-specific `.env`** (e.g., `server/.env`) - Takes priority
2. **Root `.env`** - Fallback for common variables

This allows:
- Common variables in root `.env`
- Service-specific overrides in service `.env` files

## Usage

### Generate Environment Files

```bash
# Development (default)
make env

# Or explicitly
make env ENV=development

# Production
make env ENV=production
```

The script will:
- Create root `.env` if it doesn't exist
- Create service-specific `.env` files if they don't exist
- Use existing files if they're already present

### Using with Make Commands

All build/rebuild/up commands automatically generate .env files:

```bash
# Build with development config (default)
make build

# Build with production config
make build ENV=production

# Start services with production config
make up ENV=production
```

### Manual Generation

You can also run the script directly:

```bash
# Development
./scripts/generate-env.sh development

# Production
./scripts/generate-env.sh production
```

## Environment Variables Priority

When docker-compose loads environment variables:

1. **Service `.env` file** (highest priority)
2. **Root `.env` file** (fallback)
3. **Default values** in docker-compose.yml (lowest priority)

Example:
```yaml
environment:
  GRPC_PORT: ${GRPC_PORT:-50051}  # Uses .env if exists, else defaults to 50051
```

## Variables

### Common Variables (all services)

- `ENVIRONMENT` - Environment name (development/production)
- `POSTGRES_USER` - PostgreSQL username
- `POSTGRES_PASSWORD` - PostgreSQL password
- `POSTGRES_DB` - PostgreSQL database name
- `POSTGRES_PORT` - PostgreSQL port
- `POSTGRES_HOST` - PostgreSQL host
- `DATABASE_URL` - Full database connection URL

### Server-Specific

- `GRPC_PORT` - gRPC server port
- `GRPC_PROTO_FILE` - Path to proto file
- `FILES_DIR` - Directory for uploaded files
- `MONGODB_URI` - MongoDB connection string (optional)

## Best Practices

1. **Never commit `.env` files** - They are in `.gitignore`
2. **Update templates** - Modify `.env.*.example` files and regenerate
3. **Service-specific overrides** - Add them to service `.env` files
4. **Review generated files** - Always check generated `.env` files after generation

## Troubleshooting

### Variables not loading?

1. Check if `.env` files exist: `ls -la server/.env postgres/.env`
2. Regenerate: `make env ENV=development`
3. Check docker-compose logs: `docker-compose logs`

### Wrong environment?

Make sure you're using the correct ENV parameter:
```bash
make env ENV=production  # Not just "make env"
```

### Template not found?

Ensure template files exist:
```bash
ls -la .env.*.example
```

