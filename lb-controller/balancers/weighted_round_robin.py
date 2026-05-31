from config import Backend
from balancers.base import Balancer, LoadDecision


def _parse_backend_weights(raw: str, backends: tuple[Backend, ...]) -> dict[str, int]:
    parts = [part.strip() for part in raw.split(",") if part.strip()]
    if len(parts) != len(backends):
        raise ValueError(
            f"BACKEND_WEIGHTS must contain {len(backends)} comma-separated values, got {len(parts)}"
        )

    weights: dict[str, int] = {}
    for backend, part in zip(backends, parts):
        weight = int(part)
        if weight < 0:
            raise ValueError(f"Weight for {backend.name} must be non-negative, got {weight}")
        weights[backend.host] = weight

    if sum(weights.values()) <= 0:
        raise ValueError("At least one backend weight must be positive")

    return weights


class WeightedRoundRobinBalancer(Balancer):
    def __init__(self, backends: tuple[Backend, ...], weights_raw: str) -> None:
        if not backends:
            raise ValueError("At least one backend is required")

        self._weights = _parse_backend_weights(weights_raw, backends)

    def select(self) -> LoadDecision:
        return LoadDecision(weights=dict(self._weights))
