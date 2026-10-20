from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class LoadDecision:
    weights: dict[str, int]


class Balancer(ABC):
    # Envoy cluster policy this balancer needs. The controllers that move EDS
    # weights run on ROUND_ROBIN, where the weights decide the split.
    lb_policy: str = "ROUND_ROBIN"

    @abstractmethod
    def select(self) -> LoadDecision:
        pass
