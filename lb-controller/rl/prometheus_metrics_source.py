import time

from config import Backend
from rl.metrics_source import MetricsSource
from rl.prometheus_client import PrometheusClient
from rl.types import ClusterState, ServerState


def backend_instance_id(backend: Backend) -> str:
    return backend.name.rsplit("-", 1)[-1]


class PrometheusMetricsSource(MetricsSource):
    def __init__(
        self,
        backends: tuple[Backend, ...],
        prometheus_url: str,
        *,
        cpu_limits: tuple[float, ...],
        memory_limits_bytes: tuple[float, ...],
        cpu_limit_normalizer: float = 4.0,
    ) -> None:
        if len(cpu_limits) != len(backends) or len(memory_limits_bytes) != len(backends):
            raise ValueError("Capacity arrays must match backend count")

        self._backends = backends
        self._cpu_limits = cpu_limits
        self._memory_limits_bytes = memory_limits_bytes
        self._cpu_limit_normalizer = cpu_limit_normalizer
        self._client = PrometheusClient(prometheus_url)
        self._step_index = 0

    def fetch(
        self,
        backends: tuple[Backend, ...],
        current_weights: dict[str, int],
    ) -> ClusterState:
        weight_total = max(sum(current_weights.values()), 1)
        servers: list[ServerState] = []

        for index, backend in enumerate(backends):
            instance_id = backend_instance_id(backend)
            target_instance = f"{backend.host}:9092"
            container_name = backend.host
            active_requests = self._client.query_scalar(
                f'file_farm_grpc_active_requests{{exported_instance="{instance_id}"}}'
            )
            request_rate_rps = self._client.query_scalar(
                f'sum(rate(file_farm_grpc_requests_total{{exported_instance="{instance_id}"}}[1m]))'
            )
            latency_p99_seconds = self._client.query_scalar(
                "histogram_quantile(0.99, "
                f'sum by (le) (rate(file_farm_grpc_request_duration_seconds_bucket{{exported_instance="{instance_id}"}}[1m]))'
                ")",
                default=0.05,
            )
            error_rate = self._query_error_rate(instance_id)
            cpu_utilization = self._query_cpu_utilization(container_name, self._cpu_limits[index])
            cpu_throttling_rate = self._query_cpu_throttling(container_name)
            memory_utilization = self._query_memory_utilization(
                container_name,
                self._memory_limits_bytes[index],
            )
            disk_io_bytes_per_second = self._query_disk_io(container_name)
            is_healthy = self._query_is_healthy(target_instance)

            weight = current_weights.get(backend.host, 0)
            servers.append(
                ServerState(
                    backend_name=backend.name,
                    host=backend.host,
                    cpu_utilization=cpu_utilization,
                    cpu_throttling_rate=cpu_throttling_rate,
                    memory_utilization=memory_utilization,
                    active_requests=active_requests,
                    request_rate_rps=request_rate_rps,
                    latency_p99_seconds=latency_p99_seconds,
                    error_rate=error_rate,
                    cpu_limit_cores=self._cpu_limits[index],
                    memory_limit_bytes=self._memory_limits_bytes[index],
                    is_healthy=is_healthy,
                    current_weight_share=weight / weight_total,
                    disk_io_bytes_per_second=disk_io_bytes_per_second,
                )
            )

        self._step_index += 1
        cluster_rps = sum(server.request_rate_rps for server in servers)
        return ClusterState(
            servers=tuple(servers),
            cluster_request_rate_rps=cluster_rps,
            step_index=self._step_index,
            timestamp_unix=time.time(),
            cluster_latency_p99_seconds=self._query_cluster_latency_p99(),
        )

    def _query_error_rate(self, instance_id: str) -> float:
        errors = self._client.query_scalar(
            f'sum(rate(file_farm_grpc_requests_total{{exported_instance="{instance_id}",status="error"}}[1m]))'
        )
        total = self._client.query_scalar(
            f'sum(rate(file_farm_grpc_requests_total{{exported_instance="{instance_id}"}}[1m]))'
        )
        if total <= 0.0:
            return 0.0
        return min(errors / total, 1.0)

    def _query_cpu_utilization(self, container_name: str, cpu_limit: float) -> float:
        usage = self._client.query_scalar(
            f'rate(container_cpu_usage_seconds_total{{name="{container_name}"}}[1m])'
        )
        if cpu_limit <= 0.0:
            return 0.0
        return min(usage / cpu_limit, 1.0)

    def _query_cpu_throttling(self, container_name: str) -> float:
        throttled = self._client.query_scalar(
            f'rate(container_cpu_cfs_throttled_seconds_total{{name="{container_name}"}}[1m])'
        )
        usage = self._client.query_scalar(
            f'rate(container_cpu_usage_seconds_total{{name="{container_name}"}}[1m])',
            default=1.0,
        )
        if usage <= 0.0:
            return 0.0
        return min(throttled / usage, 1.0)

    def _query_memory_utilization(self, container_name: str, memory_limit_bytes: float) -> float:
        usage = self._client.query_scalar(
            f'container_memory_working_set_bytes{{name="{container_name}"}}'
        )
        if memory_limit_bytes <= 0.0:
            return 0.0
        return min(usage / memory_limit_bytes, 1.0)

    def _query_disk_io(self, container_name: str) -> float:
        return self._client.query_scalar(
            "sum(rate(container_fs_reads_bytes_total"
            f'{{name="{container_name}"}}[1m])) + '
            "sum(rate(container_fs_writes_bytes_total"
            f'{{name="{container_name}"}}[1m]))'
        )

    def _query_is_healthy(self, target_instance: str) -> bool:
        return self._client.query_scalar(
            f'up{{job="server",instance="{target_instance}"}}',
            default=1.0,
        ) > 0.0

    def _query_cluster_latency_p99(self) -> float:
        return self._client.query_scalar(
            "histogram_quantile(0.99, "
            'sum by (le) (rate(file_farm_grpc_request_duration_seconds_bucket{job="server"}[1m]))'
            ")",
            default=0.05,
        )
