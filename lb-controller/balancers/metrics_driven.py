import logging
from abc import abstractmethod

from config import Backend
from balancers.base import Balancer, LoadDecision
from rl.metrics_source import MetricsSource
from rl.types import ClusterState
from rl.weights import equal_eds_weights

logger = logging.getLogger("lb-controller.adaptive")


class MetricsDrivenBalancer(Balancer):
    """Base class for balancers that read Prometheus state and emit EDS weights."""

    def __init__(
        self,
        backends: tuple[Backend, ...],
        metrics_source: MetricsSource,
        *,
        weight_total: int,
    ) -> None:
        if not backends:
            raise ValueError("At least one backend is required")
        if weight_total <= 0:
            raise ValueError("weight_total must be positive")

        self._backends = backends
        self._metrics_source = metrics_source
        self._weight_total = weight_total
        self._current_weights = equal_eds_weights(backends, weight_total=weight_total)

    def select(self) -> LoadDecision:
        state = self._metrics_source.fetch(self._backends, self._current_weights)
        weights = self._compute_weights(state)
        self._current_weights = dict(weights)
        logger.info("%s weights=%s", self.__class__.__name__, weights)
        return LoadDecision(weights=weights)

    @abstractmethod
    def _compute_weights(self, state: ClusterState) -> dict[str, int]:
        pass
