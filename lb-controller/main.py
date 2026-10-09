import logging
import threading
import time

from config import (
    BACKENDS,
    CLUSTER_NAME,
    CONTROL_PORT,
    EDS_PATH,
    LB_ALGORITHM,
    METRICS_PORT,
    RESOLVE_BACKEND_HOSTS,
    UPDATE_INTERVAL_SEC,
)
from control_api import create_control_server
from envoy.eds_writer import write_eds_file
from metrics import set_endpoint_weights, start_metrics_server
from runtime import BalancerRuntime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("lb-controller")


def main() -> None:
    start_metrics_server(METRICS_PORT)
    runtime = BalancerRuntime(LB_ALGORITHM)
    control_server = create_control_server(CONTROL_PORT, runtime)
    threading.Thread(target=control_server.serve_forever, daemon=True).start()
    logger.info(
        "Starting lb-controller algorithm=%s cluster=%s interval=%ss eds=%s metrics_port=%s control_port=%s resolve_hosts=%s",
        LB_ALGORITHM,
        CLUSTER_NAME,
        UPDATE_INTERVAL_SEC,
        EDS_PATH,
        METRICS_PORT,
        CONTROL_PORT,
        RESOLVE_BACKEND_HOSTS,
    )

    while True:
        decision = runtime.select()
        set_endpoint_weights(decision.weights)
        write_eds_file(EDS_PATH, BACKENDS, decision.weights, resolve_hosts=RESOLVE_BACKEND_HOSTS)
        logger.info("Updated EDS weights: %s", decision.weights)
        time.sleep(UPDATE_INTERVAL_SEC)


if __name__ == "__main__":
    main()
