import unittest
from unittest.mock import patch

from rl.prometheus_client import PrometheusClient


class PrometheusClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = PrometheusClient("http://prometheus")

    def test_non_finite_values_use_default(self) -> None:
        for value in ("NaN", "+Inf", "-Inf"):
            with self.subTest(value=value), patch.object(
                self.client,
                "_instant_query",
                return_value={"status": "success", "data": {"result": [{"value": [0, value]}]}},
            ):
                self.assertEqual(self.client.query_scalar("test_metric", default=0.05), 0.05)

    def test_finite_value_is_returned(self) -> None:
        with patch.object(
            self.client,
            "_instant_query",
            return_value={"status": "success", "data": {"result": [{"value": [0, "0.125"]}]}},
        ):
            self.assertEqual(self.client.query_scalar("test_metric", default=0.05), 0.125)


if __name__ == "__main__":
    unittest.main()