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
