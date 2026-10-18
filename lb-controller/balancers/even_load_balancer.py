import logging
import time
from collections.abc import Callable

from config import Backend
from balancers.base import Balancer, LoadDecision
from rl.metrics_source import MetricsSource
from rl.weights import equal_eds_weights, step_toward_even_load

logger = logging.getLogger("lb-controller.even_load")

# The controller tick is 0.1s. Hold for one tick and move at most 5 so a wide
# CPU gap closes quickly without a single jump.
EVEN_LOAD_HOLD_SEC = 0.1
EVEN_LOAD_MAX_STEP = 5
# Short CPU rate so a 0.1s loop is not still chasing a 15s average.
EVEN_LOAD_METRICS_WINDOW = "5s"


class EvenLoadBalancer(Balancer):
    """Even CPU across however many backends are currently alive.

    A decision uses only health and CPU utilization. Disk, RPS, active
    requests, and CPU limits are ignored. Each live server moves by at most
    EVEN_LOAD_MAX_STEP per decision.
    """

    def __init__(
        self,
        backends: tuple[Backend, ...],
        metrics_source: MetricsSource,
        *,
        weight_total: int,
        max_step: int = EVEN_LOAD_MAX_STEP,
        action_hold_seconds: float = EVEN_LOAD_HOLD_SEC,
        time_fn: Callable[[], float] | None = None,
    ) -> None:
        if not backends:
            raise ValueError("At least one backend is required")
        if weight_total <= 0:
            raise ValueError("weight_total must be positive")
        if max_step < 0:
            raise ValueError("max_step must be non-negative")
        if action_hold_seconds < 0.0:
            raise ValueError("action_hold_seconds must be non-negative")

        self._backends = backends
        self._metrics_source = metrics_source
        self._weight_total = weight_total
        self._max_step = max_step
        self._action_hold_seconds = action_hold_seconds
        self._time_fn = time_fn or time.monotonic
        self._hold_until = 0.0
        self._current_weights = equal_eds_weights(backends, weight_total=weight_total)

    def select(self) -> LoadDecision:
        now = self._time_fn()
        if now < self._hold_until:
            return LoadDecision(weights=dict(self._current_weights))

        state = self._metrics_source.fetch(self._backends, self._current_weights)
        weights = step_toward_even_load(
            self._backends,
            self._current_weights,
            tuple(server.cpu_utilization for server in state.servers),
            tuple(server.is_healthy for server in state.servers),
            weight_total=self._weight_total,
            max_step=self._max_step,
        )
        if weights != self._current_weights:
            logger.info(
                "Even load weights=%s cpu%%=%s",
                weights,
                [round(server.cpu_utilization * 100) for server in state.servers],
            )
        self._current_weights = dict(weights)
        self._hold_until = now + self._action_hold_seconds
        return LoadDecision(weights=weights)
