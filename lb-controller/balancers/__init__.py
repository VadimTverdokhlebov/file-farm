from balancers.base import Balancer, LoadDecision
from balancers.am_ppo_balancer import AMPPOBalancer
from balancers.dqn_balancer import DqnBalancer
from balancers.ema_balancer import EmaBalancer
from balancers.factory import create_metrics_source, parse_capacity_lists
from balancers.least_request_balancer import LeastRequestBalancer
from balancers.round_robin import RoundRobinBalancer
from balancers.weighted_round_robin import WeightedRoundRobinBalancer
from config import DQN_EPSILON, DQN_MODEL_PATH, DQN_WEIGHT_TOTAL, EMA_ALPHA

__all__ = [
    "Balancer",
    "AMPPOBalancer",
    "DqnBalancer",
    "EmaBalancer",
    "LeastRequestBalancer",
    "LoadDecision",
    "RoundRobinBalancer",
    "WeightedRoundRobinBalancer",
    "create_balancer",
]


def create_balancer(algorithm: str, backends, *, backend_weights: str = "100,100,100") -> Balancer:
    if algorithm == "round_robin":
        return RoundRobinBalancer(backends)

    if algorithm == "weighted_round_robin":
        return WeightedRoundRobinBalancer(backends, backend_weights)

    if algorithm == "ema":
        return EmaBalancer(
            backends,
            create_metrics_source(backends),
            weight_total=DQN_WEIGHT_TOTAL,
            alpha=EMA_ALPHA,
        )

    if algorithm in {"least_request", "least_connections"}:
        return LeastRequestBalancer(
            backends,
            create_metrics_source(backends),
            weight_total=DQN_WEIGHT_TOTAL,
        )

    if algorithm == "dqn":
        cpu_limits, memory_limits_bytes = parse_capacity_lists(backends)
        return DqnBalancer(
            backends,
            metrics_source=create_metrics_source(backends),
            weight_total=DQN_WEIGHT_TOTAL,
            epsilon=DQN_EPSILON,
            model_path=DQN_MODEL_PATH or None,
            cpu_limits=cpu_limits,
            memory_limits_bytes=memory_limits_bytes,
        )

    if algorithm == "am_ppo":
        return AMPPOBalancer(
            backends,
            metrics_source=create_metrics_source(backends),
            weight_total=DQN_WEIGHT_TOTAL,
        )

    raise ValueError(f"Unsupported LB algorithm: {algorithm}")
