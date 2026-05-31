from prometheus_client import Gauge, Info, start_http_server

algorithm_info = Info(
    "lb_controller_algorithm",
    "Active load balancing algorithm configured in lb-controller",
)

endpoint_weight = Gauge(
    "lb_controller_endpoint_weight",
    "Endpoint weight pushed to Envoy via file-based EDS",
    ["host"],
)


def start_metrics_server(port: int) -> None:
    start_http_server(port)


def set_algorithm(algorithm: str) -> None:
    algorithm_info.info({"algorithm": algorithm})


def set_endpoint_weights(weights: dict[str, int]) -> None:
    for host, weight in weights.items():
        endpoint_weight.labels(host=host).set(weight)
