from config import Backend
from balancers.metrics_driven import MetricsDrivenBalancer
from rl.metrics_source import MetricsSource
from rl.types import ClusterState
from rl.weights import logits_to_eds_weights


class LeastRequestBalancer(MetricsDrivenBalancer):
    """Envoy LEAST_REQUEST-style policy via EDS weights.

    Routes more traffic to backends with fewer in-flight gRPC requests:
    weight_i ∝ 1 / (active_requests_i + 1)
    """

    def __init__(
        self,
        backends: tuple[Backend, ...],
        metrics_source: MetricsSource,
        *,
        weight_total: int,
    ) -> None:
        super().__init__(backends, metrics_source, weight_total=weight_total)

    def _compute_weights(self, state: ClusterState) -> dict[str, int]:
        scores = [1.0 / (server.active_requests + 1.0) for server in state.servers]
        return logits_to_eds_weights(
            self._backends,
            tuple(scores),
            weight_total=self._weight_total,
        )
