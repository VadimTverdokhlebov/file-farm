import logging
import time

from balancers import create_balancer
from config import BACKENDS, CLUSTER_NAME, EDS_PATH, LB_ALGORITHM, UPDATE_INTERVAL_SEC
from envoy.eds_writer import write_eds_file

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("lb-controller")


def main() -> None:
    balancer = create_balancer(LB_ALGORITHM, BACKENDS)
    logger.info(
        "Starting lb-controller algorithm=%s cluster=%s interval=%ss eds=%s",
        LB_ALGORITHM,
        CLUSTER_NAME,
        UPDATE_INTERVAL_SEC,
        EDS_PATH,
    )

    while True:
        decision = balancer.select()
        write_eds_file(EDS_PATH, BACKENDS, decision.weights)
        logger.info("Updated EDS weights: %s", decision.weights)
        time.sleep(UPDATE_INTERVAL_SEC)


if __name__ == "__main__":
    main()
