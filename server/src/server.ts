import 'reflect-metadata';
import cluster from 'cluster';
import * as grpc from '@grpc/grpc-js';
import logger from './utils/logger';
import getServer from './app';
import { config } from './utils/secrets';
import { initializeDatabase, closeDatabase } from './db';
import {
    enableClusterMetricsExport,
    startAggregatedMetricsServer,
    startMetricsServer,
    workerCount,
} from './utils/metrics';

const workers = workerCount();

if (cluster.isPrimary && workers > 1) {
    startAggregatedMetricsServer(config.metrics.port);
    logger.info(`Starting ${workers} gRPC workers for instance ${process.env.INSTANCE_ID || 'unknown'}`);

    for (let index = 0; index < workers; index += 1) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        if (signal === 'SIGTERM' || signal === 'SIGINT') {
            return;
        }
        logger.error(`gRPC worker ${worker.process.pid} exited (${signal || code}), restarting`);
        cluster.fork();
    });

    const shutdownPrimary = () => {
        for (const worker of Object.values(cluster.workers ?? {})) {
            worker?.kill('SIGTERM');
        }
        process.exit(0);
    };
    process.on('SIGTERM', shutdownPrimary);
    process.on('SIGINT', shutdownPrimary);
} else {
    if (workers > 1) {
        enableClusterMetricsExport();
    } else {
        startMetricsServer(config.metrics.port);
    }

    void startGrpcWorker();
}

async function startGrpcWorker(): Promise<void> {
    try {
        // Initialize database connection
        await initializeDatabase();

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
}
