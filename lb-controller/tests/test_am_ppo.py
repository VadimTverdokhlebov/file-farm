import math
import os
import re
import socket
import unittest
from unittest.mock import patch

import torch

from balancers.am_ppo_balancer import AMPPOBalancer
from config import Backend
from envoy.eds_writer import build_cluster_load_assignment
from rl.am_ppo_model import AMPPORLModel
from rl.metrics_source import StubMetricsSource
from rl.prometheus_metrics_source import PrometheusMetricsSource, cpu_utilization_ratio
from rl.types import ClusterState, ServerState
from balancers.weighted_round_robin import WeightedRoundRobinBalancer
from rl.weights import (
    capacity_eds_weights,
    logits_to_eds_weights,
    masked_logits_to_eds_weights,
    step_toward_even_cpu,
)


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

    def query_optional(self, query: str) -> float:
        self.queries.append(query)
        return 1.0


def make_state(
    *,
    healthy: tuple[bool, bool] = (True, True),
    cpu: tuple[float, float] = (0.5, 0.5),
    errors: tuple[float, float] = (0.0, 0.0),
    request_rates: tuple[float, float] = (10.0, 10.0),
    latency_p99: float = 0.1,
    cpu_limits: tuple[float, float] = (1.0, 1.0),
    disk: tuple[float, float] = (1_000_000.0, 1_000_000.0),
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
            cpu_limit_cores=cpu_limits[index],
            memory_limit_bytes=1_073_741_824.0,
            is_healthy=healthy[index],
            current_weight_share=0.5,
            disk_io_bytes_per_second=disk[index],
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

    def test_first_am_ppo_weights_follow_cpu_capacity(self) -> None:
        backends = (
            Backend(name="server-1", host="file-farm-server-1", port=50051),
            Backend(name="server-2", host="file-farm-server-2", port=50051),
            Backend(name="server-3", host="file-farm-server-3", port=50051),
            Backend(name="server-4", host="file-farm-server-4", port=50051),
        )
        servers = tuple(
            ServerState(
                backend_name=backend.name,
                host=backend.host,
                cpu_utilization=0.9 if index == 0 else 0.2,
                cpu_throttling_rate=0.0,
                memory_utilization=0.3,
                active_requests=2.0,
                request_rate_rps=10.0,
                latency_p99_seconds=0.1,
                error_rate=0.0,
                cpu_limit_cores=(0.5, 1.0, 0.5, 2.0)[index],
                memory_limit_bytes=1_073_741_824.0,
                is_healthy=index != 2,
                current_weight_share=0.25,
            )
            for index, backend in enumerate(backends)
        )
        state = ClusterState(
            servers=servers,
            cluster_request_rate_rps=40.0,
            step_index=1,
            timestamp_unix=0.0,
        )
        balancer = AMPPOBalancer(
            backends,
            metrics_source=ScriptedMetricsSource([state]),
            model=make_model(rollout_size=8),
            weight_total=1000,
            cpu_limits=(0.5, 1.0, 0.5, 2.0),
            action_hold_seconds=0.0,
        )

        self.assertEqual(
            balancer.select().weights,
            {
                "file-farm-server-1": 125,
                "file-farm-server-2": 250,
                "file-farm-server-3": 0,
                "file-farm-server-4": 500,
            },
        )

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

    def test_unresolved_backend_is_left_out_of_eds(self) -> None:
        def fake_resolve(host: str) -> str:
            if host == "server-2":
                raise socket.gaierror("Name or service not known")
            return "10.0.0.1"

        with patch("envoy.eds_writer.resolve_host_ip", side_effect=fake_resolve):
            assignment = build_cluster_load_assignment(
                BACKENDS,
                {"server-1": 400, "server-2": 600},
                resolve_hosts=True,
            )

        endpoints = assignment["resources"][0]["endpoints"][0]["lb_endpoints"]
        self.assertEqual(len(endpoints), 1)
        self.assertEqual(endpoints[0]["endpoint"]["address"]["socket_address"]["address"], "10.0.0.1")
        self.assertEqual(endpoints[0]["load_balancing_weight"], 400)

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
        self.assertEqual(model._update_count, 1)

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
            spread_weight=0.0,
            capacity_weight=0.0,
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
            spread_weight=0.0,
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
            spread_weight=0.0,
            churn_weight=0.0,
        )
        same_weights = {"server-1": 500, "server-2": 500}

        uneven = make_state(cpu=(0.95, 0.35), latency_p99=0.0)
        even = balancer._compute_reward(uneven, same_weights, same_weights)
        onto_hot = balancer._compute_reward(
            uneven,
            same_weights,
            {"server-1": 800, "server-2": 200},
        )
        onto_cold = balancer._compute_reward(
            uneven,
            same_weights,
            {"server-1": 200, "server-2": 800},
        )
        saturated = balancer._compute_reward(
            make_state(cpu=(1.0, 1.0), latency_p99=0.0),
            same_weights,
            {"server-1": 800, "server-2": 200},
        )

        # Equal weights, or equal CPUs, are zero. Weight 4 times covariance 0.18.
        self.assertAlmostEqual(even, 0.0)
        self.assertAlmostEqual(saturated, 0.0)
        self.assertAlmostEqual(onto_hot, -0.72)
        self.assertAlmostEqual(onto_cold, 0.72)
        self.assertGreater(onto_cold, even)
        self.assertGreater(even, onto_hot)

    def test_cpu_spread_penalizes_an_uneven_cluster(self) -> None:
        balancer = AMPPOBalancer(
            BACKENDS,
            metrics_source=StubMetricsSource(
                BACKENDS,
                cpu_limits=(1.0, 1.0),
                memory_limits_bytes=(1_073_741_824.0, 1_073_741_824.0),
            ),
            model=make_model(),
            weight_total=1000,
            latency_weight=0.0,
            error_weight=0.0,
            cpu_weight=0.0,
            balance_weight=0.0,
            spread_weight=20.0,
            capacity_weight=0.0,
            disk_weight=0.0,
            churn_weight=0.0,
        )
        same = {"server-1": 500, "server-2": 500}
        even = make_state(cpu=(0.65, 0.65), latency_p99=0.0)
        split = make_state(cpu=(0.95, 0.35), latency_p99=0.0)
        dead = make_state(healthy=(True, False), cpu=(0.95, 0.0), latency_p99=0.0)

        self.assertAlmostEqual(balancer._compute_reward(even, same, same), 0.0)
        self.assertAlmostEqual(balancer._compute_reward(split, same, same), -6.0)
        self.assertAlmostEqual(balancer._compute_reward(dead, same, same), 0.0)

    def test_extra_weight_on_a_busy_disk_is_penalized(self) -> None:
        balancer = AMPPOBalancer(
            BACKENDS,
            metrics_source=StubMetricsSource(
                BACKENDS,
                cpu_limits=(1.0, 1.0),
                memory_limits_bytes=(1_073_741_824.0, 1_073_741_824.0),
            ),
            model=make_model(),
            weight_total=1000,
            latency_weight=0.0,
            error_weight=0.0,
            cpu_weight=0.0,
            balance_weight=0.0,
            capacity_weight=0.0,
            disk_weight=20.0,
            churn_weight=0.0,
        )
        state = make_state(disk=(50_000_000.0, 0.0), latency_p99=0.0)
        same = {"server-1": 500, "server-2": 500}
        onto_busy = {"server-1": 800, "server-2": 200}
        onto_idle = {"server-1": 200, "server-2": 800}

        self.assertAlmostEqual(balancer._compute_reward(state, same, same), 0.0)
        self.assertAlmostEqual(balancer._compute_reward(state, same, onto_busy), -6.0)
        self.assertAlmostEqual(balancer._compute_reward(state, same, onto_idle), 6.0)
        self.assertEqual(state.to_am_ppo_feature_vector()[1], 0.0)

    def test_idle_traffic_does_not_enter_the_rollout(self) -> None:
        idle = make_state(request_rates=(0.0, 0.0))
        loaded = make_state(request_rates=(10.0, 10.0))
        model = make_model(rollout_size=8)
        balancer = AMPPOBalancer(
            BACKENDS,
            metrics_source=ScriptedMetricsSource([loaded, idle, idle, loaded]),
            model=model,
            min_training_rps=1.0,
            action_hold_seconds=0.0,
        )

        for _ in range(4):
            balancer.select()

        self.assertEqual(model._rollout, [])

    def test_weight_step_cannot_jump_onto_a_cooler_server(self) -> None:
        # 40% CPU with weight 70 must not become 350 in one decision.
        stepped = step_toward_even_cpu(
            BACKENDS,
            {"server-1": 70, "server-2": 930},
            (0.40, 0.90),
            (True, True),
            (0.0, 0.0),
            weight_total=1000,
            max_step=20,
        )

        # Zero logits leave the CPU gap with 30% of the ±20 cap, so 6 points.
        self.assertEqual(stepped["server-1"], 76)
        self.assertEqual(stepped["server-2"], 924)
        self.assertEqual(sum(stepped.values()), 1000)

    def test_network_supplies_seventy_percent_of_the_step(self) -> None:
        current = {"server-1": 500, "server-2": 500}
        saturated = step_toward_even_cpu(
            BACKENDS,
            current,
            (0.50, 0.50),
            (True, True),
            (20.0, -20.0),
            weight_total=1000,
            max_step=20,
        )
        self.assertEqual(saturated["server-1"], 514)
        self.assertEqual(saturated["server-2"], 486)

        agreed = step_toward_even_cpu(
            BACKENDS,
            current,
            (0.20, 0.90),
            (True, True),
            (20.0, -20.0),
            weight_total=1000,
            max_step=20,
        )
        self.assertEqual(agreed["server-1"], 520)
        self.assertEqual(agreed["server-2"], 480)

        shared = step_toward_even_cpu(
            BACKENDS,
            current,
            (0.50, 0.50),
            (True, True),
            (5.0, 5.0),
            weight_total=1000,
            max_step=20,
        )
        self.assertEqual(shared, current)

    def test_actor_drops_a_logit_shared_by_every_server(self) -> None:
        model = make_model()
        model._actor_score[-1].weight.data.zero_()
        model._actor_score[-1].bias.data.fill_(3.0)
        states = torch.zeros(1, 4, 7)
        states[..., 4] = 1.0

        with torch.no_grad():
            logits = model._actor_forward(states)

        self.assertTrue(torch.allclose(logits, torch.zeros_like(logits), atol=1e-5))

    def test_shared_latency_does_not_enter_the_trained_reward(self) -> None:
        clock = {"now": 0.0}
        source = ScriptedMetricsSource([
            make_state(latency_p99=0.0),
            make_state(latency_p99=2.0),
        ])
        model = make_model(rollout_size=8)
        balancer = AMPPOBalancer(
            BACKENDS,
            metrics_source=source,
            model=model,
            action_hold_seconds=0.0,
            time_fn=lambda: clock["now"],
            latency_weight=1.0,
            latency_sla_seconds=0.2,
        )

        balancer.select()
        clock["now"] = 2.0
        balancer.select()

        self.assertEqual(len(model._rollout), 1)
        self.assertGreater(model._rollout[0].reward, -1.0)

    def test_network_nudge_stays_inside_the_weight_step(self) -> None:
        stepped = step_toward_even_cpu(
            BACKENDS,
            {"server-1": 70, "server-2": 930},
            (0.40, 0.40),
            (True, True),
            (20.0, -20.0),
            weight_total=1000,
            max_step=20,
        )

        self.assertLessEqual(stepped["server-1"] - 70, 20)
        self.assertGreaterEqual(stepped["server-2"], 910)
        self.assertEqual(sum(stepped.values()), 1000)

    def test_observation_includes_limit_shares(self) -> None:
        small = make_state(cpu_limits=(0.5, 0.5))
        large = make_state(cpu_limits=(0.5, 2.0))

        small_features = small.to_am_ppo_feature_vector()
        large_features = large.to_am_ppo_feature_vector()

        self.assertEqual(len(small_features), 14)
        self.assertEqual(small_features[:5], large_features[:5])
        self.assertEqual(small_features[5:7], [0.5, 0.5])
        self.assertEqual(small_features[12:14], [0.5, 0.5])
        self.assertAlmostEqual(large_features[5], 0.2)
        self.assertAlmostEqual(large_features[12], 0.8)
        self.assertEqual(large_features[6], small_features[6])
        self.assertEqual(large_features[13], small_features[13])

    def test_server_count_change_resets_the_open_rollout(self) -> None:
        three_backends = BACKENDS + (Backend(name="server-3", host="server-3", port=50051),)
        three_servers = make_state().servers + (
            ServerState(
                backend_name="server-3",
                host="server-3",
                cpu_utilization=0.4,
                cpu_throttling_rate=0.0,
                memory_utilization=0.3,
                active_requests=2.0,
                request_rate_rps=10.0,
                latency_p99_seconds=0.1,
                error_rate=0.0,
                cpu_limit_cores=1.0,
                memory_limit_bytes=1_073_741_824.0,
                is_healthy=True,
                current_weight_share=0.3,
                disk_io_bytes_per_second=1_000_000.0,
            ),
        )
        pair = make_state()
        triple = ClusterState(
            servers=three_servers,
            cluster_request_rate_rps=30.0,
            step_index=2,
            timestamp_unix=1.0,
            cluster_latency_p99_seconds=0.1,
        )
        model = make_model(rollout_size=8)

        pair_action = model.act(pair, BACKENDS, weight_total=1000)
        model.observe_transition(pair, pair_action, -1.0, pair)
        triple_action = model.act(triple, three_backends, weight_total=1000)
        model.observe_transition(triple, triple_action, -1.0, triple)

        self.assertEqual(len(triple_action.weights), 3)
        self.assertEqual(sum(triple_action.weights.values()), 1000)
        self.assertEqual(len(model._rollout), 1)
        self.assertEqual(len(model._rollout[0].action), 3)

    def test_capacity_weights_score_better_than_equal_weights(self) -> None:
        balancer = AMPPOBalancer(
            BACKENDS,
            metrics_source=StubMetricsSource(
                BACKENDS,
                cpu_limits=(0.5, 2.0),
                memory_limits_bytes=(1_073_741_824.0, 1_073_741_824.0),
            ),
            model=make_model(),
            weight_total=1000,
            latency_weight=0.0,
            error_weight=0.0,
            cpu_weight=0.0,
            balance_weight=0.0,
            capacity_weight=8.0,
            churn_weight=0.0,
            action_hold_seconds=0.0,
        )
        state = make_state(cpu=(0.4, 0.4), cpu_limits=(0.5, 2.0), latency_p99=0.0)
        equal = {"server-1": 500, "server-2": 500}
        proportional = {"server-1": 200, "server-2": 800}

        equal_reward = balancer._compute_reward(state, equal, equal)
        proportional_reward = balancer._compute_reward(state, proportional, proportional)
        # |0.5-0.2| + |0.5-0.8| = 0.6, divided by 2 is 0.3, times weight 8.
        self.assertAlmostEqual(equal_reward, -2.4)
        self.assertAlmostEqual(proportional_reward, 0.0)
        self.assertGreater(proportional_reward, equal_reward)

        dead = make_state(
            healthy=(True, False),
            cpu=(0.4, 0.0),
            cpu_limits=(0.5, 2.0),
            latency_p99=0.0,
        )
        parked = {"server-1": 1000, "server-2": 0}
        self.assertAlmostEqual(balancer._compute_reward(dead, parked, parked), 0.0)

    def test_action_hold_keeps_weights_until_the_window_elapses(self) -> None:
        clock = {"now": 0.0}
        first = make_state()
        second = make_state(cpu=(0.2, 0.8))
        source = ScriptedMetricsSource([first, second])
        model = make_model(rollout_size=8)
        balancer = AMPPOBalancer(
            BACKENDS,
            metrics_source=source,
            model=model,
            action_hold_seconds=20.0,
            time_fn=lambda: clock["now"],
        )

        first_decision = balancer.select()
        held = balancer.select()

        self.assertEqual(held.weights, first_decision.weights)
        self.assertEqual(len(source._states), 1)
        self.assertEqual(model._rollout, [])

        clock["now"] = 20.0
        balancer.select()

        self.assertEqual(len(source._states), 0)
        self.assertEqual(len(model._rollout), 1)

    def test_missing_cpu_sample_is_not_trained_and_weights_stay(self) -> None:
        clock = {"now": 0.0}
        good = make_state(cpu=(0.67, 1.0))
        missing = make_state(cpu=(0.67, float("nan")))
        later = make_state(cpu=(0.4, 0.9))
        source = ScriptedMetricsSource([good, missing, later])
        model = make_model(rollout_size=8)
        balancer = AMPPOBalancer(
            BACKENDS,
            metrics_source=source,
            model=model,
            action_hold_seconds=0.0,
            time_fn=lambda: clock["now"],
        )

        first = balancer.select()
        clock["now"] = 2.0
        skipped = balancer.select()
        clock["now"] = 4.0
        balancer.select()

        self.assertEqual(skipped.weights, first.weights)
        self.assertEqual(model._rollout, [])
        self.assertEqual(len(source._states), 0)

    def test_prometheus_rate_window_is_configurable(self) -> None:
        source = PrometheusMetricsSource(
            BACKENDS,
            "http://prometheus",
            cpu_limits=(1.0, 1.0),
            memory_limits_bytes=(1_073_741_824.0, 1_073_741_824.0),
            rate_window="20s",
        )
        client = RecordingPrometheusClient()
        source._client = client

        source.fetch(BACKENDS, {"server-1": 500, "server-2": 500})

        windowed = [query for query in client.queries if "[20s]" in query]
        self.assertTrue(windowed)
        self.assertTrue(all("irate(" in query for query in windowed))
        self.assertFalse(any("[1m]" in query for query in client.queries))

    def test_critic_scores_spread_and_ignores_the_shared_level(self) -> None:
        path = "/tmp/am_ppo_critic_spread.pt"
        if os.path.exists(path):
            os.remove(path)
        model = AMPPORLModel(
            learning_rate=3e-4,
            gamma=0.99,
            gae_lambda=0.95,
            clip_epsilon=0.2,
            update_epochs=1,
            rollout_size=2,
            value_coefficient=0.5,
            entropy_coefficient=0.01,
            model_path=path,
        )
        even = torch.full((4, 7), 0.55)
        hot = torch.full((4, 7), 1.0)
        split = even.clone()
        split[:, 0] = torch.tensor([0.2, 0.4, 0.7, 0.95])

        def value(rows: torch.Tensor) -> float:
            with torch.no_grad():
                return float(model._critic_forward(rows.view(1, 4, 7)))

        self.assertAlmostEqual(value(even), value(hot), places=5)
        # Spread weight 20 times CPU deviation 0.2625, before reward scaling.
        self.assertLess(value(split), value(even) - 1.0)

    def test_stuck_critic_resets_and_rewards_stay_near_unit_scale(self) -> None:
        path = "/tmp/am_ppo_stuck_critic.pt"
        if os.path.exists(path):
            os.remove(path)
        trained = make_model()
        trained._critic_score[-1].weight.data.fill_(3.0)
        trained._critic_score[-1].bias.data.fill_(-6.0)
        trained._save_weights = lambda: None
        torch.save(trained.state_dict(), path)

        loaded = AMPPORLModel(
            learning_rate=3e-4,
            gamma=0.99,
            gae_lambda=0.95,
            clip_epsilon=0.2,
            update_epochs=1,
            rollout_size=2,
            value_coefficient=0.5,
            entropy_coefficient=0.01,
            model_path=path,
        )

        self.assertLess(float(loaded._critic_score[-1].weight.detach().norm()), 5.0)
        self.assertLess(abs(float(loaded._critic_score[-1].bias.detach())), 2.0)
        scaled = loaded._normalize_rewards(torch.tensor([-10.0, -12.0]))
        self.assertLess(float(scaled.abs().max()), 3.0)
        self.assertGreater(float(scaled[0]), float(scaled[1]))

    def test_exploration_std_receives_gradient(self) -> None:
        model = make_model()
        states = torch.rand(8, 4, 7)
        states[..., 4] = 1.0
        distribution = model._distribution(states)
        actions = distribution.sample()
        (-distribution.log_prob(actions).sum()).backward()

        # clamp() has zero gradient outside its bounds, which froze the std.
        self.assertIsNotNone(model._log_std.grad)
        self.assertGreater(float(model._log_std.grad.abs().sum()), 0.0)

    def test_old_log_std_outside_the_range_is_pulled_inside(self) -> None:
        path = "/tmp/am_ppo_log_std_range.pt"
        trained = make_model()
        trained._log_std.data.fill_(-9.0)
        torch.save(trained.state_dict(), path)

        loaded = AMPPORLModel(
            learning_rate=3e-4,
            gamma=0.99,
            gae_lambda=0.95,
            clip_epsilon=0.2,
            update_epochs=1,
            rollout_size=2,
            value_coefficient=0.5,
            entropy_coefficient=0.01,
            model_path=path,
        )
        self.assertGreaterEqual(float(loaded._log_std.detach()), -3.0)

    def test_balance_reward_scores_the_shift_not_the_absolute_share(self) -> None:
        balancer = AMPPOBalancer(
            BACKENDS,
            metrics_source=StubMetricsSource(
                BACKENDS,
                cpu_limits=(1.0, 1.0),
                memory_limits_bytes=(1_073_741_824.0, 1_073_741_824.0),
            ),
            model=make_model(),
            weight_total=1000,
            latency_weight=0.0,
            error_weight=0.0,
            cpu_weight=0.0,
            balance_weight=10.0,
            spread_weight=0.0,
            disk_weight=0.0,
            churn_weight=0.0,
        )
        state = make_state(cpu=(0.9, 0.3), latency_p99=0.0)
        skewed = {"server-1": 700, "server-2": 300}

        # The hot server already holds 70%. An action that keeps it is neutral.
        self.assertAlmostEqual(balancer._compute_reward(state, skewed, skewed), 0.0)
        # Shedding 20 points from the hot server is rewarded, adding 20 is punished.
        shed = balancer._compute_reward(state, skewed, {"server-1": 680, "server-2": 320})
        added = balancer._compute_reward(state, skewed, {"server-1": 720, "server-2": 280})
        self.assertGreater(shed, 0.0)
        self.assertAlmostEqual(shed, -added)

    def test_update_runs_several_epochs_and_reports_policy_movement(self) -> None:
        model = AMPPORLModel(
            learning_rate=1e-3,
            gamma=0.9,
            gae_lambda=0.95,
            clip_epsilon=0.2,
            update_epochs=4,
            rollout_size=8,
            value_coefficient=0.5,
            entropy_coefficient=0.001,
            model_path="/tmp/am_ppo_epochs.pt",
        )
        state = make_state(cpu=(0.9, 0.3))
        with self.assertLogs("lb-controller.am_ppo", level="INFO") as captured:
            for index in range(8):
                action = model.act(state, BACKENDS, weight_total=1000)
                model.observe_transition(state, action, -1.0 if index % 2 else 1.0, state)

        line = next(message for message in captured.output if "AM-PPO update" in message)
        epochs = int(re.search(r"epochs=(\d+)", line).group(1))
        kl = float(re.search(r"kl=([-\d.e]+)", line).group(1))
        self.assertGreater(epochs, 1)
        self.assertIn("clip=", line)
        # Epochs after the first start from a moved policy, so the ratio leaves 1.
        self.assertGreater(kl, 0.0)

    def test_policy_learns_to_shift_weight_off_the_hot_server(self) -> None:
        # Contextual bandit: reward is the logit gap between the cold and the hot server.
        path = "/tmp/am_ppo_learning.pt"
        if os.path.exists(path):
            os.remove(path)
        torch.manual_seed(0)
        model = AMPPORLModel(
            learning_rate=1e-3,
            gamma=0.5,
            gae_lambda=0.95,
            clip_epsilon=0.2,
            update_epochs=4,
            rollout_size=16,
            value_coefficient=0.5,
            entropy_coefficient=0.001,
            model_path=path,
        )
        model._save_weights = lambda: None
        generator = torch.Generator().manual_seed(1)

        def sample_state() -> tuple[ClusterState, int]:
            hot = int(torch.randint(0, 2, (1,), generator=generator))
            cpu = (0.9, 0.3) if hot == 0 else (0.3, 0.9)
            return make_state(cpu=cpu), hot

        def logit_gap() -> float:
            gaps = []
            for hot in (0, 1):
                state = make_state(cpu=(0.9, 0.3) if hot == 0 else (0.3, 0.9))
                features = torch.tensor([state.to_am_ppo_feature_vector()]).view(1, 2, 7)
                with torch.no_grad():
                    logits = model._actor_forward(features)[0]
                gaps.append(float(logits[1 - hot] - logits[hot]))
            return sum(gaps) / len(gaps)

        before = logit_gap()
        for _ in range(1600):
            state, hot = sample_state()
            action = model.act(state, BACKENDS, weight_total=1000)
            reward = action.raw_logits[1 - hot] - action.raw_logits[hot]
            model.observe_transition(state, action, reward, state)

        self.assertGreater(logit_gap(), before + 0.1)

    def test_missing_cpu_sample_discards_the_open_rollout(self) -> None:
        clock = {"now": 0.0}
        source = ScriptedMetricsSource([
            make_state(cpu=(0.5, 0.6)),
            make_state(cpu=(0.5, 0.6)),
            make_state(cpu=(0.5, float("nan"))),
        ])
        model = make_model(rollout_size=8)
        balancer = AMPPOBalancer(
            BACKENDS,
            metrics_source=source,
            model=model,
            action_hold_seconds=0.0,
            time_fn=lambda: clock["now"],
        )

        balancer.select()
        clock["now"] = 2.0
        balancer.select()
        self.assertEqual(len(model._rollout), 1)
        clock["now"] = 4.0
        balancer.select()

        self.assertEqual(model._rollout, [])

    def test_frozen_model_does_not_learn_and_acts_on_the_mean(self) -> None:
        path = "/tmp/am_ppo_frozen.pt"
        if os.path.exists(path):
            os.remove(path)
        model = AMPPORLModel(
            learning_rate=1e-3,
            gamma=0.9,
            gae_lambda=0.95,
            clip_epsilon=0.2,
            update_epochs=4,
            rollout_size=4,
            value_coefficient=0.5,
            entropy_coefficient=0.001,
            model_path=path,
        )
        state = make_state(cpu=(0.9, 0.3))
        model.observe_transition(state, model.act(state, BACKENDS, weight_total=1000), -1.0, state)
        self.assertEqual(len(model._rollout), 1)

        model.set_learning_enabled(False)
        # The half-collected rollout belongs to the learning phase.
        self.assertEqual(model._rollout, [])
        before = [parameter.detach().clone() for parameter in model.parameters()]

        actions = [model.act(state, BACKENDS, weight_total=1000) for _ in range(5)]
        for action in actions:
            model.observe_transition(state, action, -1.0, state)

        # No exploration noise: every decision is the same.
        self.assertEqual(len({action.raw_logits for action in actions}), 1)
        self.assertEqual(len({tuple(action.weights.items()) for action in actions}), 1)
        self.assertEqual(model._rollout, [])
        self.assertEqual(model._update_count, 0)
        self.assertFalse(os.path.exists(path))
        for old, new in zip(before, model.parameters()):
            self.assertTrue(torch.equal(old, new.detach()))

        model.set_learning_enabled(True)
        sampled = {model.act(state, BACKENDS, weight_total=1000).raw_logits for _ in range(5)}
        self.assertGreater(len(sampled), 1)

    def test_frozen_balancer_still_decides_but_collects_nothing(self) -> None:
        clock = {"now": 0.0}
        source = ScriptedMetricsSource([make_state(cpu=(0.5, 0.6)) for _ in range(4)])
        model = make_model(rollout_size=2)
        balancer = AMPPOBalancer(
            BACKENDS,
            metrics_source=source,
            model=model,
            action_hold_seconds=0.0,
            time_fn=lambda: clock["now"],
        )
        balancer.set_learning_enabled(False)
        self.assertFalse(balancer.learning_enabled)

        for step in range(4):
            clock["now"] = 2.0 * step
            decision = balancer.select()
            self.assertEqual(sum(decision.weights.values()), 1000)

        self.assertEqual(model._rollout, [])
        self.assertEqual(model._update_count, 0)

    def test_missing_cpu_irate_is_not_zero_utilization(self) -> None:
        source = PrometheusMetricsSource(
            BACKENDS,
            "http://prometheus",
            cpu_limits=(2.0, 2.0),
            memory_limits_bytes=(1_073_741_824.0, 1_073_741_824.0),
        )

        class CpuClient:
            def __init__(self, total: float | None, fallback: float | None = None) -> None:
                self._total = total
                self._fallback = fallback

            def query_optional(self, query: str) -> float | None:
                if 'cpu="total"' in query:
                    return self._total
                return self._fallback

            def query_scalar(self, query: str, *, default: float = 0.0) -> float:
                del query
                return default

        source._client = CpuClient(None, None)
        self.assertTrue(math.isnan(source._query_cpu_utilization("server-4", 2.0)))

        source._client = CpuClient(0.0)
        self.assertEqual(source._query_cpu_utilization("server-4", 2.0), 0.0)

        source._client = CpuClient(None, 1.0)
        self.assertAlmostEqual(source._query_cpu_utilization("server-4", 2.0), 0.5)

    def test_two_core_server_at_two_cores_is_fully_busy_not_over_capacity(self) -> None:
        self.assertAlmostEqual(cpu_utilization_ratio(2.0, 2.0), 1.0)
        self.assertAlmostEqual(cpu_utilization_ratio(1.0, 2.0), 0.5)
        self.assertAlmostEqual(cpu_utilization_ratio(2.4, 2.0), 1.0)


if __name__ == "__main__":
    unittest.main()