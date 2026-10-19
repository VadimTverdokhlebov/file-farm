import math
import re
import time

from config import Backend
from rl.metrics_source import MetricsSource
from rl.prometheus_client import PrometheusClient
from rl.types import ClusterState, ServerState


def cpu_utilization_ratio(usage_cores: float, limit_cores: float) -> float:
    """Fraction of the container CPU limit, not of a single core.

    Two busy workers on a 2-CPU server use about 2.0 cores, which is 100% of
    that server, not 200%.
    """
    if (
        not math.isfinite(usage_cores)
        or not math.isfinite(limit_cores)
        or usage_cores <= 0.0
        or limit_cores <= 0.0
    ):
        return 0.0
    return min(usage_cores / limit_cores, 1.0)


def validate_rate_window(window: str) -> str:
    if re.fullmatch(r"\d+[smh]", window) is None:
        raise ValueError("rate window must look like 20s, 1m, or 1h")
    return window


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
        rate_window: str = "1m",
    ) -> None:
        if len(cpu_limits) != len(backends) or len(memory_limits_bytes) != len(backends):
            raise ValueError("Capacity arrays must match backend count")

        self._backends = backends
        self._cpu_limits = cpu_limits
        self._memory_limits_bytes = memory_limits_bytes
        # Lookback only. irate uses the last two scrapes inside it, so a 1s
        # scrape becomes the last second, not an average over the whole window.
        self._rate_window = validate_rate_window(rate_window)
        self._client = PrometheusClient(prometheus_url)
        self._step_index = 0

    def fetch(
        self,
        backends: tuple[Backend, ...],
        current_weights: dict[str, int],
    ) -> ClusterState:
        del current_weights
        servers: list[ServerState] = []

        for index, backend in enumerate(backends):
            instance_id = backend_instance_id(backend)
            target_instance = f"{backend.host}:9092"
            container_name = backend.host
            active_requests = self._client.query_scalar(
                f'file_farm_grpc_active_requests{{exported_instance="{instance_id}"}}'
            )
            request_rate_rps = self._client.query_scalar(
                f'sum(irate(file_farm_grpc_requests_total{{exported_instance="{instance_id}"}}[{self._rate_window}]))'
            )
            latency_p99_seconds = self._client.query_scalar(
                "histogram_quantile(0.99, "
                f'sum by (le) (irate(file_farm_grpc_request_duration_seconds_bucket{{exported_instance="{instance_id}"}}[{self._rate_window}]))'
                ")",
                default=0.05,
            )
            error_rate = self._query_error_rate(instance_id)
            cpu_utilization = self._query_cpu_utilization(container_name, self._cpu_limits[index])
            disk_io_bytes_per_second = self._query_disk_io(container_name)
            is_healthy = self._query_is_healthy(target_instance)

            servers.append(
                ServerState(
                    backend_name=backend.name,
                    host=backend.host,
                    cpu_utilization=cpu_utilization,
                    active_requests=active_requests,
                    request_rate_rps=request_rate_rps,
                    latency_p99_seconds=latency_p99_seconds,
                    error_rate=error_rate,
                    cpu_limit_cores=self._cpu_limits[index],
                    memory_limit_bytes=self._memory_limits_bytes[index],
                    is_healthy=is_healthy,
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
            f'sum(irate(file_farm_grpc_requests_total{{exported_instance="{instance_id}",status="error"}}[{self._rate_window}]))'
        )
        total = self._client.query_scalar(
            f'sum(irate(file_farm_grpc_requests_total{{exported_instance="{instance_id}"}}[{self._rate_window}]))'
        )
        if total <= 0.0:
            return 0.0
        return min(errors / total, 1.0)

    def _query_cpu_utilization(self, container_name: str, cpu_limit: float) -> float:
        # cpu="total" is one series per container. Summing it with per-mode series
        # would count the same cores twice and push a 2-CPU server over 100%.
        # An empty irate (one scrape in the window) is a missed sample, not 0%.
        # Fall back only then. A real 0.0 means two scrapes and a flat counter.
        usage = self._client.query_optional(
            "max(irate(container_cpu_usage_seconds_total"
            f'{{name="{container_name}",cpu="total"}}[{self._rate_window}]))'
        )
        if usage is None:
            usage = self._client.query_optional(
                "max(irate(container_cpu_usage_seconds_total"
                f'{{name="{container_name}"}}[{self._rate_window}]))'
            )
        if usage is None:
            return math.nan
        measured_limit = self._query_cpu_limit_cores(container_name)
        limit = measured_limit if measured_limit > 0.0 else cpu_limit
        return cpu_utilization_ratio(usage, limit)

    def _query_cpu_limit_cores(self, container_name: str) -> float:
        quota = self._client.query_scalar(
            f'max(container_spec_cpu_quota{{name="{container_name}"}})'
        )
        period = self._client.query_scalar(
            f'max(container_spec_cpu_period{{name="{container_name}"}})'
        )
        if quota <= 0.0 or period <= 0.0:
            return 0.0
        return quota / period

    def _query_disk_io(self, container_name: str) -> float:
        return self._client.query_scalar(
            "sum(irate(container_fs_reads_bytes_total"
            f'{{name="{container_name}"}}[{self._rate_window}])) + '
            "sum(irate(container_fs_writes_bytes_total"
            f'{{name="{container_name}"}}[{self._rate_window}]))'
        )

    def _query_is_healthy(self, target_instance: str) -> bool:
        return self._client.query_scalar(
            f'up{{job="server",instance="{target_instance}"}}',
            default=1.0,
        ) > 0.0

    def _query_cluster_latency_p99(self) -> float:
        return self._client.query_scalar(
            "histogram_quantile(0.99, "
            f'sum by (le) (irate(file_farm_grpc_request_duration_seconds_bucket{{job="server"}}[{self._rate_window}]))'
            ")",
            default=0.05,
        )
