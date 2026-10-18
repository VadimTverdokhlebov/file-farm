"""RL state/action types for the DQN load balancer.

Model input (ClusterState.to_feature_vector):
    Per backend, in BACKENDS order:
        cpu_utilization          [0, 1]
        cpu_throttling_rate      [0, 1]
        memory_utilization       [0, 1]
        active_requests          >= 0 (raw count)
        request_rate_rps         >= 0
        latency_p99_seconds      >= 0
        error_rate               [0, 1]
        cpu_limit_cores          > 0 (static capacity hint)
        memory_limit_bytes       > 0
        is_healthy               0.0 or 1.0
        current_weight_share     [0, 1] (w_i / sum(w))
    Global tail:
        cluster_request_rate_rps >= 0

Model output (ModelAction):
    raw_logits: tuple[float, ...]  # one logit per backend, length N
    weights: dict[host, int]       # Envoy EDS load_balancing_weight, sum ~= WEIGHT_TOTAL
"""

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class ServerState:
    backend_name: str
    host: str
    cpu_utilization: float
    cpu_throttling_rate: float
    memory_utilization: float
    active_requests: float
    request_rate_rps: float
    latency_p99_seconds: float
    error_rate: float
    cpu_limit_cores: float
    memory_limit_bytes: float
    is_healthy: bool
    current_weight_share: float
    disk_io_bytes_per_second: float = 0.0


@dataclass(frozen=True)
class ClusterState:
    servers: tuple[ServerState, ...]
    cluster_request_rate_rps: float
    step_index: int
    timestamp_unix: float
    cluster_latency_p99_seconds: float = 0.0

    @property
    def dimension(self) -> int:
        # 11 features per server + 1 global feature.
        return len(self.servers) * 11 + 1

    def to_feature_vector(self) -> list[float]:
        features: list[float] = []
        for server in self.servers:
            features.extend(
                [
                    server.cpu_utilization,
                    server.cpu_throttling_rate,
                    server.memory_utilization,
                    server.active_requests,
                    server.request_rate_rps,
                    server.latency_p99_seconds,
                    server.error_rate,
                    server.cpu_limit_cores,
                    server.memory_limit_bytes,
                    1.0 if server.is_healthy else 0.0,
                    server.current_weight_share,
                ]
            )
        features.append(self.cluster_request_rate_rps)
        return features

    def to_am_ppo_feature_vector(self) -> list[float]:
        """Per-server observed state. Length is 7 * N, so N may change.

        Utilization stays a fraction of the server's own limit. The CPU and
        memory limits themselves are added as shares of the current cluster,
        so a 2-core server is distinguishable from a 0.5-core one.
        """
        cpu_shares = _limit_shares([server.cpu_limit_cores for server in self.servers])
        memory_shares = _limit_shares([server.memory_limit_bytes for server in self.servers])
        features: list[float] = []

        for index, server in enumerate(self.servers):
            features.extend(observed_server_signals(server))
            features.append(cpu_shares[index])
            features.append(memory_shares[index])

        return features


def observed_server_signals(server: ServerState) -> tuple[float, float, float, float, float]:
    """CPU, disk, RPS, active requests, and health, on the same scale as AM-PPO."""
    return (
        _clamp(server.cpu_utilization),
        _log_scale(server.disk_io_bytes_per_second, 50_000_000.0),
        _log_scale(server.request_rate_rps, 100.0),
        _log_scale(server.active_requests, 100.0),
        1.0 if server.is_healthy else 0.0,
    )


def _limit_shares(limits: list[float]) -> list[float]:
    """Share of each positive limit in the current cluster. Sums to 1."""
    cleaned = [
        float(limit) if math.isfinite(limit) and limit > 0.0 else 0.0
        for limit in limits
    ]
    total = sum(cleaned)
    if total <= 0.0:
        return [0.0] * len(cleaned)
    return [limit / total for limit in cleaned]


def _clamp(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return min(max(value, 0.0), 1.0)


def _log_scale(value: float, scale: float) -> float:
    if not math.isfinite(value) or value <= 0.0:
        return 0.0
    return min(math.log1p(value) / math.log1p(scale), 1.0)


@dataclass(frozen=True)
class ModelAction:
    raw_logits: tuple[float, ...]
    weights: dict[str, int]
    explored: bool
