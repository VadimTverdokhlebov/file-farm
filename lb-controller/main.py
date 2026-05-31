import logging
import time

from balancers import create_balancer
from config import BACKEND_WEIGHTS, BACKENDS, CLUSTER_NAME, EDS_PATH, LB_ALGORITHM, METRICS_PORT, UPDATE_INTERVAL_SEC
from envoy.eds_writer import write_eds_file
from metrics import set_algorithm, set_endpoint_weights, start_metrics_server

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("lb-controller")


def main() -> None:
    start_metrics_server(METRICS_PORT)
    set_algorithm(LB_ALGORITHM)
    balancer = create_balancer(LB_ALGORITHM, BACKENDS, backend_weights=BACKEND_WEIGHTS)
    logger.info(
        "Starting lb-controller algorithm=%s cluster=%s interval=%ss eds=%s metrics_port=%s",
        LB_ALGORITHM,
        CLUSTER_NAME,
        UPDATE_INTERVAL_SEC,
        EDS_PATH,
        METRICS_PORT,
    )

    while True:
        decision = balancer.select()
        set_endpoint_weights(decision.weights)
        write_eds_file(EDS_PATH, BACKENDS, decision.weights)
        logger.info("Updated EDS weights: %s", decision.weights)
        time.sleep(UPDATE_INTERVAL_SEC)


if __name__ == "__main__":
    main()
