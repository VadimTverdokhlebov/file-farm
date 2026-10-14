from config import (
    BACKEND_CPU_LIMITS,
    BACKEND_MEMORY_LIMITS_GB,
    METRICS_SOURCE,
    PROMETHEUS_URL,
)
from rl.metrics_source import MetricsSource, StubMetricsSource
from rl.prometheus_metrics_source import PrometheusMetricsSource


def parse_capacity_lists(backends) -> tuple[tuple[float, ...], tuple[float, ...]]:
    cpu_limits = _parse_float_list(BACKEND_CPU_LIMITS, backends)
    memory_limits_gb = _parse_float_list(BACKEND_MEMORY_LIMITS_GB, backends)
    memory_limits_bytes = tuple(value * 1_073_741_824.0 for value in memory_limits_gb)
    return cpu_limits, memory_limits_bytes


def create_metrics_source(backends, rate_window: str = "1m") -> MetricsSource:
    cpu_limits, memory_limits_bytes = parse_capacity_lists(backends)

    if METRICS_SOURCE == "stub":
        return StubMetricsSource(
            backends,
            cpu_limits=cpu_limits,
            memory_limits_bytes=memory_limits_bytes,
        )

    return PrometheusMetricsSource(
        backends,
        PROMETHEUS_URL,
        cpu_limits=cpu_limits,
        memory_limits_bytes=memory_limits_bytes,
        rate_window=rate_window,
    )


def _parse_float_list(raw: str, backends) -> tuple[float, ...]:
    parts = [part.strip() for part in raw.split(",") if part.strip()]
    if len(parts) != len(backends):
        raise ValueError(
            f"Capacity list must contain {len(backends)} comma-separated values, got {len(parts)}"
        )
    return tuple(float(part) for part in parts)
