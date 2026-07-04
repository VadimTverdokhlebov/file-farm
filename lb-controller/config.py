import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Backend:
    name: str
    host: str
    port: int


BACKENDS = (
    Backend(name="server-1", host="file-farm-server-1", port=50051),
    Backend(name="server-2", host="file-farm-server-2", port=50051),
    Backend(name="server-3", host="file-farm-server-3", port=50051),
)

CLUSTER_NAME = os.environ.get("CLUSTER_NAME", "grpc_backend")
EDS_PATH = os.environ.get("EDS_PATH", "/etc/envoy/dynamic/endpoints.yaml")
UPDATE_INTERVAL_SEC = float(os.environ.get("UPDATE_INTERVAL_SEC", "1"))
LB_ALGORITHM = os.environ.get("LB_ALGORITHM", "round_robin")
METRICS_PORT = int(os.environ.get("METRICS_PORT", "9093"))

# Comma-separated weights for server-1, server-2, server-3 (used by weighted_round_robin).
BACKEND_WEIGHTS = os.environ.get("BACKEND_WEIGHTS", "100,100,100")

# DQN / RL balancer settings.
PROMETHEUS_URL = os.environ.get("PROMETHEUS_URL", "http://file-farm-prometheus:9090")
METRICS_SOURCE = os.environ.get("METRICS_SOURCE", "prometheus")
DQN_MODEL_PATH = os.environ.get("DQN_MODEL_PATH", "")
DQN_WEIGHT_TOTAL = int(os.environ.get("DQN_WEIGHT_TOTAL", "1000"))
DQN_EPSILON = float(os.environ.get("DQN_EPSILON", "0.1"))
EMA_ALPHA = float(os.environ.get("EMA_ALPHA", "0.2"))

# Static capacity hints for each backend (used in the RL state vector).
BACKEND_CPU_LIMITS = os.environ.get("BACKEND_CPU_LIMITS", "1,1,1")
BACKEND_MEMORY_LIMITS_GB = os.environ.get("BACKEND_MEMORY_LIMITS_GB", "1,1,1")
