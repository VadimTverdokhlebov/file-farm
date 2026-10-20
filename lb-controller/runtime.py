import threading

from balancers import create_balancer
from config import AM_PPO_LEARNING_ENABLED, BACKENDS, LB_ALGORITHM
from metrics import set_algorithm

ALGORITHMS = (
    {"id": "round_robin", "name": "Round Robin"},
    {"id": "weighted_round_robin", "name": "Weighted Round Robin"},
    {"id": "ema", "name": "EMA"},
    {"id": "least_request", "name": "Least Request (Envoy)"},
    {"id": "random_choice", "name": "Random (Envoy)"},
    {"id": "am_ppo", "name": "AM-PPO"},
)


class BalancerRuntime:
    def __init__(self, algorithm: str = LB_ALGORITHM) -> None:
        self._lock = threading.RLock()
        self._algorithm = algorithm
        # Kept here, not in the balancer: switching the algorithm builds a new
        # balancer and must not silently turn learning back on.
        self._learning_enabled = AM_PPO_LEARNING_ENABLED
        self._balancer = self._create_balancer(algorithm)
        self._apply_learning(self._balancer)

    @staticmethod
    def _create_balancer(algorithm: str):
        return create_balancer(algorithm, BACKENDS)

    def _apply_learning(self, balancer) -> None:
        setter = getattr(balancer, "set_learning_enabled", None)
        if setter is not None:
            setter(self._learning_enabled)

    def set_learning_enabled(self, enabled: bool) -> dict:
        with self._lock:
            self._learning_enabled = bool(enabled)
            self._apply_learning(self._balancer)
            return {"learning": self._learning_enabled}

    def get_configuration(self) -> dict:
        with self._lock:
            return {
                "algorithms": [dict(item) for item in ALGORITHMS],
                "selected": self._algorithm,
                "learning": self._learning_enabled,
            }

    def set_algorithm(self, algorithm: str) -> dict:
        if algorithm not in {item["id"] for item in ALGORITHMS}:
            raise ValueError(f"Unsupported LB algorithm: {algorithm}")

        balancer = self._create_balancer(algorithm)
        with self._lock:
            self._apply_learning(balancer)
            self._balancer = balancer
            self._algorithm = algorithm
            set_algorithm(algorithm)
            return self.get_configuration()

    @property
    def lb_policy(self) -> str:
        with self._lock:
            return self._balancer.lb_policy

    def select(self):
        with self._lock:
            return self._balancer.select()
