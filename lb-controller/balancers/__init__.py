from balancers.base import Balancer, LoadDecision
from balancers.am_ppo_balancer import AMPPOBalancer
from balancers.ema_balancer import EmaBalancer
from balancers.factory import create_metrics_source, parse_capacity_lists
from balancers.least_request_balancer import LeastRequestBalancer
from balancers.round_robin import RoundRobinBalancer
from balancers.random_choice_balancer import RandomChoiceBalancer
from balancers.weighted_round_robin import WeightedRoundRobinBalancer
from config import AM_PPO_METRICS_WINDOW, DQN_WEIGHT_TOTAL, EMA_ALPHA

__all__ = [
    "Balancer",
    "AMPPOBalancer",
    "EmaBalancer",
    "LeastRequestBalancer",
    "RandomChoiceBalancer",
    "LoadDecision",
    "RoundRobinBalancer",
    "WeightedRoundRobinBalancer",
    "create_balancer",
]


def create_balancer(algorithm: str, backends) -> Balancer:
    if algorithm == "round_robin":
        return RoundRobinBalancer(backends)

    if algorithm == "weighted_round_robin":
        cpu_limits, _memory_limits = parse_capacity_lists(backends)
        return WeightedRoundRobinBalancer(backends, cpu_limits, weight_total=DQN_WEIGHT_TOTAL)

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

    if algorithm == "random_choice":
        return RandomChoiceBalancer(backends, weight_total=DQN_WEIGHT_TOTAL)

    if algorithm == "am_ppo":
        cpu_limits, _memory_limits = parse_capacity_lists(backends)
        return AMPPOBalancer(
            backends,
            metrics_source=create_metrics_source(backends, rate_window=AM_PPO_METRICS_WINDOW),
            weight_total=DQN_WEIGHT_TOTAL,
            cpu_limits=cpu_limits,
        )

    raise ValueError(f"Unsupported LB algorithm: {algorithm}")
