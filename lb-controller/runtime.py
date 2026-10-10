import threading

from balancers import create_balancer
from config import BACKENDS, LB_ALGORITHM
from metrics import set_algorithm

ALGORITHMS = (
    {"id": "round_robin", "name": "Round Robin"},
    {"id": "weighted_round_robin", "name": "Weighted Round Robin"},
    {"id": "ema", "name": "EMA"},
    {"id": "least_request", "name": "Least Request"},
    {"id": "random_choice", "name": "Random Choice"},
    {"id": "am_ppo", "name": "AM-PPO"},
)


class BalancerRuntime:
    def __init__(self, algorithm: str = LB_ALGORITHM) -> None:
        self._lock = threading.RLock()
        self._algorithm = algorithm
        self._balancer = self._create_balancer(algorithm)

    @staticmethod
    def _create_balancer(algorithm: str):
        return create_balancer(algorithm, BACKENDS)

    def get_configuration(self) -> dict:
        with self._lock:
            return {
                "algorithms": [dict(item) for item in ALGORITHMS],
                "selected": self._algorithm,
            }

    def set_algorithm(self, algorithm: str) -> dict:
        if algorithm not in {item["id"] for item in ALGORITHMS}:
            raise ValueError(f"Unsupported LB algorithm: {algorithm}")

        balancer = self._create_balancer(algorithm)
        with self._lock:
            self._balancer = balancer
            self._algorithm = algorithm
            set_algorithm(algorithm)
            return self.get_configuration()

    def select(self):
        with self._lock:
            return self._balancer.select()