import random
import logging

from config import Backend
from balancers.base import Balancer, LoadDecision

logger = logging.getLogger("lb-controller.random_choice")

class RandomChoiceBalancer(Balancer):
    def __init__(
        self,
        backends: tuple[Backend, ...],
        *,
        weight_total: int = 1000,
    ) -> None:
        if not backends:
            raise ValueError("At least one backend is required")
        if weight_total < len(backends):
            raise ValueError("weight_total must be at least the backend count")

        self._backends = backends
        self._weight_total = weight_total

    def select(self) -> LoadDecision:
        weights = {}
        # Simple random distribution
        assigned = 0
        rand_weights = [random.random() for _ in self._backends]
        total_rand = sum(rand_weights)
        
        for index, backend in enumerate(self._backends):
            if index == len(self._backends) - 1:
                weight = max(self._weight_total - assigned, 1)
            else:
                weight = max(int(round((rand_weights[index] / total_rand) * self._weight_total)), 1)
                assigned += weight
            weights[backend.host] = weight

        logger.info("RandomChoiceBalancer weights=%s", weights)
        return LoadDecision(weights=weights)
