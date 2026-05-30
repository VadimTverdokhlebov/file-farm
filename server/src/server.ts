import 'reflect-metadata';
import * as grpc from '@grpc/grpc-js';
import logger from './utils/logger';
import getServer from './app';
import { config } from './utils/secrets';
import { initializeDatabase, closeDatabase } from './db';
import { startMetricsServer } from './utils/metrics';

(async () => {
    try {
        // Initialize database connection
        await initializeDatabase();

        startMetricsServer(config.metrics.port);

        // Initialize gRPC server
        const server = getServer();
        server.bindAsync(`0.0.0.0:${config.grpc.port}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
            if (err) {
                logger.error(err);
                process.exit(1);
            } else {
                server.start();
                logger.info(`Server running at http://127.0.0.1:${config.grpc.port} in ${config.environment} mode.`);
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
