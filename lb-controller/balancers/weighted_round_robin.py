from config import Backend
from balancers.base import Balancer, LoadDecision
from rl.weights import capacity_eds_weights


class WeightedRoundRobinBalancer(Balancer):
    def __init__(
        self,
        backends: tuple[Backend, ...],
        capacities: tuple[float, ...],
        *,
        weight_total: int,
    ) -> None:
        if not backends:
            raise ValueError("At least one backend is required")

        self._weights = capacity_eds_weights(backends, capacities, weight_total=weight_total)

    def select(self) -> LoadDecision:
        return LoadDecision(weights=dict(self._weights))
