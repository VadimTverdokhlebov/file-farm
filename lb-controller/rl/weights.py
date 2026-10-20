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
    # A server that stopped leaves its weight behind. Spread it over the live ones in
    # proportion to what they hold, so the step starts from a full, sensible split
    # instead of piling the freed share on one server.
    live_total = sum(max(current.get(backends[index].host, 0), 0) for index in healthy)
    scale = weight_total / live_total if live_total > 0 else 1.0
    for index, delta in zip(healthy, deltas):
        host = backends[index].host
        base = int(round(max(current.get(host, 0), 0) * scale))
        floor = max(1, base - max_step)
        ceiling = base + max_step
        weights[host] = min(max(int(round(base + delta)), floor), ceiling)
        floors[host] = floor
        ceilings[host] = ceiling
        hosts.append(host)

    _fit_weight_total(weights, hosts, floors, ceilings, weight_total)
    return weights


# Share of the capped step that comes from the network. The CPU gap fills the rest.
_NETWORK_STEP_SHARE = 0.70


def network_step_deltas(
    logits: tuple[float, ...],
    alive_mask: tuple[bool, ...],
    *,
    max_step: int = 20,
) -> list[float]:
    """Weight points the network alone asks for, per backend. Zero for a stopped one.

    Only the gap between servers counts, so the mean logit of the live ones is
    removed first. The same number feeds the step and the reward.
    """
    healthy = [index for index, is_alive in enumerate(alive_mask) if is_alive]
    deltas = [0.0] * len(alive_mask)
    if not healthy:
        return deltas
    values = [
        logits[index] if index < len(logits) and math.isfinite(logits[index]) else 0.0
        for index in healthy
    ]
    mean_value = sum(values) / len(values)
    for index, value in zip(healthy, values):
        deltas[index] = math.tanh(value - mean_value) * max_step
    return deltas


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
    network_share: float = _NETWORK_STEP_SHARE,
) -> dict[str, int]:
    """Move one capped step. The network supplies network_share of that step.

    Both parts are clipped to ±max_step first, then mixed. A saturated logit
    therefore moves 70% of the step and the CPU gap moves the other 30%.
    A server at 40% with weight 70 still cannot jump to a new share in one
    decision. A stopped server drops to 0; that mass may exceed the cap.
    """
    if len(cpu_utilization) != len(backends) or len(alive_mask) != len(backends):
        raise ValueError("CPU and health must match backend count")
    if max_step < 0:
        raise ValueError("max_step must be non-negative")
    if weight_total <= 0:
        raise ValueError("weight_total must be positive")
    if not 0.0 <= network_share <= 1.0:
        raise ValueError("network_share must be between 0 and 1")

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
    network_deltas = network_step_deltas(logits, alive_mask, max_step=max_step)
    deltas: list[float] = []
    for index, cpu in zip(healthy, cpus):
        cpu_raw = cpu_gain * (mean_cpu - cpu) * weight_total
        cpu_delta = min(max(cpu_raw, -float(max_step)), float(max_step))
        raw = network_share * network_deltas[index] + (1.0 - network_share) * cpu_delta
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
