import logging

from config import Backend
from balancers.base import Balancer, LoadDecision
from rl.metrics_source import MetricsSource, StubMetricsSource
from rl.model import RlModel, StubRlModel
from rl.types import ClusterState, ModelAction
from rl.weights import equal_eds_weights

logger = logging.getLogger("lb-controller.dqn")


class DqnBalancer(Balancer):
    """RL control-plane balancer.

    Input:  ClusterState -> list[float] via ClusterState.to_feature_vector()
    Output: ModelAction.weights -> dict[host, int] for Envoy EDS
    """

    def __init__(
        self,
        backends: tuple[Backend, ...],
        *,
        metrics_source: MetricsSource | None = None,
        model: RlModel | None = None,
        weight_total: int = 1000,
        epsilon: float = 0.1,
        model_path: str | None = None,
        cpu_limits: tuple[float, ...] | None = None,
        memory_limits_bytes: tuple[float, ...] | None = None,
    ) -> None:
        if not backends:
            raise ValueError("At least one backend is required")

        self._backends = backends
        self._weight_total = weight_total
        self._cpu_limits = cpu_limits or tuple(1.0 for _ in backends)
        self._memory_limits_bytes = memory_limits_bytes or tuple(1_073_741_824.0 for _ in backends)
        self._current_weights = equal_eds_weights(backends, weight_total=weight_total)
        self._metrics_source = metrics_source or StubMetricsSource(
            backends,
            cpu_limits=self._cpu_limits,
            memory_limits_bytes=self._memory_limits_bytes,
        )
        self._model = model or StubRlModel(
            backends,
            weight_total=weight_total,
            epsilon=epsilon,
            model_path=model_path,
        )
        self._previous_state: ClusterState | None = None
        self._previous_action: ModelAction | None = None

    def select(self) -> LoadDecision:
        state = self._metrics_source.fetch(self._backends, self._current_weights)
        action = self._model.predict(state, self._backends)
        self._maybe_train(state, action)
        self._current_weights = dict(action.weights)

        logger.info(
            "DQN decision step=%s explored=%s logits=%s weights=%s input_dim=%s",
            state.step_index,
            action.explored,
            action.raw_logits,
            action.weights,
            state.dimension,
        )
        return LoadDecision(weights=action.weights)

    def _maybe_train(self, state: ClusterState, action: ModelAction) -> None:
        if self._previous_state is None or self._previous_action is None:
            self._previous_state = state
            self._previous_action = action
            return

        # Reward is not wired yet; pass zero so the training hook exists.
        reward = 0.0
        self._model.observe_transition(self._previous_state, self._previous_action, reward, state)
        self._previous_state = state
        self._previous_action = action
