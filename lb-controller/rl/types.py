"""Cluster state as the AM-PPO model and the other balancers see it.

The AM-PPO input is ClusterState.to_am_ppo_feature_vector(): seven numbers per
server, so the number of servers may change.
"""

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class ServerState:
    backend_name: str
    host: str
    cpu_utilization: float
    active_requests: float
    request_rate_rps: float
    latency_p99_seconds: float
    error_rate: float
    cpu_limit_cores: float
    memory_limit_bytes: float
    is_healthy: bool
    disk_io_bytes_per_second: float = 0.0


@dataclass(frozen=True)
class ClusterState:
    servers: tuple[ServerState, ...]
    cluster_request_rate_rps: float
    step_index: int
    timestamp_unix: float
    cluster_latency_p99_seconds: float = 0.0

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


def disk_busyness(server: ServerState) -> float:
    """Disk bytes/s scaled to [0, 1] at 50 MB/s. Higher means the disk is busier."""
    return _log_scale(server.disk_io_bytes_per_second, 50_000_000.0)


def observed_server_signals(server: ServerState) -> tuple[float, float, float, float, float]:
    """CPU, idle disk, RPS, active requests, and health, on the same scale as AM-PPO.

    Disk is inverted: a busy disk is a low value. The trained weights treat a
    higher input as a reason to add weight, so the busy server loses the nudge.
    """
    return (
        _clamp(server.cpu_utilization),
        1.0 - disk_busyness(server),
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
