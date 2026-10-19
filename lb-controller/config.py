import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class Backend:
    name: str
    host: str
    port: int


DEFAULT_BACKENDS = (
    Backend(name="server-1", host="file-farm-server-1", port=50051),
    Backend(name="server-2", host="file-farm-server-2", port=50051),
    Backend(name="server-3", host="file-farm-server-3", port=50051),
    Backend(name="server-4", host="file-farm-server-4", port=50051),
)


def _parse_backends(raw: str) -> tuple[Backend, ...]:
    backends: list[Backend] = []
    for index, item in enumerate(part.strip() for part in raw.split(",") if part.strip()):
        fields = [field.strip() for field in item.split(":")]
        if len(fields) == 2:
            name = f"server-{index + 1}"
            host, port = fields
        elif len(fields) == 3:
            name, host, port = fields
        else:
            raise ValueError(
                "BACKENDS must be comma-separated entries in host:port or name:host:port format"
            )
        backends.append(Backend(name=name, host=host, port=int(port)))

    if not backends:
        raise ValueError("BACKENDS must contain at least one backend")
    return tuple(backends)


def _parse_bool(raw: str, *, default: bool) -> bool:
    if raw == "":
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


BACKENDS = _parse_backends(os.environ["BACKENDS"]) if os.environ.get("BACKENDS") else DEFAULT_BACKENDS
CLUSTER_NAME = os.environ.get("CLUSTER_NAME", "grpc_backend")
EDS_PATH = os.environ.get("EDS_PATH", "/etc/envoy/dynamic/endpoints.yaml")
UPDATE_INTERVAL_SEC = float(os.environ.get("UPDATE_INTERVAL_SEC", "0.1"))
LB_ALGORITHM = os.environ.get("LB_ALGORITHM", "round_robin")
METRICS_PORT = int(os.environ.get("METRICS_PORT", "9093"))
CONTROL_PORT = int(os.environ.get("CONTROL_PORT", "9094"))
RESOLVE_BACKEND_HOSTS = _parse_bool(os.environ.get("RESOLVE_BACKEND_HOSTS", ""), default=True)

# Unused by WRR. Weighted round robin derives EDS weights from BACKEND_CPU_LIMITS.
BACKEND_WEIGHTS = os.environ.get("BACKEND_WEIGHTS", "100,100,100,100")

# DQN / RL balancer settings.
PROMETHEUS_URL = os.environ.get("PROMETHEUS_URL", "http://file-farm-prometheus:9090")
METRICS_SOURCE = os.environ.get("METRICS_SOURCE", "prometheus")
DQN_MODEL_PATH = os.environ.get("DQN_MODEL_PATH", "")
DQN_WEIGHT_TOTAL = int(os.environ.get("DQN_WEIGHT_TOTAL", "1000"))
DQN_EPSILON = float(os.environ.get("DQN_EPSILON", "0.1"))
EMA_ALPHA = float(os.environ.get("EMA_ALPHA", "0.2"))

AM_PPO_LEARNING_RATE = float(os.environ.get("AM_PPO_LEARNING_RATE", "0.001"))
AM_PPO_GAMMA = float(os.environ.get("AM_PPO_GAMMA", "0.9"))
AM_PPO_GAE_LAMBDA = float(os.environ.get("AM_PPO_GAE_LAMBDA", "0.95"))
AM_PPO_CLIP_EPSILON = float(os.environ.get("AM_PPO_CLIP_EPSILON", "0.2"))
AM_PPO_UPDATE_EPOCHS = int(os.environ.get("AM_PPO_UPDATE_EPOCHS", "4"))
# Start with the policy learning. A test can freeze it through POST /api/learning.
AM_PPO_LEARNING_ENABLED = _parse_bool(os.environ.get("AM_PPO_LEARNING_ENABLED", ""), default=True)
AM_PPO_ROLLOUT_SIZE = int(os.environ.get("AM_PPO_ROLLOUT_SIZE", "16"))
AM_PPO_VALUE_COEFFICIENT = float(os.environ.get("AM_PPO_VALUE_COEFFICIENT", "0.5"))
AM_PPO_ENTROPY_COEFFICIENT = float(os.environ.get("AM_PPO_ENTROPY_COEFFICIENT", "0.001"))
AM_PPO_LATENCY_SLA_SECONDS = float(os.environ.get("AM_PPO_LATENCY_SLA_SECONDS", "0.2"))
AM_PPO_REWARD_LATENCY_WEIGHT = float(os.environ.get("AM_PPO_REWARD_LATENCY_WEIGHT", "1.0"))
AM_PPO_REWARD_ERROR_WEIGHT = float(os.environ.get("AM_PPO_REWARD_ERROR_WEIGHT", "10.0"))
AM_PPO_REWARD_CPU_WEIGHT = float(os.environ.get("AM_PPO_REWARD_CPU_WEIGHT", "0"))
AM_PPO_REWARD_BALANCE_WEIGHT = float(os.environ.get("AM_PPO_REWARD_BALANCE_WEIGHT", "100.0"))
# Mean absolute CPU gap among live servers. Below the balance weight so a
# wrong step still matters, but an even cluster scores better than a split.
AM_PPO_REWARD_SPREAD_WEIGHT = float(os.environ.get("AM_PPO_REWARD_SPREAD_WEIGHT", "20.0"))
AM_PPO_REWARD_DISK_WEIGHT = float(os.environ.get("AM_PPO_REWARD_DISK_WEIGHT", "10.0"))
AM_PPO_REWARD_CAPACITY_WEIGHT = float(os.environ.get("AM_PPO_REWARD_CAPACITY_WEIGHT", "0"))
AM_PPO_CPU_SATURATION = float(os.environ.get("AM_PPO_CPU_SATURATION", "0.90"))
AM_PPO_CPU_HARD_LIMIT = float(os.environ.get("AM_PPO_CPU_HARD_LIMIT", "0.95"))
AM_PPO_MIN_TRAINING_RPS = float(os.environ.get("AM_PPO_MIN_TRAINING_RPS", "1.0"))
AM_PPO_REWARD_CHURN_WEIGHT = float(os.environ.get("AM_PPO_REWARD_CHURN_WEIGHT", "0.5"))
AM_PPO_ACTION_HOLD_SEC = float(os.environ.get("AM_PPO_ACTION_HOLD_SEC", "2"))
# How far back to look for the last two scrapes. The value itself is irate(),
# so this is not an average. 5s still finds a pair when one scrape is missed.
AM_PPO_METRICS_WINDOW = os.environ.get("AM_PPO_METRICS_WINDOW", "5s")
AM_PPO_MODEL_PATH = os.environ.get("AM_PPO_MODEL_PATH", "/app/data/am_ppo_model.pt")

# Static capacity hints for WRR and for turning CPU usage into a utilization fraction.
BACKEND_CPU_LIMITS = os.environ.get("BACKEND_CPU_LIMITS", "0.5,1,0.5,2")
BACKEND_MEMORY_LIMITS_GB = os.environ.get("BACKEND_MEMORY_LIMITS_GB", "1,1,0.5,1.5")
