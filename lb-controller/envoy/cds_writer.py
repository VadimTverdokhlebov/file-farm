from config import CLUSTER_NAME, EDS_PATH
from envoy.eds_writer import write_yaml_atomically

SUPPORTED_POLICIES = ("ROUND_ROBIN", "LEAST_REQUEST", "RANDOM")


def build_cluster_discovery(lb_policy: str, *, eds_path: str = EDS_PATH) -> dict:
    """The grpc_backend cluster as Envoy reads it from the CDS file.

    Only lb_policy changes between algorithms. Envoy swaps the cluster in place:
    the old one keeps serving until the new one is warm, then connections drain.
    """
    if lb_policy not in SUPPORTED_POLICIES:
        raise ValueError(f"Unsupported Envoy lb_policy: {lb_policy}")

    cluster = {
        "@type": "type.googleapis.com/envoy.config.cluster.v3.Cluster",
        "name": CLUSTER_NAME,
        "connect_timeout": "5s",
        "type": "EDS",
        "http2_protocol_options": {},
        "lb_policy": lb_policy,
        "eds_cluster_config": {
            "eds_config": {
                "path_config_source": {"path": eds_path},
                "resource_api_version": "V3",
            },
            "service_name": CLUSTER_NAME,
        },
        "track_cluster_stats": {"per_endpoint_stats": True},
        "health_checks": [
            {
                "timeout": "1s",
                "interval": "5s",
                "unhealthy_threshold": 2,
                "healthy_threshold": 1,
                "tcp_health_check": {},
            }
        ],
    }
    if lb_policy == "LEAST_REQUEST":
        # Power of two choices, written out so the baseline is explicit.
        cluster["least_request_lb_config"] = {"choice_count": 2}

    return {"version_info": f"lb-controller-{lb_policy.lower()}", "resources": [cluster]}


def write_cds_file(path: str, lb_policy: str, *, eds_path: str = EDS_PATH) -> None:
    write_yaml_atomically(path, build_cluster_discovery(lb_policy, eds_path=eds_path))
