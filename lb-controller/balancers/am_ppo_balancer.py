import logging
import math

from config import (
    AM_PPO_CLIP_EPSILON,
    AM_PPO_CPU_HARD_LIMIT,
    AM_PPO_CPU_SATURATION,
    AM_PPO_ENTROPY_COEFFICIENT,
    AM_PPO_GAE_LAMBDA,
    AM_PPO_GAMMA,
    AM_PPO_LATENCY_SLA_SECONDS,
    AM_PPO_LEARNING_RATE,
    AM_PPO_MIN_TRAINING_RPS,
    AM_PPO_REWARD_BALANCE_WEIGHT,
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
        cpu_saturation: float = AM_PPO_CPU_SATURATION,
        cpu_hard_limit: float = AM_PPO_CPU_HARD_LIMIT,
        min_training_rps: float = AM_PPO_MIN_TRAINING_RPS,
        latency_weight: float = AM_PPO_REWARD_LATENCY_WEIGHT,
        error_weight: float = AM_PPO_REWARD_ERROR_WEIGHT,
        cpu_weight: float = AM_PPO_REWARD_CPU_WEIGHT,
        balance_weight: float = AM_PPO_REWARD_BALANCE_WEIGHT,
        churn_weight: float = AM_PPO_REWARD_CHURN_WEIGHT,
    ) -> None:
        if not backends:
            raise ValueError("At least one backend is required")
        if weight_total < len(backends):
            raise ValueError("weight_total must be at least the backend count")
        if latency_sla_seconds <= 0.0:
            raise ValueError("latency_sla_seconds must be positive")
        if not 0.0 <= cpu_saturation < 1.0:
            raise ValueError("cpu_saturation must be in [0, 1)")
        if not cpu_saturation < cpu_hard_limit <= 1.0:
            raise ValueError("cpu_hard_limit must be above cpu_saturation and at most 1")
        if min_training_rps < 0.0:
            raise ValueError("min_training_rps must be non-negative")
        if balance_weight < 0.0:
            raise ValueError("balance_weight must be non-negative")

        self._backends = backends
        self._weight_total = weight_total
        self._latency_sla_seconds = latency_sla_seconds
        self._cpu_saturation = cpu_saturation
        self._cpu_hard_limit = cpu_hard_limit
        self._min_training_rps = min_training_rps
        self._latency_weight = latency_weight
        self._error_weight = error_weight
        self._cpu_weight = cpu_weight
        self._balance_weight = balance_weight
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
            if self._is_trainable(previous_state) and self._is_trainable(state):
                reward = self._compute_reward(state, weights_before_action, previous_action.weights)
                self._model.observe_transition(previous_state, previous_action, reward, state)
                logger.info("AM-PPO observed transition step=%d reward=%.4f", state.step_index, reward)
            elif not self._is_trainable(state):
                self._model.discard_rollout()
                logger.debug(
                    "AM-PPO skipped idle transition step=%d rps=%.3f",
                    state.step_index,
                    state.cluster_request_rate_rps,
                )

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

        # Each server pays nothing at or below 90%, then a squared cost through 95%,
        # and a much steeper cost above 95%. One server at 100% outweighs a 2s p99.
        cpu_penalty = sum(
            _cpu_saturation_penalty(server.cpu_utilization, self._cpu_saturation, self._cpu_hard_limit)
            for server in state.servers
        )
        # Zero when healthy servers sit at the same fraction of their own CPU limit.
        balance_penalty = _cpu_utilization_spread(state)
        churn = sum(
            abs(current_weights.get(backend.host, 0) - previous_weights.get(backend.host, 0))
            for backend in self._backends
        ) / (2.0 * self._weight_total)
        return -(
            self._latency_weight * latency_penalty
            + self._error_weight * error_rate
            + self._cpu_weight * cpu_penalty
            + self._balance_weight * balance_penalty
            + self._churn_weight * churn
        )

    def _is_trainable(self, state: ClusterState) -> bool:
        return state.cluster_request_rate_rps >= self._min_training_rps


def _cpu_saturation_penalty(cpu: float, soft_limit: float, hard_limit: float) -> float:
    if not math.isfinite(cpu):
        return 0.0
    cpu = min(max(cpu, 0.0), 1.0)
    if cpu <= soft_limit:
        return 0.0
    band = max(hard_limit - soft_limit, 1e-6)
    units = (cpu - soft_limit) / band
    penalty = units * units
    if cpu > hard_limit:
        over_hard = (cpu - hard_limit) / band
        penalty += 4.0 * over_hard * over_hard
    return penalty


def _cpu_utilization_spread(state: ClusterState) -> float:
    utilizations = [
        min(max(server.cpu_utilization, 0.0), 1.0)
        for server in state.servers
        if server.is_healthy and math.isfinite(server.cpu_utilization)
    ]
    if len(utilizations) < 2:
        return 0.0
    return max(utilizations) - min(utilizations)