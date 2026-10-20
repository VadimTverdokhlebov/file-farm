from config import Backend
from balancers.base import Balancer, LoadDecision
from rl.weights import equal_eds_weights


class EnvoyNativeBalancer(Balancer):
    """Leaves the choice of a host to Envoy's own load balancer.

    The controller only publishes equal weights and asks for the cluster policy.
    Envoy decides per request, with no metrics round trip in between.
    """

    def __init__(self, backends: tuple[Backend, ...], *, weight_total: int = 1000) -> None:
        if not backends:
            raise ValueError("At least one backend is required")
        if weight_total < len(backends):
            raise ValueError("weight_total must be at least the backend count")

        self._weights = equal_eds_weights(backends, weight_total=weight_total)

    def select(self) -> LoadDecision:
        return LoadDecision(weights=dict(self._weights))


class LeastRequestBalancer(EnvoyNativeBalancer):
    """Envoy LEAST_REQUEST: two random hosts, the one with fewer active requests wins."""

    lb_policy = "LEAST_REQUEST"


class RandomChoiceBalancer(EnvoyNativeBalancer):
    """Envoy RANDOM: a random healthy host for every request."""

    lb_policy = "RANDOM"
