import logging

from config import (
    AM_PPO_CLIP_EPSILON,
    AM_PPO_ENTROPY_COEFFICIENT,
    AM_PPO_GAE_LAMBDA,
    AM_PPO_GAMMA,
    AM_PPO_LATENCY_SLA_SECONDS,
    AM_PPO_LEARNING_RATE,
    AM_PPO_REWARD_CHURN_WEIGHT,
    AM_PPO_REWARD_CPU_WEIGHT,
    AM_PPO_REWARD_ERROR_WEIGHT,
    AM_PPO_REWARD_LATENCY_WEIGHT,
    AM_PPO_ROLLOUT_SIZE,
    AM_PPO_UPDATE_EPOCHS,
    AM_PPO_VALUE_COEFFICIENT,
    AM_PPO_MODEL_PATH,
    Backend,
)
from balancers.base import Balancer, LoadDecision
from rl.am_ppo_model import AMPPORLModel, PpoAction
from rl.metrics_source import MetricsSource
from rl.types import ClusterState
from rl.weights import equal_eds_weights

logger = logging.getLogger("lb-controller.am_ppo")


class AMPPOBalancer(Balancer):
    def __init__(
        self,
        backends: tuple[Backend, ...],
        *,
        metrics_source: MetricsSource,
        model: AMPPORLModel | None = None,
        weight_total: int = 1000,
        latency_sla_seconds: float = AM_PPO_LATENCY_SLA_SECONDS,
        latency_weight: float = AM_PPO_REWARD_LATENCY_WEIGHT,
        error_weight: float = AM_PPO_REWARD_ERROR_WEIGHT,
        cpu_weight: float = AM_PPO_REWARD_CPU_WEIGHT,
        churn_weight: float = AM_PPO_REWARD_CHURN_WEIGHT,
    ) -> None:
        if not backends:
            raise ValueError("At least one backend is required")
        if weight_total < len(backends):
            raise ValueError("weight_total must be at least the backend count")
        if latency_sla_seconds <= 0.0:
            raise ValueError("latency_sla_seconds must be positive")

        self._backends = backends
        self._weight_total = weight_total
        self._latency_sla_seconds = latency_sla_seconds
        self._latency_weight = latency_weight
        self._error_weight = error_weight
        self._cpu_weight = cpu_weight
        self._churn_weight = churn_weight
        self._current_weights = equal_eds_weights(backends, weight_total=weight_total)
        self._metrics_source = metrics_source
        self._model = model or AMPPORLModel(
            learning_rate=AM_PPO_LEARNING_RATE,
            gamma=AM_PPO_GAMMA,
            gae_lambda=AM_PPO_GAE_LAMBDA,
            clip_epsilon=AM_PPO_CLIP_EPSILON,
            update_epochs=AM_PPO_UPDATE_EPOCHS,
            rollout_size=AM_PPO_ROLLOUT_SIZE,
            value_coefficient=AM_PPO_VALUE_COEFFICIENT,
            entropy_coefficient=AM_PPO_ENTROPY_COEFFICIENT,
            model_path=AM_PPO_MODEL_PATH,
        )
        self._previous_transition: tuple[ClusterState, PpoAction, dict[str, int]] | None = None

    def select(self) -> LoadDecision:
        state = self._metrics_source.fetch(self._backends, self._current_weights)
        if self._previous_transition is not None:
            previous_state, previous_action, weights_before_action = self._previous_transition
            reward = self._compute_reward(state, weights_before_action, previous_action.weights)
            self._model.observe_transition(previous_state, previous_action, reward, state)
            logger.info("AM-PPO observed transition step=%d reward=%.4f", state.step_index, reward)

        action = self._model.act(state, self._backends, weight_total=self._weight_total)
        weights_before_action = dict(self._current_weights)
        self._current_weights = dict(action.weights)
        self._previous_transition = (state, action, weights_before_action)
        logger.info(
            "AM-PPO decision step=%d healthy=%d/%d weights=%s",
            state.step_index,
            sum(action.alive_mask),
            len(action.alive_mask),
            action.weights,
        )
        return LoadDecision(weights=action.weights)

    def _compute_reward(
        self,
        state: ClusterState,
        previous_weights: dict[str, int],
        current_weights: dict[str, int],
    ) -> float:
        latency_penalty = state.cluster_latency_p99_seconds / self._latency_sla_seconds
        request_rate = sum(max(server.request_rate_rps, 0.0) for server in state.servers)
        if request_rate > 0.0:
            error_rate = sum(
                max(server.request_rate_rps, 0.0) * min(max(server.error_rate, 0.0), 1.0)
                for server in state.servers
            ) / request_rate
        else:
            error_rate = 0.0

        cpu_penalty = sum(max(server.cpu_utilization - 0.85, 0.0) for server in state.servers)
        churn = sum(
            abs(current_weights.get(backend.host, 0) - previous_weights.get(backend.host, 0))
            for backend in self._backends
        ) / (2.0 * self._weight_total)
        return -(
            self._latency_weight * latency_penalty
            + self._error_weight * error_rate
            + self._cpu_weight * cpu_penalty
            + self._churn_weight * churn
        )