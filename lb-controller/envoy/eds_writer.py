import logging
import os
import socket
import tempfile
from pathlib import Path

import yaml

from config import Backend, CLUSTER_NAME

logger = logging.getLogger("lb-controller.eds")


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

        if resolve_hosts:
            try:
                address = resolve_host_ip(backend.host)
            except socket.gaierror:
                # A stopped container disappears from DNS while its weight is
                # still positive. Leave it out instead of aborting the update.
                logger.warning(
                    "Skipped EDS endpoint %s; its address does not resolve",
                    backend.host,
                )
                continue
        else:
            address = backend.host

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


def write_yaml_atomically(path: str, payload: dict) -> None:
    """Replace the file in one rename so Envoy never reads a half-written one."""
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

        # Before the rename: tempfile creates 0600, and Envoy runs as another
        # user, so a chmod after the rename leaves a window it cannot read.
        os.chmod(temp_path, 0o644)
        os.replace(temp_path, target)
    finally:
        os.umask(previous_umask)


def write_eds_file(
    path: str,
    backends: tuple[Backend, ...],
    weights: dict[str, int],
    *,
    resolve_hosts: bool = True,
) -> None:
    write_yaml_atomically(
        path,
        build_cluster_load_assignment(backends, weights, resolve_hosts=resolve_hosts),
    )
