import time
from abc import ABC, abstractmethod

from config import Backend
from rl.types import ClusterState, ServerState


class MetricsSource(ABC):
    """Reads Prometheus (or other telemetry) and builds the model input state."""

    @abstractmethod
    def fetch(
        self,
        backends: tuple[Backend, ...],
        current_weights: dict[str, int],
    ) -> ClusterState:
        pass


class StubMetricsSource(MetricsSource):
    """Placeholder metrics source until Prometheus queries are implemented."""

    def __init__(
        self,
        backends: tuple[Backend, ...],
        *,
        cpu_limits: tuple[float, ...],
        memory_limits_bytes: tuple[float, ...],
    ) -> None:
        if len(cpu_limits) != len(backends) or len(memory_limits_bytes) != len(backends):
            raise ValueError("Capacity arrays must match backend count")

        self._backends = backends
        self._cpu_limits = cpu_limits
        self._memory_limits_bytes = memory_limits_bytes
        self._step_index = 0

    def fetch(
        self,
        backends: tuple[Backend, ...],
        current_weights: dict[str, int],
    ) -> ClusterState:
        del current_weights
        servers: list[ServerState] = []

        for index, backend in enumerate(backends):
            # Synthetic values make the stub observable in logs/tests.
            load_bias = 0.15 * index
            servers.append(
                ServerState(
                    backend_name=backend.name,
                    host=backend.host,
                    cpu_utilization=min(0.35 + load_bias + 0.02 * self._step_index, 0.95),
                    active_requests=float(2 + index + self._step_index % 3),
                    request_rate_rps=20.0 + 5.0 * index,
                    latency_p99_seconds=0.08 + 0.02 * index,
                    error_rate=0.0,
                    cpu_limit_cores=self._cpu_limits[index],
                    memory_limit_bytes=self._memory_limits_bytes[index],
                    is_healthy=True,
                    disk_io_bytes_per_second=1_000_000.0 * (index + 1),
                )
            )

        self._step_index += 1
        cluster_rps = sum(server.request_rate_rps for server in servers)
        return ClusterState(
            servers=tuple(servers),
            cluster_request_rate_rps=cluster_rps,
            step_index=self._step_index,
            timestamp_unix=time.time(),
            cluster_latency_p99_seconds=max(
                (server.latency_p99_seconds for server in servers),
                default=0.0,
            ),
        )
