#!/bin/bash

set -e

ENV=${1:-development}

if [[ ! "$ENV" =~ ^(development|production)$ ]]; then
    echo "Error: Environment must be 'development' or 'production'"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_FILE="$PROJECT_ROOT/.env.${ENV}.example"
ROOT_ENV_FILE="$PROJECT_ROOT/.env"

if [ ! -f "$TEMPLATE_FILE" ]; then
    echo "Error: Template file not found: ${TEMPLATE_FILE}"
    exit 1
fi

if [ ! -f "$ROOT_ENV_FILE" ]; then
    cp "$TEMPLATE_FILE" "$ROOT_ENV_FILE"
    echo "Created: ${ROOT_ENV_FILE}"
fi

for SERVICE in server postgres envoy client; do
    SERVICE_DIR="$PROJECT_ROOT/$SERVICE"
    SERVICE_ENV_FILE="$SERVICE_DIR/.env"
    
    [ ! -d "$SERVICE_DIR" ] && continue
    [ -f "$SERVICE_ENV_FILE" ] && continue
    
    cp "$TEMPLATE_FILE" "$SERVICE_ENV_FILE"
    
    case "$SERVICE" in
        server)
            echo "" >> "$SERVICE_ENV_FILE"
            echo "# Server-specific" >> "$SERVICE_ENV_FILE"
            echo "FILES_DIR=/src/uploads" >> "$SERVICE_ENV_FILE"
            ;;
        client)
            echo "" >> "$SERVICE_ENV_FILE"
            echo "# Client-specific" >> "$SERVICE_ENV_FILE"
            echo "VITE_API_URL=\${CLIENT_API_URL:-http://localhost:8080}" >> "$SERVICE_ENV_FILE"
            ;;
    esac
    
    echo "Created: ${SERVICE_ENV_FILE}"
done

echo "Environment files generated for: ${ENV}"
