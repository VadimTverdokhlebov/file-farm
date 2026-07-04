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


@dataclass(frozen=True)
class ClusterState:
    servers: tuple[ServerState, ...]
    cluster_request_rate_rps: float
    step_index: int
    timestamp_unix: float

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


@dataclass(frozen=True)
class ModelAction:
    raw_logits: tuple[float, ...]
    weights: dict[str, int]
    explored: bool
