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
UPDATE_INTERVAL_SEC = float(os.environ.get("UPDATE_INTERVAL_SEC", "1"))
LB_ALGORITHM = os.environ.get("LB_ALGORITHM", "round_robin")
METRICS_PORT = int(os.environ.get("METRICS_PORT", "9093"))
CONTROL_PORT = int(os.environ.get("CONTROL_PORT", "9094"))
RESOLVE_BACKEND_HOSTS = _parse_bool(os.environ.get("RESOLVE_BACKEND_HOSTS", ""), default=True)

# Comma-separated weights in BACKENDS order (used by weighted_round_robin).
BACKEND_WEIGHTS = os.environ.get("BACKEND_WEIGHTS", "100,100,100,100")

# DQN / RL balancer settings.
PROMETHEUS_URL = os.environ.get("PROMETHEUS_URL", "http://file-farm-prometheus:9090")
METRICS_SOURCE = os.environ.get("METRICS_SOURCE", "prometheus")
DQN_MODEL_PATH = os.environ.get("DQN_MODEL_PATH", "")
DQN_WEIGHT_TOTAL = int(os.environ.get("DQN_WEIGHT_TOTAL", "1000"))
DQN_EPSILON = float(os.environ.get("DQN_EPSILON", "0.1"))
EMA_ALPHA = float(os.environ.get("EMA_ALPHA", "0.2"))

AM_PPO_LEARNING_RATE = float(os.environ.get("AM_PPO_LEARNING_RATE", "0.0003"))
AM_PPO_GAMMA = float(os.environ.get("AM_PPO_GAMMA", "0.99"))
AM_PPO_GAE_LAMBDA = float(os.environ.get("AM_PPO_GAE_LAMBDA", "0.95"))
AM_PPO_CLIP_EPSILON = float(os.environ.get("AM_PPO_CLIP_EPSILON", "0.2"))
AM_PPO_UPDATE_EPOCHS = int(os.environ.get("AM_PPO_UPDATE_EPOCHS", "4"))
AM_PPO_ROLLOUT_SIZE = int(os.environ.get("AM_PPO_ROLLOUT_SIZE", "32"))
AM_PPO_VALUE_COEFFICIENT = float(os.environ.get("AM_PPO_VALUE_COEFFICIENT", "0.5"))
AM_PPO_ENTROPY_COEFFICIENT = float(os.environ.get("AM_PPO_ENTROPY_COEFFICIENT", "0.01"))
AM_PPO_LATENCY_SLA_SECONDS = float(os.environ.get("AM_PPO_LATENCY_SLA_SECONDS", "0.2"))
AM_PPO_REWARD_LATENCY_WEIGHT = float(os.environ.get("AM_PPO_REWARD_LATENCY_WEIGHT", "1.0"))
AM_PPO_REWARD_ERROR_WEIGHT = float(os.environ.get("AM_PPO_REWARD_ERROR_WEIGHT", "10.0"))
AM_PPO_REWARD_CPU_WEIGHT = float(os.environ.get("AM_PPO_REWARD_CPU_WEIGHT", "2.0"))
AM_PPO_REWARD_CHURN_WEIGHT = float(os.environ.get("AM_PPO_REWARD_CHURN_WEIGHT", "0.5"))
AM_PPO_MODEL_PATH = os.environ.get("AM_PPO_MODEL_PATH", "/app/data/am_ppo_model.pt")

# Static capacity hints for each backend (used in the RL state vector).
BACKEND_CPU_LIMITS = os.environ.get("BACKEND_CPU_LIMITS", "0.5,1,0.5,2")
BACKEND_MEMORY_LIMITS_GB = os.environ.get("BACKEND_MEMORY_LIMITS_GB", "1,1,0.5,1.5")
