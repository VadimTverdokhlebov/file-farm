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

    positive = [max(float(logit), 0.0) for logit in raw_logits]
    if sum(positive) <= 0.0:
        positive = [1.0] * len(backends)

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


def equal_eds_weights(backends: tuple[Backend, ...], *, weight_total: int) -> dict[str, int]:
    if not backends:
        raise ValueError("At least one backend is required")

    base = weight_total // len(backends)
    remainder = weight_total % len(backends)
    weights: dict[str, int] = {}

    for index, backend in enumerate(backends):
        weights[backend.host] = base + (1 if index < remainder else 0)

    return weights


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
