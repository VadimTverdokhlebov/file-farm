import client from 'prom-client';
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

export function recordGrpcRequestStart(): void {
    grpcActiveRequests.inc();
}

export function recordGrpcRequestEnd(method: string, status: 'ok' | 'error'): void {
    grpcRequestsTotal.inc({ method, status });
    grpcActiveRequests.dec();
}

export function startMetricsServer(port: number): void {
    const server = http.createServer(async (req, res) => {
        if (req.url === '/metrics') {
            res.setHeader('Content-Type', register.contentType);
            res.end(await register.metrics());
            return;
        }

        res.statusCode = 404;
        res.end();
    });

    server.listen(port, '0.0.0.0', () => {
        logger.info(`Metrics server listening on 0.0.0.0:${port} (instance ${instanceId})`);
    });
}
