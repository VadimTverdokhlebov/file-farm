import random
from abc import ABC, abstractmethod
from pathlib import Path

from config import Backend
from rl.types import ClusterState, ModelAction
from rl.weights import equal_eds_weights, logits_to_eds_weights


class RlModel(ABC):
    """Neural policy used by the DQN balancer."""

    @abstractmethod
    def predict(self, state: ClusterState, backends: tuple[Backend, ...]) -> ModelAction:
        pass

    def observe_transition(
        self,
        state: ClusterState,
        action: ModelAction,
        reward: float,
        next_state: ClusterState,
    ) -> None:
        # Optional hook for online training; no-op in the stub.
        return


class StubRlModel(RlModel):
    """Placeholder model: equal weights with optional epsilon noise."""

    def __init__(
        self,
        backends: tuple[Backend, ...],
        *,
        weight_total: int,
        epsilon: float = 0.1,
        model_path: str | None = None,
    ) -> None:
        if not backends:
            raise ValueError("At least one backend is required")
        if not 0.0 <= epsilon <= 1.0:
            raise ValueError("epsilon must be within [0, 1]")

        self._backends = backends
        self._weight_total = weight_total
        self._epsilon = epsilon
        self._model_path = Path(model_path) if model_path else None

    def predict(self, state: ClusterState, backends: tuple[Backend, ...]) -> ModelAction:
        if len(state.servers) != len(backends):
            raise ValueError("State size does not match backend count")

        explored = random.random() < self._epsilon
        if explored:
            logits = self._noisy_logits(state)
        else:
            logits = self._capacity_aware_logits(state)

        weights = logits_to_eds_weights(
            backends,
            logits,
            weight_total=self._weight_total,
        )
        return ModelAction(raw_logits=logits, weights=weights, explored=explored)

    def _capacity_aware_logits(self, state: ClusterState) -> tuple[float, ...]:
        # Stub policy: prefer backends with higher static capacity and lower CPU.
        logits: list[float] = []
        for server in state.servers:
            headroom = max(server.cpu_limit_cores * (1.0 - server.cpu_utilization), 0.1)
            logits.append(headroom)
        return tuple(logits)

    def _noisy_logits(self, state: ClusterState) -> tuple[float, ...]:
        return tuple(random.random() + 0.1 for _ in state.servers)

    @property
    def checkpoint_path(self) -> Path | None:
        return self._model_path
