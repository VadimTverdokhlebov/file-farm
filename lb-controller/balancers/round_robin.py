from config import Backend
from balancers.base import Balancer, LoadDecision


class RoundRobinBalancer(Balancer):
    def __init__(self, backends: tuple[Backend, ...]) -> None:
        if not backends:
            raise ValueError("At least one backend is required")

        self._hosts = [backend.host for backend in backends]

    def select(self) -> LoadDecision:
        # Equal weights approximate native round robin in WEIGHTED_ROUND_ROBIN.
        weights = {host: 100 for host in self._hosts}
        return LoadDecision(weights=weights)
