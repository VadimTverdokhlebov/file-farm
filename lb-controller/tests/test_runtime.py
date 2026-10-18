import json
import threading
import unittest
import urllib.request

from control_api import create_control_server
from runtime import BalancerRuntime


class BalancerRuntimeTests(unittest.TestCase):
    def test_control_api_lists_and_switches_algorithms(self) -> None:
        runtime = BalancerRuntime("round_robin")
        server = create_control_server(0, runtime)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{server.server_address[1]}"

        try:
            with urllib.request.urlopen(f"{base_url}/api/algorithms", timeout=2) as response:
                initial = json.loads(response.read())
            self.assertEqual(initial["selected"], "round_robin")
            ids = {algorithm["id"] for algorithm in initial["algorithms"]}
            self.assertIn("am_ppo", ids)
            self.assertIn("even_load", ids)

            request = urllib.request.Request(
                f"{base_url}/api/algorithm",
                data=json.dumps({"algorithm": "ema"}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=2) as response:
                switched = json.loads(response.read())
            self.assertEqual(switched["selected"], "ema")
        finally:
            server.shutdown()
            server.server_close()

    def test_control_api_rejects_unsupported_algorithm(self) -> None:
        runtime = BalancerRuntime("round_robin")
        server = create_control_server(0, runtime)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_address[1]}/api/algorithm",
            data=json.dumps({"algorithm": "unknown"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request, timeout=2)
            self.assertEqual(error.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
