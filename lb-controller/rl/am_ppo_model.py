import logging
import math
from dataclasses import dataclass

import torch
from torch import nn
from torch.distributions import Normal

from config import Backend
from rl.types import ClusterState
from rl.weights import masked_logits_to_eds_weights

logger = logging.getLogger("lb-controller.am_ppo")


@dataclass(frozen=True)
class PpoAction:
    raw_logits: tuple[float, ...]
    alive_mask: tuple[bool, ...]
    log_probability: float
    weights: dict[str, int]


@dataclass(frozen=True)
class _Transition:
    state: tuple[float, ...]
    action: tuple[float, ...]
    alive_mask: tuple[bool, ...]
    log_probability: float
    reward: float
    next_state: tuple[float, ...]


class AMPPORLModel(nn.Module):
    def __init__(
        self,
        feature_size: int,
        action_size: int,
        *,
        learning_rate: float,
        gamma: float,
        gae_lambda: float,
        clip_epsilon: float,
        update_epochs: int,
        rollout_size: int,
        value_coefficient: float,
        entropy_coefficient: float,
    ) -> None:
        super().__init__()
        if feature_size <= 0 or action_size <= 0:
            raise ValueError("Feature and action sizes must be positive")
        if rollout_size <= 0 or update_epochs <= 0:
            raise ValueError("Rollout size and update epochs must be positive")

        self._action_size = action_size
        self._gamma = gamma
        self._gae_lambda = gae_lambda
        self._clip_epsilon = clip_epsilon
        self._update_epochs = update_epochs
        self._rollout_size = rollout_size
        self._value_coefficient = value_coefficient
        self._entropy_coefficient = entropy_coefficient
        self._actor = self._network(feature_size, action_size)
        self._critic = self._network(feature_size, 1)
        self._log_std = nn.Parameter(torch.full((action_size,), -0.5))
        self._optimizer = torch.optim.Adam(self.parameters(), lr=learning_rate)
        self._rollout: list[_Transition] = []

    @staticmethod
    def _network(input_size: int, output_size: int) -> nn.Sequential:
        network = nn.Sequential(
            nn.Linear(input_size, 64),
            nn.Tanh(),
            nn.Linear(64, 64),
            nn.Tanh(),
            nn.Linear(64, output_size),
        )
        for layer in network:
            if isinstance(layer, nn.Linear):
                nn.init.orthogonal_(layer.weight, gain=math.sqrt(2.0))
                nn.init.zeros_(layer.bias)
        nn.init.orthogonal_(network[-1].weight, gain=0.01)
        return network

    def act(
        self,
        state: ClusterState,
        backends: tuple[Backend, ...],
        *,
        weight_total: int,
    ) -> PpoAction:
        if len(state.servers) != len(backends) or len(backends) != self._action_size:
            raise ValueError("State, backend and policy sizes must match")

        features = tuple(state.to_am_ppo_feature_vector())
        alive_mask = tuple(server.is_healthy for server in state.servers)
        state_tensor = torch.tensor([features], dtype=torch.float32)
        distribution = self._distribution(state_tensor)

        with torch.no_grad():
            sampled_action = distribution.sample()[0]
            mask_tensor = torch.tensor(alive_mask, dtype=torch.float32)
            log_probability = (distribution.log_prob(sampled_action) * mask_tensor).sum()

        raw_logits = tuple(float(value) for value in sampled_action.tolist())
        weights = masked_logits_to_eds_weights(
            backends,
            raw_logits,
            alive_mask,
            weight_total=weight_total,
        )
        return PpoAction(
            raw_logits=raw_logits,
            alive_mask=alive_mask,
            log_probability=float(log_probability.item()),
            weights=weights,
        )

    def observe_transition(
        self,
        state: ClusterState,
        action: PpoAction,
        reward: float,
        next_state: ClusterState,
    ) -> None:
        self._rollout.append(
            _Transition(
                state=tuple(state.to_am_ppo_feature_vector()),
                action=action.raw_logits,
                alive_mask=action.alive_mask,
                log_probability=action.log_probability,
                reward=float(reward),
                next_state=tuple(next_state.to_am_ppo_feature_vector()),
            )
        )
        if len(self._rollout) >= self._rollout_size:
            self._update_policy()

    def _distribution(self, states: torch.Tensor) -> Normal:
        means = self._actor(states)
        standard_deviations = self._log_std.clamp(-5.0, 1.0).exp().expand_as(means)
        return Normal(means, standard_deviations)

    def _update_policy(self) -> None:
        rollout = self._rollout
        self._rollout = []
        states = torch.tensor([step.state for step in rollout], dtype=torch.float32)
        actions = torch.tensor([step.action for step in rollout], dtype=torch.float32)
        alive_masks = torch.tensor([step.alive_mask for step in rollout], dtype=torch.float32)
        next_states = torch.tensor([step.next_state for step in rollout], dtype=torch.float32)

        with torch.no_grad():
            values = self._critic(states).squeeze(-1).tolist()
            next_values = self._critic(next_states).squeeze(-1).tolist()

        advantages = [0.0] * len(rollout)
        returns = [0.0] * len(rollout)
        generalized_advantage = 0.0
        for index in reversed(range(len(rollout))):
            temporal_difference = (
                rollout[index].reward + self._gamma * next_values[index] - values[index]
            )
            generalized_advantage = (
                temporal_difference + self._gamma * self._gae_lambda * generalized_advantage
            )
            advantages[index] = generalized_advantage
            returns[index] = generalized_advantage + values[index]

        advantage_tensor = torch.tensor(advantages, dtype=torch.float32)
        if len(advantages) > 1:
            advantage_tensor = (advantage_tensor - advantage_tensor.mean()) / (
                advantage_tensor.std(unbiased=False) + 1e-8
            )
        return_tensor = torch.tensor(returns, dtype=torch.float32)
        old_log_probabilities = torch.tensor(
            [step.log_probability for step in rollout],
            dtype=torch.float32,
        )

        for _ in range(self._update_epochs):
            distribution = self._distribution(states)
            new_log_probabilities = (
                distribution.log_prob(actions) * alive_masks
            ).sum(dim=1)
            entropy = (distribution.entropy() * alive_masks).sum(dim=1).mean()
            ratios = (new_log_probabilities - old_log_probabilities).exp()
            unclipped = ratios * advantage_tensor
            clipped = ratios.clamp(
                1.0 - self._clip_epsilon,
                1.0 + self._clip_epsilon,
            ) * advantage_tensor
            policy_loss = -torch.minimum(unclipped, clipped).mean()
            value_loss = (self._critic(states).squeeze(-1) - return_tensor).square().mean()
            loss = (
                policy_loss
                + self._value_coefficient * value_loss
                - self._entropy_coefficient * entropy
            )

            self._optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(self.parameters(), max_norm=0.5)
            self._optimizer.step()

        logger.info(
            "AM-PPO update transitions=%d reward_mean=%.4f policy_loss=%.4f value_loss=%.4f",
            len(rollout),
            sum(step.reward for step in rollout) / len(rollout),
            float(policy_loss.detach().item()),
            float(value_loss.detach().item()),
        )