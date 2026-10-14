import logging
import math
import time
from collections.abc import Callable
from dataclasses import replace

from config import (
    AM_PPO_ACTION_HOLD_SEC,
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
    AM_PPO_REWARD_CAPACITY_WEIGHT,
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
from rl.weights import equal_eds_weights, step_toward_even_cpu

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
        capacity_weight: float = AM_PPO_REWARD_CAPACITY_WEIGHT,
        churn_weight: float = AM_PPO_REWARD_CHURN_WEIGHT,
        action_hold_seconds: float = AM_PPO_ACTION_HOLD_SEC,
        time_fn: Callable[[], float] | None = None,
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
        if capacity_weight < 0.0:
            raise ValueError("capacity_weight must be non-negative")
        if action_hold_seconds < 0.0:
            raise ValueError("action_hold_seconds must be non-negative")

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
        self._capacity_weight = capacity_weight
        self._churn_weight = churn_weight
        self._action_hold_seconds = action_hold_seconds
        self._time_fn = time_fn or time.monotonic
        self._hold_until = 0.0
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
        now = self._time_fn()
        if self._previous_transition is not None and now < self._hold_until:
            return LoadDecision(weights=self._current_weights)

        state = self._metrics_source.fetch(self._backends, self._current_weights)
        if self._previous_transition is not None:
            previous_state, previous_action, weights_before_action = self._previous_transition
            if self._is_trainable(previous_state) and self._is_trainable(state):
                terms = self._reward_terms(
                    state,
                    previous_state,
                    weights_before_action,
                    previous_action.weights,
                )
                reward = sum(terms.values())
                self._model.observe_transition(previous_state, previous_action, reward, state)
                cpu_percent = [round(server.cpu_utilization * 100) for server in previous_state.servers]
                logger.info(
                    "AM-PPO observed transition step=%d reward=%.4f latency=%.2f errors=%.2f cpu=%.2f balance=%.2f capacity=%.2f churn=%.2f cpu%%=%s",
                    state.step_index,
                    reward,
                    terms["latency"],
                    terms["errors"],
                    terms["cpu"],
                    terms["balance"],
                    terms["capacity"],
                    terms["churn"],
                    cpu_percent,
                )
            elif not self._is_trainable(state):
                self._model.discard_rollout()
                logger.debug(
                    "AM-PPO skipped idle transition step=%d rps=%.3f",
                    state.step_index,
                    state.cluster_request_rate_rps,
                )

        action = self._model.act(state, self._backends, weight_total=self._weight_total)
        # One small step from the weights already in effect. A 40% CPU reading
        # must not replace weight 70 with 350.
        stepped = step_toward_even_cpu(
            self._backends,
            self._current_weights,
            tuple(server.cpu_utilization for server in state.servers),
            action.alive_mask,
            action.raw_logits,
            weight_total=self._weight_total,
        )
        action = replace(action, weights=stepped)
        weights_before_action = dict(self._current_weights)
        self._current_weights = dict(action.weights)
        self._previous_transition = (state, action, weights_before_action)
        self._hold_until = now + self._action_hold_seconds
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
        decision_state: ClusterState | None = None,
    ) -> float:
        return sum(
            self._reward_terms(
                state,
                state if decision_state is None else decision_state,
                previous_weights,
                current_weights,
            ).values()
        )

    def _reward_terms(
        self,
        outcome_state: ClusterState,
        decision_state: ClusterState,
        previous_weights: dict[str, int],
        action_weights: dict[str, int],
    ) -> dict[str, float]:
        latency_penalty = outcome_state.cluster_latency_p99_seconds / self._latency_sla_seconds
        request_rate = sum(max(server.request_rate_rps, 0.0) for server in outcome_state.servers)
        if request_rate > 0.0:
            error_rate = sum(
                max(server.request_rate_rps, 0.0) * min(max(server.error_rate, 0.0), 1.0)
                for server in outcome_state.servers
            ) / request_rate
        else:
            error_rate = 0.0

        # Off in training. Sitting at 100% is not a penalty by itself: the policy
        # cannot shed clients, it can only move weight between live servers.
        cpu_penalty = sum(
            _cpu_saturation_penalty(
                server.cpu_utilization, self._cpu_saturation, self._cpu_hard_limit
            )
            for server in outcome_state.servers
        )
        # Scored on the CPUs the action actually saw. Extra weight on a hotter
        # server is a penalty; extra weight on a colder one is a reward.
        # Equal CPUs, or equal weights, score zero.
        balance_penalty = _weight_on_hotter_servers(decision_state, action_weights)
        # Off unless AM_PPO_REWARD_CAPACITY_WEIGHT is set. The policy does not
        # observe CPU limits; this term would teach a fixed capacity target.
        capacity_penalty = _capacity_share_gap(decision_state, action_weights)
        churn = sum(
            abs(action_weights.get(backend.host, 0) - previous_weights.get(backend.host, 0))
            for backend in self._backends
        ) / (2.0 * self._weight_total)
        return {
            "latency": -self._latency_weight * latency_penalty,
            "errors": -self._error_weight * error_rate,
            "cpu": -self._cpu_weight * cpu_penalty,
            "balance": -self._balance_weight * balance_penalty,
            "capacity": -self._capacity_weight * capacity_penalty,
            "churn": -self._churn_weight * churn,
        }

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


def _capacity_share_gap(state: ClusterState, weights: dict[str, int]) -> float:
    """Total-variation distance between weight shares and CPU-limit shares.

    Healthy servers only, so a stopped server with weight 0 is not a miss.
    Returns 0 when the shares match and 1 when they are disjoint.
    """
    eligible = [
        server
        for server in state.servers
        if server.is_healthy and math.isfinite(server.cpu_limit_cores) and server.cpu_limit_cores > 0.0
    ]
    if len(eligible) < 2:
        return 0.0
    capacity = sum(server.cpu_limit_cores for server in eligible)
    weight_sum = sum(max(weights.get(server.host, 0), 0) for server in eligible)
    if capacity <= 0.0 or weight_sum <= 0:
        return 0.0
    gap = 0.0
    for server in eligible:
        weight_share = max(weights.get(server.host, 0), 0) / weight_sum
        capacity_share = server.cpu_limit_cores / capacity
        gap += abs(weight_share - capacity_share)
    return gap / 2.0


def _weight_on_hotter_servers(state: ClusterState, weights: dict[str, int]) -> float:
    """Covariance of weight share and CPU among healthy servers.

    Zero when the weights are equal or the CPUs are equal. Positive when the
    action put extra weight on a hotter server, negative when it favored a colder one.
    """
    rows: list[tuple[float, int]] = []
    for server in state.servers:
        if not server.is_healthy or not math.isfinite(server.cpu_utilization):
            continue
        cpu = min(max(server.cpu_utilization, 0.0), 1.0)
        rows.append((cpu, max(weights.get(server.host, 0), 0)))
    if len(rows) < 2:
        return 0.0
    weight_sum = sum(weight for _, weight in rows)
    if weight_sum <= 0:
        return 0.0
    mean_cpu = sum(cpu for cpu, _ in rows) / len(rows)
    equal_share = 1.0 / len(rows)
    penalty = 0.0
    for cpu, weight in rows:
        penalty += (weight / weight_sum - equal_share) * (cpu - mean_cpu)
    return penalty