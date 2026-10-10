import client, { AggregatorRegistry } from 'prom-client';
import http from 'http';
import logger from './logger';

export const register = new client.Registry();

const instanceId = process.env.INSTANCE_ID || 'unknown';
register.setDefaultLabels({ instance: instanceId });

client.collectDefaultMetrics({ register });

export const grpcRequestsTotal = new client.Counter({
    name: 'file_farm_grpc_requests_total',
    help: 'Total gRPC requests handled by this server instance',
    labelNames: ['method', 'status'],
    registers: [register],
});

export const grpcActiveRequests = new client.Gauge({
    name: 'file_farm_grpc_active_requests',
    help: 'Currently active gRPC requests on this server instance',
    registers: [register],
});

export const grpcRequestDurationSeconds = new client.Histogram({
    name: 'file_farm_grpc_request_duration_seconds',
    help: 'gRPC request duration in seconds',
    labelNames: ['method', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
});

export function recordGrpcRequestStart(): number {
    grpcActiveRequests.inc();
    return Date.now();
}

export function recordGrpcRequestEnd(method: string, status: 'ok' | 'error', startedAtMs: number): void {
    const durationSec = (Date.now() - startedAtMs) / 1000;
    grpcRequestDurationSeconds.observe({ method, status }, durationSec);
    grpcRequestsTotal.inc({ method, status });
    grpcActiveRequests.dec();
}

export function workerCount(): number {
    const parsed = Number.parseInt(process.env.WORKERS || '1', 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return 1;
    }
    return parsed;
}

export function enableClusterMetricsExport(): void {
    // Registers the worker listener that replies to the primary's scrape.
    new AggregatorRegistry();
    AggregatorRegistry.setRegistries(register);
}

export function startMetricsServer(port: number): void {
    listenForMetrics(port, async () => register.metrics(), register.contentType, 'Metrics server');
}

export function startAggregatedMetricsServer(port: number): void {
    const aggregator = new AggregatorRegistry();
    listenForMetrics(
        port,
        () => aggregator.clusterMetrics(),
        aggregator.contentType,
        'Aggregated metrics server',
    );
}

function listenForMetrics(
    port: number,
    readMetrics: () => Promise<string>,
    contentType: string,
    label: string,
): void {
    const server = http.createServer(async (req, res) => {
        if (req.url === '/metrics') {
            try {
                res.setHeader('Content-Type', contentType);
                res.end(await readMetrics());
            } catch (error) {
                logger.error('Failed to collect metrics', error);
                res.statusCode = 500;
                res.end();
            }
            return;
        }

        res.statusCode = 404;
        res.end();
    });

    server.listen(port, '0.0.0.0', () => {
        logger.info(`${label} listening on 0.0.0.0:${port} (instance ${instanceId})`);
    });
}
