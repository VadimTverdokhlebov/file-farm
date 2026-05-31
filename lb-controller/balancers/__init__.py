from balancers.base import Balancer, LoadDecision
from balancers.round_robin import RoundRobinBalancer
from balancers.weighted_round_robin import WeightedRoundRobinBalancer

__all__ = [
    "Balancer",
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

    raise ValueError(f"Unsupported LB algorithm: {algorithm}")
