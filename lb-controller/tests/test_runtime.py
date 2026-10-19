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
            self.assertNotIn("even_load", ids)

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

    def test_learning_flag_survives_an_algorithm_switch(self) -> None:
        class FakeBalancer:
            def __init__(self) -> None:
                self.learning: bool | None = None

            def set_learning_enabled(self, enabled: bool) -> None:
                self.learning = enabled

            def select(self):
                return None

        created: list[FakeBalancer] = []

        def create(algorithm: str) -> FakeBalancer:
            balancer = FakeBalancer()
            created.append(balancer)
            return balancer

        runtime = BalancerRuntime.__new__(BalancerRuntime)
        runtime._lock = threading.RLock()
        runtime._algorithm = "am_ppo"
        runtime._learning_enabled = True
        runtime._create_balancer = create
        runtime._balancer = create("am_ppo")

        runtime.set_learning_enabled(False)
        self.assertFalse(created[0].learning)
        self.assertFalse(runtime.get_configuration()["learning"])

        runtime.set_algorithm("ema")
        self.assertFalse(created[-1].learning)

        runtime.set_learning_enabled(True)
        self.assertTrue(created[-1].learning)

    def test_control_api_toggles_learning(self) -> None:
        runtime = BalancerRuntime("round_robin")
        server = create_control_server(0, runtime)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{server.server_address[1]}"

        def post(body: dict) -> dict:
            request = urllib.request.Request(
                f"{base_url}/api/learning",
                data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=2) as response:
                return json.loads(response.read())

        try:
            self.assertEqual(post({"enabled": False}), {"learning": False})
            with urllib.request.urlopen(f"{base_url}/api/algorithms", timeout=2) as response:
                self.assertFalse(json.loads(response.read())["learning"])
            self.assertEqual(post({"enabled": True}), {"learning": True})

            with self.assertRaises(urllib.error.HTTPError) as error:
                post({"enabled": "no"})
            self.assertEqual(error.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
