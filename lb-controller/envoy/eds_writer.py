import os
import socket
import tempfile
from pathlib import Path

import yaml

from config import Backend, CLUSTER_NAME


def resolve_host_ip(host: str) -> str:
    return socket.getaddrinfo(host, None, socket.AF_INET)[0][4][0]


def build_cluster_load_assignment(
    backends: tuple[Backend, ...],
    weights: dict[str, int],
    *,
    resolve_hosts: bool = True,
) -> dict:
    lb_endpoints = []

    for backend in backends:
        weight = weights.get(backend.host, 0)
        if weight <= 0:
            continue

        address = resolve_host_ip(backend.host) if resolve_hosts else backend.host

        lb_endpoints.append(
            {
                "endpoint": {
                    "address": {
                        "socket_address": {
                            "address": address,
                            "port_value": backend.port,
                        }
                    }
                },
                "load_balancing_weight": weight,
            }
        )

    return {
        "version_info": "lb-controller",
        "resources": [
            {
                "@type": "type.googleapis.com/envoy.config.endpoint.v3.ClusterLoadAssignment",
                "cluster_name": CLUSTER_NAME,
                "endpoints": [{"lb_endpoints": lb_endpoints}] if lb_endpoints else [],
            }
        ],
    }


def write_eds_file(
    path: str,
    backends: tuple[Backend, ...],
    weights: dict[str, int],
    *,
    resolve_hosts: bool = True,
) -> None:
    payload = build_cluster_load_assignment(backends, weights, resolve_hosts=resolve_hosts)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)

    previous_umask = os.umask(0o022)
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=target.parent,
            delete=False,
            suffix=".tmp",
        ) as handle:
            yaml.safe_dump(payload, handle, sort_keys=False)
            temp_path = handle.name

        os.replace(temp_path, target)
        os.chmod(target, 0o644)
    finally:
        os.umask(previous_umask)
