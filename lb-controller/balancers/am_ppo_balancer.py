import logging
import math
import time
from collections.abc import Callable

from config import (
    AM_PPO_ACTION_HOLD_SEC,
    AM_PPO_CLIP_EPSILON,
    AM_PPO_ENTROPY_COEFFICIENT,
    AM_PPO_GAE_LAMBDA,
    AM_PPO_GAMMA,
    AM_PPO_LEARNING_RATE,
    AM_PPO_MIN_TRAINING_RPS,
    AM_PPO_MODEL_PATH,
    AM_PPO_REWARD_BALANCE_WEIGHT,
    AM_PPO_REWARD_CHURN_WEIGHT,
    AM_PPO_REWARD_DISK_WEIGHT,
    AM_PPO_REWARD_SPREAD_WEIGHT,
    AM_PPO_ROLLOUT_SIZE,
    AM_PPO_UPDATE_EPOCHS,
    AM_PPO_VALUE_COEFFICIENT,
    Backend,
)
from balancers.base import Balancer, LoadDecision
from rl.am_ppo_model import AMPPORLModel, PpoAction
from rl.metrics_source import MetricsSource
from rl.types import ClusterState, disk_busyness
from rl.weights import capacity_eds_weights, equal_eds_weights, step_toward_even_cpu

logger = logging.getLogger("lb-controller.am_ppo")


class AMPPOBalancer(Balancer):
    def __init__(
        self,
        backends: tuple[Backend, ...],
        *,
        metrics_source: MetricsSource,
        model: AMPPORLModel | None = None,
        weight_total: int = 1000,
        cpu_limits: tuple[float, ...] | None = None,
        min_training_rps: float = AM_PPO_MIN_TRAINING_RPS,
        balance_weight: float = AM_PPO_REWARD_BALANCE_WEIGHT,
        spread_weight: float = AM_PPO_REWARD_SPREAD_WEIGHT,
        disk_weight: float = AM_PPO_REWARD_DISK_WEIGHT,
        churn_weight: float = AM_PPO_REWARD_CHURN_WEIGHT,
        action_hold_seconds: float = AM_PPO_ACTION_HOLD_SEC,
        time_fn: Callable[[], float] | None = None,
    ) -> None:
        if not backends:
            raise ValueError("At least one backend is required")
        if weight_total < len(backends):
            raise ValueError("weight_total must be at least the backend count")
        if min_training_rps < 0.0:
            raise ValueError("min_training_rps must be non-negative")
        if balance_weight < 0.0:
            raise ValueError("balance_weight must be non-negative")
        if spread_weight < 0.0:
            raise ValueError("spread_weight must be non-negative")
        if disk_weight < 0.0:
            raise ValueError("disk_weight must be non-negative")
        if action_hold_seconds < 0.0:
            raise ValueError("action_hold_seconds must be non-negative")

        self._backends = backends
        self._weight_total = weight_total
        self._min_training_rps = min_training_rps
        self._balance_weight = balance_weight
        self._spread_weight = spread_weight
        self._disk_weight = disk_weight
        self._churn_weight = churn_weight
        self._action_hold_seconds = action_hold_seconds
        self._time_fn = time_fn or time.monotonic
        self._hold_until = 0.0
        if cpu_limits is None:
            self._current_weights = equal_eds_weights(backends, weight_total=weight_total)
        else:
            self._current_weights = capacity_eds_weights(
                backends,
                cpu_limits,
                weight_total=weight_total,
            )
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
        # State seen, action taken, weights before and weights after the action.
        self._previous_transition: (
            tuple[ClusterState, PpoAction, dict[str, int], dict[str, int]] | None
        ) = None

    def select(self) -> LoadDecision:
        now = self._time_fn()
        if self._previous_transition is not None and now < self._hold_until:
            return LoadDecision(weights=self._current_weights)

        state = self._metrics_source.fetch(self._backends, self._current_weights)
        if _cpu_sample_missing(state):
            # A missed scrape must not look like an idle server. Drop the open
            # transition and keep the current weights until the next full sample.
            logger.warning(
                "AM-PPO skipped step=%d; a CPU sample is missing",
                state.step_index,
            )
            self._previous_transition = None
            # The next sample would continue from a different state, so the
            # open rollout would stitch two unrelated trajectories.
            self._model.discard_rollout()
            held = {
                backend.host: self._current_weights.get(backend.host, 0) if server.is_healthy else 0
                for backend, server in zip(self._backends, state.servers)
            }
            self._current_weights = held
            self._hold_until = now + self._action_hold_seconds
            return LoadDecision(weights=held)

        if self._previous_transition is not None:
            previous_state, previous_action, weights_before_action, weights_after_action = (
                self._previous_transition
            )
            if self._is_trainable(previous_state) and self._is_trainable(state):
                terms = self._reward_terms(
                    state,
                    previous_state,
                    weights_before_action,
                    weights_after_action,
                )
                reward = sum(terms.values())
                self._model.observe_transition(previous_state, previous_action, reward, state)
                cpu_percent = [round(server.cpu_utilization * 100) for server in previous_state.servers]
                # Latency and errors are one number for the whole cluster, so they
                # cannot tell the policy which server to favor. Log only.
                logger.info(
                    "AM-PPO observed transition step=%d reward=%.4f balance=%.2f spread=%.2f disk=%.2f churn=%.2f p99=%.0fms errors=%.1f%% cpu%%=%s",
                    state.step_index,
                    reward,
                    terms["balance"],
                    terms["spread"],
                    terms["disk"],
                    terms["churn"],
                    state.cluster_latency_p99_seconds * 1000.0,
                    _cluster_error_rate(state) * 100.0,
                    cpu_percent,
                )
            elif not self._is_trainable(state):
                self._model.discard_rollout()
                logger.debug(
                    "AM-PPO skipped idle transition step=%d rps=%.3f",
                    state.step_index,
                    state.cluster_request_rate_rps,
                )

        action = self._model.act(state)
        if self._previous_transition is None:
            # The first assignment is the hardware split. Later decisions move
            # one capped step away from whatever is already in effect.
            stepped = {
                backend.host: self._current_weights.get(backend.host, 0) if alive else 0
                for backend, alive in zip(self._backends, action.alive_mask)
            }
        else:
            # A 40% CPU reading must not replace weight 70 with 350.
            stepped = step_toward_even_cpu(
                self._backends,
                self._current_weights,
                tuple(server.cpu_utilization for server in state.servers),
                action.alive_mask,
                action.raw_logits,
                weight_total=self._weight_total,
            )
        weights_before_action = dict(self._current_weights)
        self._current_weights = dict(stepped)
        self._previous_transition = (state, action, weights_before_action, dict(stepped))
        self._hold_until = now + self._action_hold_seconds
        logger.info(
            "AM-PPO decision step=%d healthy=%d/%d weights=%s",
            state.step_index,
            sum(action.alive_mask),
            len(action.alive_mask),
            stepped,
        )
        return LoadDecision(weights=stepped)

    def set_learning_enabled(self, enabled: bool) -> None:
        self._model.set_learning_enabled(enabled)

    @property
    def learning_enabled(self) -> bool:
        return self._model.learning_enabled

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
        # Scored on the CPUs the action actually saw. Weight moved onto a hotter
        # server is a penalty; weight moved onto a colder one is a reward.
        # Equal CPUs, or no shift, score zero.
        balance_penalty = _weight_on_hotter_servers(decision_state, action_weights, previous_weights)
        # The cluster after the action. Equal CPUs score zero even when the
        # weights did not move, which the balance term cannot see.
        spread_penalty = _cpu_spread(outcome_state)
        # Same shape as the balance term: weight moved onto a busier disk is a penalty.
        disk_penalty = _weight_covariance(
            [disk_busyness(server) for server in decision_state.servers],
            [server.is_healthy for server in decision_state.servers],
            [action_weights.get(server.host, 0) for server in decision_state.servers],
            [previous_weights.get(server.host, 0) for server in decision_state.servers],
        )
        churn = sum(
            abs(action_weights.get(backend.host, 0) - previous_weights.get(backend.host, 0))
            for backend in self._backends
        ) / (2.0 * self._weight_total)
        return {
            "balance": -self._balance_weight * balance_penalty,
            "spread": -self._spread_weight * spread_penalty,
            "disk": -self._disk_weight * disk_penalty,
            "churn": -self._churn_weight * churn,
        }

    def _is_trainable(self, state: ClusterState) -> bool:
        return state.cluster_request_rate_rps >= self._min_training_rps


def _cpu_sample_missing(state: ClusterState) -> bool:
    """True when a live server has no CPU reading. A real 0% is finite."""
    return any(
        server.is_healthy and not math.isfinite(server.cpu_utilization)
        for server in state.servers
    )


def _cluster_error_rate(state: ClusterState) -> float:
    """Share of failed requests across the cluster, weighted by each server's traffic."""
    request_rate = sum(max(server.request_rate_rps, 0.0) for server in state.servers)
    if request_rate <= 0.0:
        return 0.0
    return sum(
        max(server.request_rate_rps, 0.0) * min(max(server.error_rate, 0.0), 1.0)
        for server in state.servers
    ) / request_rate


def _cpu_spread(state: ClusterState) -> float:
    """Mean absolute deviation of CPU among healthy servers.

    Zero when every live server sits at the same utilization. A stopped server
    is left out, so its zero reading does not look like a cold server.
    """
    cpus = [
        min(max(server.cpu_utilization, 0.0), 1.0)
        for server in state.servers
        if server.is_healthy and math.isfinite(server.cpu_utilization)
    ]
    if len(cpus) < 2:
        return 0.0
    mean_cpu = sum(cpus) / len(cpus)
    return sum(abs(cpu - mean_cpu) for cpu in cpus) / len(cpus)


def _weight_on_hotter_servers(
    state: ClusterState,
    weights: dict[str, int],
    previous_weights: dict[str, int] | None = None,
) -> float:
    """Covariance of the weight shift and CPU among healthy servers.

    Positive when the action moved weight onto a hotter server, negative when
    it moved weight onto a colder one. Zero when nothing moved or CPUs are equal.
    """
    return _weight_covariance(
        [
            min(max(server.cpu_utilization, 0.0), 1.0) if math.isfinite(server.cpu_utilization) else None
            for server in state.servers
        ],
        [server.is_healthy for server in state.servers],
        [weights.get(server.host, 0) for server in state.servers],
        None
        if previous_weights is None
        else [previous_weights.get(server.host, 0) for server in state.servers],
    )


def _weight_covariance(
    signals: list[float | None],
    healthy: list[bool],
    weights: list[int],
    previous_weights: list[int] | None = None,
) -> float:
    """Positive when weight moves toward the higher signal. Zero if either side is flat.

    The action only moves a few points per decision, so the absolute share is
    mostly set by earlier decisions. With previous_weights the score covers the
    shift this action made, so the reward depends on the action and not on history.
    Without previous_weights the share is compared with an equal split.
    """
    rows: list[tuple[float, int, int]] = []
    for index, (signal, is_healthy, weight) in enumerate(zip(signals, healthy, weights)):
        if not is_healthy or signal is None or not math.isfinite(signal):
            continue
        before = 0 if previous_weights is None else max(previous_weights[index], 0)
        rows.append((min(max(signal, 0.0), 1.0), max(weight, 0), before))
    if len(rows) < 2:
        return 0.0
    weight_sum = sum(weight for _, weight, _ in rows)
    if weight_sum <= 0:
        return 0.0
    before_sum = sum(before for _, _, before in rows)
    if previous_weights is not None and before_sum <= 0:
        return 0.0
    mean_signal = sum(signal for signal, _, _ in rows) / len(rows)
    equal_share = 1.0 / len(rows)
    penalty = 0.0
    for signal, weight, before in rows:
        reference = equal_share if previous_weights is None else before / before_sum
        penalty += (weight / weight_sum - reference) * (signal - mean_signal)
    return penalty
