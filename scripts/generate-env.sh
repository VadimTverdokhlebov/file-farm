#!/bin/bash

# Script to generate .env files for each service from templates
# Usage: ./scripts/generate-env.sh [development|production]
# Default: development

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get environment from argument or default to development
ENV=${1:-development}

# Validate environment
if [[ ! "$ENV" =~ ^(development|production)$ ]]; then
    echo -e "${RED}Error: Environment must be 'development' or 'production'${NC}"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TEMPLATE_FILE="$PROJECT_ROOT/.env.${ENV}.example"
ROOT_ENV_FILE="$PROJECT_ROOT/.env"

echo -e "${GREEN}Generating .env files for environment: ${ENV}${NC}"

# Check if template exists
if [ ! -f "$TEMPLATE_FILE" ]; then
    echo -e "${RED}Error: Template file not found: ${TEMPLATE_FILE}${NC}"
    exit 1
fi

# Create root .env from template if it doesn't exist
if [ ! -f "$ROOT_ENV_FILE" ]; then
    echo -e "${YELLOW}Creating root .env from template...${NC}"
    cp "$TEMPLATE_FILE" "$ROOT_ENV_FILE"
    echo -e "${GREEN}Created: ${ROOT_ENV_FILE}${NC}"
    echo -e "${YELLOW}Please review and update values in ${ROOT_ENV_FILE}${NC}"
else
    echo -e "${GREEN}Root .env file already exists: ${ROOT_ENV_FILE}${NC}"
fi

# Generate .env files for each service
SERVICES=("server" "postgres" "envoy")

for SERVICE in "${SERVICES[@]}"; do
    SERVICE_DIR="$PROJECT_ROOT/$SERVICE"
    SERVICE_ENV_FILE="$SERVICE_DIR/.env"
    
    if [ ! -d "$SERVICE_DIR" ]; then
        echo -e "${YELLOW}Skipping ${SERVICE}: directory not found${NC}"
        continue
    fi
    
    # If service .env doesn't exist, create it from root template
    if [ ! -f "$SERVICE_ENV_FILE" ]; then
        echo -e "${GREEN}Creating .env for ${SERVICE}...${NC}"
        cp "$TEMPLATE_FILE" "$SERVICE_ENV_FILE"
        
        # Add service-specific variables if needed
        case "$SERVICE" in
            server)
                echo "" >> "$SERVICE_ENV_FILE"
                echo "# Server-specific variables" >> "$SERVICE_ENV_FILE"
                if [ "$ENV" = "development" ]; then
                    echo "FILES_DIR=./uploads" >> "$SERVICE_ENV_FILE"
                else
                    echo "FILES_DIR=/src/uploads" >> "$SERVICE_ENV_FILE"
                fi
                ;;
            postgres)
                echo "" >> "$SERVICE_ENV_FILE"
                echo "# PostgreSQL-specific variables" >> "$SERVICE_ENV_FILE"
                ;;
            envoy)
                echo "" >> "$SERVICE_ENV_FILE"
                echo "# Envoy-specific variables" >> "$SERVICE_ENV_FILE"
                ;;
        esac
        
        echo -e "${GREEN}Created: ${SERVICE_ENV_FILE}${NC}"
    else
        echo -e "${GREEN}.env for ${SERVICE} already exists: ${SERVICE_ENV_FILE}${NC}"
    fi
done

echo -e "${GREEN}Environment files generation complete!${NC}"
echo -e "${YELLOW}Note: Review and update values in generated .env files as needed.${NC}"

