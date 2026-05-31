from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class LoadDecision:
    weights: dict[str, int]


class Balancer(ABC):
    @abstractmethod
    def select(self) -> LoadDecision:
        pass
