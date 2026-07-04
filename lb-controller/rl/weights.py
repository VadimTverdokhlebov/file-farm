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
