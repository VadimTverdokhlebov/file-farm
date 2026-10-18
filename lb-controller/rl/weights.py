import math

from config import Backend


def logits_to_eds_weights(
    backends: tuple[Backend, ...],
    raw_logits: tuple[float, ...],
    *,
    weight_total: int,
    min_weight: int = 1,
) -> dict[str, int]:
    if len(raw_logits) != len(backends):
        raise ValueError(f"Expected {len(backends)} logits, got {len(raw_logits)}")
    if weight_total <= 0:
        raise ValueError("weight_total must be positive")

    positive = [
        max(float(logit), 0.0) if math.isfinite(float(logit)) else 0.0
        for logit in raw_logits
    ]
    if sum(positive) <= 0.0:
        return equal_eds_weights(backends, weight_total=weight_total)

    total_positive = sum(positive)
    weights: dict[str, int] = {}
    assigned = 0

    for index, backend in enumerate(backends):
        if index == len(backends) - 1:
            weight = max(weight_total - assigned, min_weight)
        else:
            weight = max(int(round(positive[index] / total_positive * weight_total)), min_weight)
            assigned += weight
        weights[backend.host] = weight

    return _rebalance_to_total(weights, backends, weight_total, min_weight)


def capacity_eds_weights(
    backends: tuple[Backend, ...],
    capacities: tuple[float, ...],
    *,
    weight_total: int,
) -> dict[str, int]:
    """Integer EDS weights proportional to backend capacity, summing to weight_total."""
    if not backends:
        raise ValueError("At least one backend is required")
    if len(capacities) != len(backends):
        raise ValueError(f"Expected {len(backends)} capacities, got {len(capacities)}")
    if weight_total <= 0:
        raise ValueError("weight_total must be positive")

    cleaned: list[float] = []
    for backend, capacity in zip(backends, capacities):
        if not math.isfinite(capacity) or capacity < 0.0:
            raise ValueError(f"Capacity for {backend.name} must be non-negative, got {capacity}")
        cleaned.append(float(capacity))

    total_capacity = sum(cleaned)
    if total_capacity <= 0.0:
        raise ValueError("At least one backend capacity must be positive")

    shares = [capacity / total_capacity * weight_total for capacity in cleaned]
    weights = [int(math.floor(share)) for share in shares]
    remainder = weight_total - sum(weights)
    order = sorted(
        range(len(shares)),
        key=lambda index: shares[index] - weights[index],
        reverse=True,
    )
    for index in range(remainder):
        weights[order[index % len(order)]] += 1

    return {backend.host: weight for backend, weight in zip(backends, weights)}


def equal_eds_weights(backends: tuple[Backend, ...], *, weight_total: int) -> dict[str, int]:
    if not backends:
        raise ValueError("At least one backend is required")

    base = weight_total // len(backends)
    remainder = weight_total % len(backends)
    weights: dict[str, int] = {}

    for index, backend in enumerate(backends):
        weights[backend.host] = base + (1 if index < remainder else 0)

    return weights


# Stop nudging once CPUs are already within a couple of points, otherwise a
# 0.1s loop would swap the same 5 points forever.
_CPU_DEADBAND = 0.02
_EVEN_LOAD_STEP = 5


def step_toward_even_load(
    backends: tuple[Backend, ...],
    current: dict[str, int],
    cpu: tuple[float, ...],
    alive_mask: tuple[bool, ...],
    *,
    weight_total: int,
    max_step: int = _EVEN_LOAD_STEP,
) -> dict[str, int]:
    """Shift weight by at most max_step toward equal CPU.

    Health and CPU are the only inputs. The backend count is whatever the
    caller passes. A stopped server goes to 0 immediately; a live server never
    moves by more than max_step in one decision.
    """
    if len(cpu) != len(backends) or len(alive_mask) != len(backends):
        raise ValueError("CPU and health must match backend count")
    if max_step < 0:
        raise ValueError("max_step must be non-negative")
    if weight_total <= 0:
        raise ValueError("weight_total must be positive")

    healthy = [index for index, is_alive in enumerate(alive_mask) if is_alive]
    weights = {backend.host: 0 for backend in backends}
    if not healthy:
        return weights

    cpus = [_unit(cpu[index]) for index in healthy]
    mean_cpu = sum(cpus) / len(cpus)
    floors: dict[str, int] = {}
    ceilings: dict[str, int] = {}
    hosts: list[str] = []
    for index, cpu_value in zip(healthy, cpus):
        host = backends[index].host
        base = max(current.get(host, 0), 0)
        floor = max(1, base - max_step)
        ceiling = base + max_step
        if cpu_value > mean_cpu + _CPU_DEADBAND:
            delta = -max_step
        elif cpu_value < mean_cpu - _CPU_DEADBAND:
            delta = max_step
        else:
            delta = 0
        weights[host] = min(max(base + delta, floor), ceiling)
        floors[host] = floor
        ceilings[host] = ceiling
        hosts.append(host)

    _fit_inside_step(weights, hosts, floors, ceilings, weight_total)
    return weights


def _unit(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return min(max(value, 0.0), 1.0)


def _fit_inside_step(
    weights: dict[str, int],
    hosts: list[str],
    floors: dict[str, int],
    ceilings: dict[str, int],
    weight_total: int,
) -> None:
    # Unlike the model step, ceilings are never relaxed. A stopped server sheds
    # its weight at once, and the survivors pick up at most one step.
    for _ in range(weight_total):
        total = sum(weights[host] for host in hosts)
        if total == weight_total:
            return
        if total < weight_total:
            room = [host for host in hosts if weights[host] < ceilings[host]]
            if not room:
                return
            host = max(room, key=lambda item: ceilings[item] - weights[item])
            weights[host] += 1
            continue
        room = [host for host in hosts if weights[host] > floors[host]]
        if not room:
            return
        host = max(room, key=lambda item: weights[item] - floors[item])
        weights[host] -= 1


def _apply_capped_step(
    backends: tuple[Backend, ...],
    current: dict[str, int],
    healthy: list[int],
    deltas: list[float],
    weights: dict[str, int],
    weight_total: int,
    max_step: int,
) -> dict[str, int]:
    floors: dict[str, int] = {}
    ceilings: dict[str, int] = {}
    hosts: list[str] = []
    for index, delta in zip(healthy, deltas):
        host = backends[index].host
        base = max(current.get(host, 0), 0)
        floor = max(1, base - max_step)
        ceiling = base + max_step
        weights[host] = min(max(int(round(base + delta)), floor), ceiling)
        floors[host] = floor
        ceilings[host] = ceiling
        hosts.append(host)

    _fit_weight_total(weights, hosts, floors, ceilings, weight_total)
    return weights


def step_toward_even_cpu(
    backends: tuple[Backend, ...],
    current: dict[str, int],
    cpu_utilization: tuple[float, ...],
    alive_mask: tuple[bool, ...],
    logits: tuple[float, ...],
    *,
    weight_total: int,
    max_step: int = 20,
    cpu_gain: float = 0.2,
) -> dict[str, int]:
    """Move one capped step from the current weights toward equal CPU.

    A server at 40% with weight 70 gains at most max_step, not a new softmax share.
    The network logit is only a nudge inside that same cap. A stopped server drops
    to 0 so traffic leaves it; that mass is the one case that may exceed the cap.
    """
    if len(cpu_utilization) != len(backends) or len(alive_mask) != len(backends):
        raise ValueError("CPU and health must match backend count")
    if max_step < 0:
        raise ValueError("max_step must be non-negative")
    if weight_total <= 0:
        raise ValueError("weight_total must be positive")

    healthy = [index for index, is_alive in enumerate(alive_mask) if is_alive]
    weights = {backend.host: 0 for backend in backends}
    if not healthy:
        return weights
    if weight_total < len(healthy):
        raise ValueError("weight_total must be at least the number of healthy backends")

    cpus = [
        min(max(cpu_utilization[index], 0.0), 1.0)
        if math.isfinite(cpu_utilization[index])
        else 0.0
        for index in healthy
    ]
    mean_cpu = sum(cpus) / len(cpus)
    deltas: list[float] = []
    for index, cpu in zip(healthy, cpus):
        logit = logits[index] if index < len(logits) and math.isfinite(logits[index]) else 0.0
        nudge = math.tanh(logit) * (max_step / 2.0)
        raw = cpu_gain * (mean_cpu - cpu) * weight_total + nudge
        deltas.append(min(max(raw, -float(max_step)), float(max_step)))

    return _apply_capped_step(backends, current, healthy, deltas, weights, weight_total, max_step)


def _fit_weight_total(
    weights: dict[str, int],
    hosts: list[str],
    floors: dict[str, int],
    ceilings: dict[str, int],
    weight_total: int,
) -> None:
    # ±1 adjustments stay inside the step cap. If a stopped server freed more
    # weight than the cap can absorb, the ceilings are relaxed one point at a time.
    for _ in range(weight_total * 4):
        total = sum(weights[host] for host in hosts)
        if total == weight_total:
            return
        if total < weight_total:
            room = [host for host in hosts if weights[host] < ceilings[host]]
            if not room:
                host = hosts[0]
                ceilings[host] += 1
                room = [host]
            host = max(room, key=lambda item: ceilings[item] - weights[item])
            weights[host] += 1
            continue
        room = [host for host in hosts if weights[host] > floors[host]]
        if not room:
            room = [host for host in hosts if weights[host] > 1]
        if not room:
            return
        host = max(room, key=lambda item: weights[item] - floors[item])
        weights[host] -= 1


def masked_logits_to_eds_weights(
    backends: tuple[Backend, ...],
    raw_logits: tuple[float, ...],
    alive_mask: tuple[bool, ...],
    *,
    weight_total: int,
) -> dict[str, int]:
    if len(raw_logits) != len(backends) or len(alive_mask) != len(backends):
        raise ValueError("Logits and health mask must match backend count")
    if weight_total <= 0:
        raise ValueError("weight_total must be positive")

    active_indices = [index for index, is_alive in enumerate(alive_mask) if is_alive]
    weights = {backend.host: 0 for backend in backends}
    if not active_indices:
        return weights
    if weight_total < len(active_indices):
        raise ValueError("weight_total must be at least the number of healthy backends")

    finite_logits = [
        float(raw_logits[index]) if math.isfinite(float(raw_logits[index])) else 0.0
        for index in active_indices
    ]
    max_logit = max(finite_logits)
    scores = [math.exp(max(-80.0, logit - max_logit)) for logit in finite_logits]
    score_total = sum(scores)
    shares = [score / score_total * weight_total for score in scores]
    active_weights = [max(1, int(share)) for share in shares]

    while sum(active_weights) > weight_total:
        index = max(
            (i for i, weight in enumerate(active_weights) if weight > 1),
            key=lambda i: active_weights[i] - shares[i],
        )
        active_weights[index] -= 1

    remainders = sorted(
        range(len(shares)),
        key=lambda i: shares[i] - int(shares[i]),
        reverse=True,
    )
    for index in range(weight_total - sum(active_weights)):
        active_weights[remainders[index % len(remainders)]] += 1

    for index, weight in zip(active_indices, active_weights):
        weights[backends[index].host] = weight
    return weights


def _rebalance_to_total(
    weights: dict[str, int],
    backends: tuple[Backend, ...],
    weight_total: int,
    min_weight: int,
) -> dict[str, int]:
    current_total = sum(weights.values())
    if current_total == weight_total:
        return weights

    adjusted = dict(weights)
    delta = weight_total - current_total
    host = backends[0].host
    adjusted[host] = max(adjusted[host] + delta, min_weight)
    return adjusted
