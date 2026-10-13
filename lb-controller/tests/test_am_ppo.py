import unittest

import torch

from balancers.am_ppo_balancer import AMPPOBalancer
from config import Backend
from envoy.eds_writer import build_cluster_load_assignment
from rl.am_ppo_model import AMPPORLModel
from rl.metrics_source import StubMetricsSource
from rl.prometheus_metrics_source import PrometheusMetricsSource, cpu_utilization_ratio
from rl.types import ClusterState, ServerState
from balancers.weighted_round_robin import WeightedRoundRobinBalancer
from rl.weights import capacity_eds_weights, logits_to_eds_weights, masked_logits_to_eds_weights


BACKENDS = (
    Backend(name="server-1", host="server-1", port=50051),
    Backend(name="server-2", host="server-2", port=50051),
)


class RecordingPrometheusClient:
    def __init__(self) -> None:
        self.queries: list[str] = []

    def query_scalar(self, query: str, *, default: float = 0.0) -> float:
        self.queries.append(query)
        return 1.0


def make_state(
    *,
    healthy: tuple[bool, bool] = (True, True),
    cpu: tuple[float, float] = (0.5, 0.5),
    errors: tuple[float, float] = (0.0, 0.0),
    request_rates: tuple[float, float] = (10.0, 10.0),
    latency_p99: float = 0.1,
) -> ClusterState:
    servers = tuple(
        ServerState(
            backend_name=backend.name,
            host=backend.host,
            cpu_utilization=cpu[index],
            cpu_throttling_rate=0.0,
            memory_utilization=0.3,
            active_requests=2.0,
            request_rate_rps=request_rates[index],
            latency_p99_seconds=latency_p99,
            error_rate=errors[index],
            cpu_limit_cores=1.0,
            memory_limit_bytes=1_073_741_824.0,
            is_healthy=healthy[index],
            current_weight_share=0.5,
            disk_io_bytes_per_second=1_000_000.0,
        )
        for index, backend in enumerate(BACKENDS)
    )
    return ClusterState(
        servers=servers,
        cluster_request_rate_rps=sum(request_rates),
        step_index=1,
        timestamp_unix=0.0,
        cluster_latency_p99_seconds=latency_p99,
    )


def make_model(rollout_size: int = 2) -> AMPPORLModel:
    return AMPPORLModel(
        learning_rate=3e-4,
        gamma=0.99,
        gae_lambda=0.95,
        clip_epsilon=0.2,
        update_epochs=1,
        rollout_size=rollout_size,
        value_coefficient=0.5,
        entropy_coefficient=0.01,
        model_path="/tmp/am_ppo_test_model.pt",
    )


class ScriptedMetricsSource:
    def __init__(self, states: list[ClusterState]) -> None:
        self._states = list(states)

    def fetch(self, backends: tuple[Backend, ...], current_weights: dict[str, int]) -> ClusterState:
        del backends, current_weights
        return self._states.pop(0)


class AMPPOTests(unittest.TestCase):
    def test_weighted_round_robin_follows_cpu_capacity(self) -> None:
        backends = (
            Backend(name="server-1", host="file-farm-server-1", port=50051),
            Backend(name="server-2", host="file-farm-server-2", port=50051),
            Backend(name="server-3", host="file-farm-server-3", port=50051),
            Backend(name="server-4", host="file-farm-server-4", port=50051),
        )
        capacities = (0.5, 1.0, 0.5, 2.0)

        weights = capacity_eds_weights(backends, capacities, weight_total=1000)
        decision = WeightedRoundRobinBalancer(backends, capacities, weight_total=1000).select()

        expected = {
            "file-farm-server-1": 125,
            "file-farm-server-2": 250,
            "file-farm-server-3": 125,
            "file-farm-server-4": 500,
        }
        self.assertEqual(weights, expected)
        self.assertEqual(decision.weights, expected)
        self.assertEqual(sum(decision.weights.values()), 1000)

    def test_masked_weights_exclude_unhealthy_backend(self) -> None:
        weights = masked_logits_to_eds_weights(
            BACKENDS,
            (10.0, 100.0),
            (True, False),
            weight_total=1000,
        )

        self.assertEqual(weights, {"server-1": 1000, "server-2": 0})

    def test_all_unhealthy_backends_receive_zero_weight(self) -> None:
        weights = masked_logits_to_eds_weights(
            BACKENDS,
            (0.0, 0.0),
            (False, False),
            weight_total=1000,
        )

        self.assertEqual(sum(weights.values()), 0)

    def test_non_finite_scores_fall_back_to_equal_weights(self) -> None:
        weights = logits_to_eds_weights(
            BACKENDS,
            (float("nan"), float("inf")),
            weight_total=1000,
        )

        self.assertEqual(weights, {"server-1": 500, "server-2": 500})

    def test_empty_health_mask_produces_empty_eds_assignment(self) -> None:
        assignment = build_cluster_load_assignment(
            BACKENDS,
            {"server-1": 0, "server-2": 0},
            resolve_hosts=False,
        )

        self.assertEqual(assignment["resources"][0]["endpoints"], [])

    def test_prometheus_source_uses_exported_ids_and_health_metrics(self) -> None:
        source = PrometheusMetricsSource(
            BACKENDS,
            "http://prometheus",
            cpu_limits=(1.0, 1.0),
            memory_limits_bytes=(1_073_741_824.0, 1_073_741_824.0),
        )
        client = RecordingPrometheusClient()
        source._client = client

        state = source.fetch(BACKENDS, {"server-1": 500, "server-2": 500})

        self.assertTrue(state.servers[0].is_healthy)
        self.assertTrue(any('exported_instance="1"' in query for query in client.queries))
        self.assertIn('up{job="server",instance="server-1:9092"}', client.queries)
        self.assertTrue(any("container_fs_reads_bytes_total" in query for query in client.queries))

    def test_ppo_updates_after_collecting_rollout(self) -> None:
        model = make_model()
        first_state = make_state()
        second_state = make_state(cpu=(0.9, 0.4), latency_p99=0.3)
        first_action = model.act(first_state, BACKENDS, weight_total=1000)
        model.observe_transition(first_state, first_action, -0.2, second_state)
        second_action = model.act(second_state, BACKENDS, weight_total=1000)
        model.observe_transition(second_state, second_action, -1.0, first_state)

        self.assertEqual(model._rollout, [])
        self.assertTrue(all(torch.isfinite(parameter).all() for parameter in model.parameters()))

    def test_reward_combines_sla_errors_cpu_and_weight_churn(self) -> None:
        balancer = AMPPOBalancer(
            BACKENDS,
            metrics_source=StubMetricsSource(
                BACKENDS,
                cpu_limits=(1.0, 1.0),
                memory_limits_bytes=(1_073_741_824.0, 1_073_741_824.0),
            ),
            model=make_model(),
            weight_total=1000,
            latency_sla_seconds=0.2,
            latency_weight=1.0,
            error_weight=10.0,
            cpu_weight=2.0,
            balance_weight=0.0,
            churn_weight=0.5,
        )

        reward = balancer._compute_reward(
            make_state(
                cpu=(0.9, 0.8),
                errors=(0.1, 0.3),
                request_rates=(10.0, 30.0),
                latency_p99=0.4,
            ),
            {"server-1": 500, "server-2": 500},
            {"server-1": 1000, "server-2": 0},
        )

        self.assertAlmostEqual(reward, -4.75)

    def test_cpu_penalty_starts_at_90_percent_and_uses_heavier_weight(self) -> None:
        balancer = AMPPOBalancer(
            BACKENDS,
            metrics_source=StubMetricsSource(
                BACKENDS,
                cpu_limits=(1.0, 1.0),
                memory_limits_bytes=(1_073_741_824.0, 1_073_741_824.0),
            ),
            model=make_model(),
            weight_total=1000,
            latency_sla_seconds=0.2,
            cpu_saturation=0.90,
            latency_weight=1.0,
            error_weight=10.0,
            cpu_weight=8.0,
            balance_weight=0.0,
            churn_weight=0.5,
        )

        reward = balancer._compute_reward(
            make_state(
                cpu=(1.0, 0.95),
                errors=(0.0, 0.0),
                request_rates=(10.0, 10.0),
                latency_p99=0.0,
            ),
            {"server-1": 500, "server-2": 500},
            {"server-1": 500, "server-2": 500},
        )

        # 100% -> 8, 95% -> 1, weight 8. A full server costs far more than a 2s p99 (10).
        self.assertAlmostEqual(reward, -72.0)

        hot_tail = balancer._compute_reward(
            make_state(
                cpu=(1.0, 0.5),
                errors=(0.0, 0.0),
                request_rates=(10.0, 10.0),
                latency_p99=2.0,
            ),
            {"server-1": 500, "server-2": 500},
            {"server-1": 500, "server-2": 500},
        )
        calm_tail = balancer._compute_reward(
            make_state(
                cpu=(0.9, 0.9),
                errors=(0.0, 0.0),
                request_rates=(10.0, 10.0),
                latency_p99=2.0,
            ),
            {"server-1": 500, "server-2": 500},
            {"server-1": 500, "server-2": 500},
        )
        self.assertAlmostEqual(hot_tail, -74.0)
        self.assertAlmostEqual(calm_tail, -10.0)
        self.assertLess(hot_tail, calm_tail)

    def test_even_cpu_utilization_scores_better_than_a_split(self) -> None:
        balancer = AMPPOBalancer(
            BACKENDS,
            metrics_source=StubMetricsSource(
                BACKENDS,
                cpu_limits=(1.0, 1.0),
                memory_limits_bytes=(1_073_741_824.0, 1_073_741_824.0),
            ),
            model=make_model(),
            weight_total=1000,
            latency_sla_seconds=0.2,
            latency_weight=0.0,
            error_weight=0.0,
            cpu_weight=0.0,
            balance_weight=4.0,
            churn_weight=0.0,
        )
        same_weights = {"server-1": 500, "server-2": 500}

        even = balancer._compute_reward(
            make_state(cpu=(0.6, 0.6), latency_p99=0.0),
            same_weights,
            same_weights,
        )
        split = balancer._compute_reward(
            make_state(cpu=(0.95, 0.35), latency_p99=0.0),
            same_weights,
            same_weights,
        )

        self.assertAlmostEqual(even, 0.0)
        self.assertAlmostEqual(split, -2.4)
        self.assertGreater(even, split)

    def test_idle_traffic_does_not_enter_the_rollout(self) -> None:
        idle = make_state(request_rates=(0.0, 0.0))
        loaded = make_state(request_rates=(10.0, 10.0))
        model = make_model(rollout_size=8)
        balancer = AMPPOBalancer(
            BACKENDS,
            metrics_source=ScriptedMetricsSource([loaded, idle, idle, loaded]),
            model=model,
            min_training_rps=1.0,
        )

        for _ in range(4):
            balancer.select()

        self.assertEqual(model._rollout, [])

    def test_two_core_server_at_two_cores_is_fully_busy_not_over_capacity(self) -> None:
        self.assertAlmostEqual(cpu_utilization_ratio(2.0, 2.0), 1.0)
        self.assertAlmostEqual(cpu_utilization_ratio(1.0, 2.0), 0.5)
        self.assertAlmostEqual(cpu_utilization_ratio(2.4, 2.0), 1.0)


if __name__ == "__main__":
    unittest.main()