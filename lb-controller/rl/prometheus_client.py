import json
import logging
import math
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger("lb-controller.prometheus")


class PrometheusClient:
    def __init__(self, base_url: str, *, timeout_sec: float = 5.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_sec = timeout_sec

    def query_scalar(self, promql: str, *, default: float = 0.0) -> float:
        payload = self._instant_query(promql)
        if payload.get("status") != "success":
            logger.warning("Prometheus query failed: %s", promql)
            return default

        result = payload.get("data", {}).get("result", [])
        if not result:
            return default

        value = result[0].get("value", [None, None])[1]
        try:
            scalar = float(value)
        except (TypeError, ValueError):
            return default
        if not math.isfinite(scalar):
            logger.debug("Prometheus returned a non-finite value for %s; using default", promql)
            return default
        return scalar

    def _instant_query(self, promql: str) -> dict:
        query = urllib.parse.urlencode({"query": promql})
        url = f"{self._base_url}/api/v1/query?{query}"
        request = urllib.request.Request(url)

        try:
            with urllib.request.urlopen(request, timeout=self._timeout_sec) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            logger.warning("Prometheus request error for %s: %s", promql, error)
            return {"status": "error"}
