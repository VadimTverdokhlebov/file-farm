import 'reflect-metadata';
import * as grpc from '@grpc/grpc-js';
import logger from './utils/logger';
import getServer from './app';
import { ENVIRONMENT, GRPC_PORT } from './utils/secrets';
import { initializeDatabase, closeDatabase } from './db';

(async () => {
    try {
        // Initialize database connection
        await initializeDatabase();

        // Initialize gRPC server
        const server = getServer();
        server.bindAsync(`0.0.0.0:${GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
            if (err) {
                logger.error(err);
                process.exit(1);
            } else {
                server.start();
                logger.info(`Server running at http://127.0.0.1:${GRPC_PORT} in ${ENVIRONMENT} mode.`);
            }
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            logger.info('Shutting down gracefully...');
            server.forceShutdown();
            await closeDatabase();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            logger.info('Shutting down gracefully...');
            server.forceShutdown();
            await closeDatabase();
            process.exit(0);
        });
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
})();
