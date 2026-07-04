from config import Backend
from balancers.metrics_driven import MetricsDrivenBalancer
from rl.metrics_source import MetricsSource
from rl.types import ClusterState
from rl.weights import logits_to_eds_weights


class EmaBalancer(MetricsDrivenBalancer):
    """Adaptive weights from exponentially smoothed backend latency.

    weight_i ∝ 1 / ema_latency_i
    ema_t = alpha * latency_t + (1 - alpha) * ema_{t-1}
    """

    def __init__(
        self,
        backends: tuple[Backend, ...],
        metrics_source: MetricsSource,
        *,
        weight_total: int,
        alpha: float = 0.2,
        min_latency_seconds: float = 0.001,
    ) -> None:
        if not 0.0 < alpha <= 1.0:
            raise ValueError("alpha must be within (0, 1]")

        super().__init__(backends, metrics_source, weight_total=weight_total)
        self._alpha = alpha
        self._min_latency_seconds = min_latency_seconds
        self._latency_ema: dict[str, float] = {}

    def _compute_weights(self, state: ClusterState) -> dict[str, int]:
        scores: list[float] = []

        for server in state.servers:
            observed = max(server.latency_p99_seconds, self._min_latency_seconds)
            previous = self._latency_ema.get(server.host, observed)
            smoothed = self._alpha * observed + (1.0 - self._alpha) * previous
            self._latency_ema[server.host] = smoothed
            scores.append(1.0 / smoothed)

        return logits_to_eds_weights(
            self._backends,
            tuple(scores),
            weight_total=self._weight_total,
        )
