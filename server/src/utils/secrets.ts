import logger from './logger';
import dotenv from 'dotenv';
import fs from 'fs';

if (fs.existsSync('.env')) {
    logger.debug('Using .env file to supply config environment variables');
    dotenv.config({ path: '.env' });
}

const ENVIRONMENT = process.env.ENVIRONMENT;

const POSTGRES_HOST = process.env.POSTGRES_HOST;
const POSTGRES_PORT = process.env.POSTGRES_PORT;
const POSTGRES_USER = process.env.POSTGRES_USER;
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD;
const POSTGRES_DB = process.env.POSTGRES_DB;

const GRPC_PORT = process.env.GRPC_PORT;
const GRPC_PROTO_FILE = process.env.GRPC_PROTO_FILE;

const FILES_SAVE_DIR = process.env.FILES_SAVE_DIR;
const INSTANCE_ID = process.env.INSTANCE_ID || 'unknown';
const METRICS_PORT = process.env.METRICS_PORT || '9092';


if (!FILES_SAVE_DIR) {
    logger.error('FILES_DIR is not set in the environment variables');
    process.exit(1);
}

if (!GRPC_PROTO_FILE) {
    logger.error('GRPC_PROTO_FILE is not set in .env file');
    process.exit(1);
}

if (!GRPC_PORT) {
    logger.error('GRPC_PORT is not set in the environment variables');
    process.exit(1);
}

export const config = {
    environment: ENVIRONMENT,
    postgres: {
        host: POSTGRES_HOST,
        port: POSTGRES_PORT ? parseInt(POSTGRES_PORT, 10) : 5432,
        user: POSTGRES_USER,
        password: POSTGRES_PASSWORD,
        database: POSTGRES_DB,
    },
    grpc: {
        port: GRPC_PORT,
        protoFile: GRPC_PROTO_FILE,
    },
    files: {
        dir: FILES_SAVE_DIR,
    },
    metrics: {
        port: parseInt(METRICS_PORT, 10),
        instanceId: INSTANCE_ID,
    },
};