import os
import tempfile
import unittest

import yaml

from balancers import create_balancer
from balancers.envoy_native import LeastRequestBalancer, RandomChoiceBalancer
from config import Backend
from envoy.cds_writer import build_cluster_discovery, write_cds_file
from runtime import BalancerRuntime

BACKENDS = (
    Backend(name="server-1", host="server-1", port=50051),
    Backend(name="server-2", host="server-2", port=50051),
    Backend(name="server-3", host="server-3", port=50051),
    Backend(name="server-4", host="server-4", port=50051),
)


class EnvoyNativeTests(unittest.TestCase):
    def test_native_balancers_publish_equal_weights_and_ask_for_their_policy(self) -> None:
        for balancer_class, policy in (
            (LeastRequestBalancer, "LEAST_REQUEST"),
            (RandomChoiceBalancer, "RANDOM"),
        ):
            balancer = balancer_class(BACKENDS, weight_total=1000)
            first = balancer.select().weights
            second = balancer.select().weights

            self.assertEqual(balancer.lb_policy, policy)
            # Envoy picks the host per request, so the weights never move.
            self.assertEqual(first, second)
            self.assertEqual(len(set(first.values())), 1)
            self.assertEqual(sum(first.values()), 1000)

    def test_weight_controllers_run_on_round_robin(self) -> None:
        for algorithm in ("round_robin", "weighted_round_robin"):
            self.assertEqual(create_balancer(algorithm, BACKENDS).lb_policy, "ROUND_ROBIN")

    def test_factory_maps_algorithm_ids_to_native_balancers(self) -> None:
        self.assertEqual(create_balancer("least_request", BACKENDS).lb_policy, "LEAST_REQUEST")
        self.assertEqual(create_balancer("random_choice", BACKENDS).lb_policy, "RANDOM")

    def test_runtime_follows_the_selected_algorithm(self) -> None:
        runtime = BalancerRuntime("round_robin")
        self.assertEqual(runtime.lb_policy, "ROUND_ROBIN")
        runtime.set_algorithm("least_request")
        self.assertEqual(runtime.lb_policy, "LEAST_REQUEST")
        runtime.set_algorithm("random_choice")
        self.assertEqual(runtime.lb_policy, "RANDOM")
        runtime.set_algorithm("weighted_round_robin")
        self.assertEqual(runtime.lb_policy, "ROUND_ROBIN")

    def test_cluster_file_carries_the_policy_and_keeps_the_rest(self) -> None:
        round_robin = build_cluster_discovery("ROUND_ROBIN")["resources"][0]
        least_request = build_cluster_discovery("LEAST_REQUEST")["resources"][0]

        self.assertEqual(round_robin["lb_policy"], "ROUND_ROBIN")
        self.assertEqual(least_request["lb_policy"], "LEAST_REQUEST")
        self.assertEqual(least_request["least_request_lb_config"], {"choice_count": 2})
        self.assertNotIn("least_request_lb_config", round_robin)
        # Everything but the policy is identical, so the cluster swap is clean.
        for key in ("name", "type", "eds_cluster_config", "health_checks", "track_cluster_stats"):
            self.assertEqual(round_robin[key], least_request[key])
        self.assertEqual(round_robin["name"], "grpc_backend")

    def test_a_host_that_left_eds_is_dropped_at_once(self) -> None:
        cluster = build_cluster_discovery("ROUND_ROBIN")["resources"][0]

        # Otherwise Envoy keeps a dead host until two health checks fail, and every
        # closed-loop client queues behind it.
        self.assertTrue(cluster["ignore_health_on_host_removal"])
        self.assertEqual(cluster["connect_timeout"], "1s")

    def test_unknown_policy_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            build_cluster_discovery("MAGLEV")

    def test_cluster_file_is_replaced_in_one_piece(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "clusters.yaml")
            write_cds_file(path, "ROUND_ROBIN")
            write_cds_file(path, "RANDOM")

            with open(path, encoding="utf-8") as handle:
                payload = yaml.safe_load(handle)
            self.assertEqual(payload["resources"][0]["lb_policy"], "RANDOM")
            self.assertEqual(os.listdir(directory), ["clusters.yaml"])
            # Readable by Envoy's user from the first moment the file exists.
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o644)


if __name__ == "__main__":
    unittest.main()
