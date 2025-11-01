# Scripts

This directory contains utility scripts for project management.

## generate-env.sh

Generates `.env` files for each service from environment templates.

### Usage

```bash
# Generate .env files for development (default)
./scripts/generate-env.sh development

# Generate .env files for production
./scripts/generate-env.sh production
```

### How it works

1. Reads template from `.env.development.example` or `.env.production.example`
2. Creates root `.env` file if it doesn't exist
3. Creates service-specific `.env` files in:
   - `server/.env`
   - `postgres/.env`
   - `envoy/.env` (if needed)

### Environment priority

Docker Compose files are configured to load environment variables in this order:
1. Service-specific `.env` file (e.g., `server/.env`)
2. Root `.env` file (as fallback)

This allows:
- Common variables in root `.env`
- Service-specific overrides in service `.env` files

### Templates

- `.env.development.example` - Development environment template
- `.env.production.example` - Production environment template

Copy these templates and modify as needed. The script will use them to generate actual `.env` files.

