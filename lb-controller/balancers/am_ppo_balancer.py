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
    AM_PPO_NETWORK_CREDIT,
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
from rl.weights import capacity_eds_weights, equal_eds_weights, network_step_deltas, step_toward_even_cpu

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
        network_credit: bool = AM_PPO_NETWORK_CREDIT,
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
        self._network_credit = network_credit
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
        # Hosts that just came back from weight 0 and are still below the lightest peer.
        self._recovering: set[str] = set()

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
            # The next sample would continue from a different state. Cut the
            # trajectory here but keep what was collected: scrape gaps come every
            # half minute under load and would otherwise starve the rollout.
            self._model.end_segment()
            held = {
                backend.host: self._current_weights.get(backend.host, 0) if server.is_healthy else 0
                for backend, server in zip(self._backends, state.servers)
            }
            self._current_weights = held
            self._sync_recovering(tuple(server.is_healthy for server in state.servers), held)
            self._hold_until = now + self._action_hold_seconds
            return LoadDecision(weights=held)

        if not self._is_trainable(state):
            # With no traffic there is nothing to learn from and no CPU gap to close,
            # yet the network's constant bias kept stepping the weights until one server
            # held almost everything. Hold them, so a load that starts again meets the
            # split it left.
            self._previous_transition = None
            self._model.discard_rollout()
            logger.debug(
                "AM-PPO idle, weights held step=%d rps=%.3f",
                state.step_index,
                state.cluster_request_rate_rps,
            )
            held = {
                backend.host: self._current_weights.get(backend.host, 0) if server.is_healthy else 0
                for backend, server in zip(self._backends, state.servers)
            }
            self._current_weights = held
            self._sync_recovering(tuple(server.is_healthy for server in state.servers), held)
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
                    network_shift=self._network_shift(previous_action),
                )
                reward = sum(terms.values())
                self._model.observe_transition(previous_state, previous_action, reward, state)
                # A stopped server has no CPU reading at all; that must not stop the loop.
                cpu_percent = [
                    round(server.cpu_utilization * 100) if math.isfinite(server.cpu_utilization) else None
                    for server in previous_state.servers
                ]
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

        action = self._model.act(state)
        self._sync_recovering(action.alive_mask, self._current_weights)
        returning = any(
            bool(alive) and self._current_weights.get(backend.host, 0) <= 0
            for backend, alive in zip(self._backends, action.alive_mask)
        )
        if self._previous_transition is None and not returning:
            # The first assignment is the hardware split. Later decisions move
            # one capped step away from whatever is already in effect.
            stepped = {
                backend.host: self._current_weights.get(backend.host, 0) if alive else 0
                for backend, alive in zip(self._backends, action.alive_mask)
            }
        else:
            # A 40% CPU reading must not replace weight 70 with 350. A host that
            # just came back climbs 10 points at a time toward the lightest peer.
            stepped = step_toward_even_cpu(
                self._backends,
                self._current_weights,
                tuple(server.cpu_utilization for server in state.servers),
                action.alive_mask,
                action.raw_logits,
                weight_total=self._weight_total,
                recovering=frozenset(self._recovering),
            )
        weights_before_action = dict(self._current_weights)
        self._current_weights = dict(stepped)
        self._sync_recovering(action.alive_mask, stepped)
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

    def _sync_recovering(self, alive_mask: tuple[bool, ...], weights: dict[str, int]) -> None:
        live_hosts = [
            backend.host
            for backend, alive in zip(self._backends, alive_mask)
            if alive
        ]
        for backend, alive in zip(self._backends, alive_mask):
            host = backend.host
            if not alive:
                self._recovering.discard(host)
                continue
            held = max(weights.get(host, 0), 0)
            if held <= 0:
                self._recovering.add(host)
                continue
            peers = [max(weights.get(peer, 0), 0) for peer in live_hosts if peer != host]
            if peers and held >= min(peers):
                self._recovering.discard(host)

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

    def _network_shift(self, action: PpoAction) -> dict[str, float] | None:
        """Weight points the network itself asked for, by host. None when credit is off."""
        if not self._network_credit:
            return None
        deltas = network_step_deltas(action.raw_logits, action.alive_mask)
        return {backend.host: delta for backend, delta in zip(self._backends, deltas)}

    def _reward_terms(
        self,
        outcome_state: ClusterState,
        decision_state: ClusterState,
        previous_weights: dict[str, int],
        action_weights: dict[str, int],
        network_shift: dict[str, float] | None = None,
    ) -> dict[str, float]:
        # Scored on the CPUs the action actually saw. Weight moved onto a hotter
        # server is a penalty; weight moved onto a colder one is a reward.
        # Equal CPUs, or no shift, score zero.
        #
        # The shift is the network's own step when network_shift is given. The CPU
        # controller adds 30% on top, which the network did not choose and which
        # only adds variance to its credit. The score then depends on the state the
        # network saw and the logits it chose, not on the noise of the next reading.
        cpus = [_finite_fraction(server.cpu_utilization) for server in decision_state.servers]
        disks = [disk_busyness(server) for server in decision_state.servers]
        healthy = [server.is_healthy for server in decision_state.servers]
        if network_shift is not None:
            shifts = [network_shift.get(server.host, 0.0) / self._weight_total for server in decision_state.servers]
            balance_penalty = _shift_covariance(cpus, healthy, shifts)
            disk_penalty = _shift_covariance(disks, healthy, shifts)
        else:
            balance_penalty = _weight_on_hotter_servers(decision_state, action_weights, previous_weights)
            disk_penalty = _weight_covariance(
                disks,
                healthy,
                [action_weights.get(server.host, 0) for server in decision_state.servers],
                [previous_weights.get(server.host, 0) for server in decision_state.servers],
            )
        # The cluster after the action. Equal CPUs score zero even when the
        # weights did not move, which the balance term cannot see.
        spread_penalty = _cpu_spread(outcome_state)
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


def _finite_fraction(value: float) -> float | None:
    return min(max(value, 0.0), 1.0) if math.isfinite(value) else None


def _shift_covariance(
    signals: list[float | None],
    healthy: list[bool],
    shifts: list[float],
) -> float:
    """Covariance of a weight shift (as a share of the total) with a signal.

    Positive when the shift moves weight toward the higher signal. A stopped
    server and a missing reading are left out. Zero for fewer than two servers.
    """
    rows = [
        (signal, shift)
        for signal, is_healthy, shift in zip(signals, healthy, shifts)
        if is_healthy and signal is not None and math.isfinite(signal)
    ]
    if len(rows) < 2:
        return 0.0
    mean_signal = sum(signal for signal, _ in rows) / len(rows)
    return sum(shift * (signal - mean_signal) for signal, shift in rows)


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
