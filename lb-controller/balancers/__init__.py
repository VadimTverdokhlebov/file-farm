from balancers.base import Balancer, LoadDecision
from balancers.round_robin import RoundRobinBalancer

__all__ = ["Balancer", "LoadDecision", "RoundRobinBalancer", "create_balancer"]


def create_balancer(algorithm: str, backends) -> Balancer:
    if algorithm == "round_robin":
        return RoundRobinBalancer(backends)

    raise ValueError(f"Unsupported LB algorithm: {algorithm}")
