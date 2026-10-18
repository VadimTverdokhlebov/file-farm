import unittest

from balancers.even_load_balancer import EvenLoadBalancer
from config import Backend
from rl.types import ClusterState, ServerState, observed_server_signals
from rl.weights import step_toward_even_load


BACKENDS = (
    Backend(name="server-1", host="server-1", port=50051),
    Backend(name="server-2", host="server-2", port=50051),
)


def _step(
    *,
    current: dict[str, int],
    cpu: tuple[float, ...],
    alive: tuple[bool, ...] = (True, True),
) -> dict[str, int]:
    return step_toward_even_load(
        BACKENDS,
        current,
        cpu,
        alive,
        weight_total=1000,
    )


class EvenLoadTests(unittest.TestCase):
    def test_cpu_gap_moves_at_most_five_points(self) -> None:
        stepped = _step(current={"server-1": 70, "server-2": 930}, cpu=(0.40, 0.90))

        self.assertEqual(stepped["server-1"], 75)
        self.assertEqual(stepped["server-2"], 925)
        self.assertEqual(sum(stepped.values()), 1000)

    def test_even_cpu_does_not_move_weight(self) -> None:
        current = {"server-1": 200, "server-2": 800}
        stepped = _step(current=current, cpu=(0.60, 0.60))

        self.assertEqual(stepped, current)

    def test_gap_inside_the_deadband_stays_put(self) -> None:
        current = {"server-1": 500, "server-2": 500}
        stepped = _step(current=current, cpu=(0.50, 0.51))

        self.assertEqual(stepped, current)

    def test_stopped_server_drops_to_zero_without_a_jump_on_the_other(self) -> None:
        stepped = _step(
            current={"server-1": 400, "server-2": 600},
            cpu=(0.4, 0.9),
            alive=(True, False),
        )

        self.assertEqual(stepped["server-2"], 0)
        self.assertEqual(stepped["server-1"], 405)

    def test_no_healthy_server_publishes_zeros(self) -> None:
        stepped = _step(
            current={"server-1": 500, "server-2": 500},
            cpu=(0.2, 0.8),
            alive=(False, False),
        )

        self.assertEqual(stepped, {"server-1": 0, "server-2": 0})

    def test_server_count_is_not_fixed(self) -> None:
        backends = BACKENDS + (Backend(name="server-3", host="server-3", port=50051),)
        stepped = step_toward_even_load(
            backends,
            {"server-1": 300, "server-2": 300, "server-3": 400},
            (0.2, 0.2, 0.9),
            (True, True, True),
            weight_total=1000,
        )

        self.assertEqual(stepped["server-3"], 395)
        self.assertEqual(sum(stepped.values()), 1000)
        self.assertTrue(all(abs(stepped[host] - current) <= 5 for host, current in (
            ("server-1", 300),
            ("server-2", 300),
            ("server-3", 400),
        )))

    def test_signals_match_the_model_observation(self) -> None:
        server = ServerState(
            backend_name="server-1",
            host="server-1",
            cpu_utilization=0.4,
            cpu_throttling_rate=0.0,
            memory_utilization=0.2,
            active_requests=100.0,
            request_rate_rps=100.0,
            latency_p99_seconds=0.2,
            error_rate=0.1,
            cpu_limit_cores=0.5,
            memory_limit_bytes=512.0,
            is_healthy=True,
            current_weight_share=0.25,
            disk_io_bytes_per_second=50_000_000.0,
        )
        state = ClusterState(
            servers=(server,),
            cluster_request_rate_rps=100.0,
            step_index=1,
            timestamp_unix=0.0,
        )

        features = state.to_am_ppo_feature_vector()
        self.assertEqual(tuple(features[:5]), observed_server_signals(server))
        self.assertEqual(features[0], 0.4)
        self.assertEqual(features[4], 1.0)
        self.assertEqual(features[5], 1.0)
        self.assertEqual(features[6], 1.0)

    def test_hold_keeps_the_previous_weights(self) -> None:
        clock = {"now": 0.0}
        source = _ScriptedSource([_state(0.2, 0.9), _state(0.9, 0.2)])
        balancer = EvenLoadBalancer(
            BACKENDS,
            source,
            weight_total=1000,
            action_hold_seconds=2.0,
            time_fn=lambda: clock["now"],
        )

        first = balancer.select().weights
        clock["now"] = 1.0
        second = balancer.select().weights

        self.assertEqual(second, first)
        self.assertEqual(len(source.states), 1)

    def test_disk_and_rps_do_not_move_weight_when_cpu_matches(self) -> None:
        source = _ScriptedSource([_state(0.5, 0.5, disk=(50_000_000.0, 0.0), rps=(80.0, 1.0))])
        balancer = EvenLoadBalancer(
            BACKENDS,
            source,
            weight_total=1000,
            action_hold_seconds=0.0,
            time_fn=lambda: 0.0,
        )

        self.assertEqual(balancer.select().weights, {"server-1": 500, "server-2": 500})


class _ScriptedSource:
    def __init__(self, states: list[ClusterState]) -> None:
        self.states = states

    def fetch(self, backends: tuple[Backend, ...], current_weights: dict[str, int]) -> ClusterState:
        del backends, current_weights
        return self.states.pop(0)


def _state(
    first_cpu: float,
    second_cpu: float,
    *,
    disk: tuple[float, float] = (0.0, 0.0),
    rps: tuple[float, float] = (10.0, 10.0),
) -> ClusterState:
    servers = tuple(
        ServerState(
            backend_name=backend.name,
            host=backend.host,
            cpu_utilization=cpu,
            cpu_throttling_rate=0.0,
            memory_utilization=0.0,
            active_requests=0.0,
            request_rate_rps=rps[index],
            disk_io_bytes_per_second=disk[index],
            latency_p99_seconds=0.0,
            error_rate=0.0,
            cpu_limit_cores=1.0,
            memory_limit_bytes=1.0,
            is_healthy=True,
            current_weight_share=0.5,
        )
        for index, (backend, cpu) in enumerate(zip(BACKENDS, (first_cpu, second_cpu)))
    )
    return ClusterState(
        servers=servers,
        cluster_request_rate_rps=10.0,
        step_index=1,
        timestamp_unix=0.0,
    )


if __name__ == "__main__":
    unittest.main()
