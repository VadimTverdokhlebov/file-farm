import logging
import math
import os
from dataclasses import dataclass

import torch
from torch import nn
from torch.distributions import Normal

from config import AM_PPO_REWARD_SPREAD_WEIGHT
from rl.types import ClusterState

logger = logging.getLogger("lb-controller.am_ppo")

# cpu, disk, rps, active requests, health, cpu-limit share, memory-limit share.
_FEATURES_PER_SERVER = 7

# Exploration std range is exp(-3)..exp(-0.5) = 0.05..0.61. The start sits
# strictly inside so the std receives gradient and can shrink as the policy learns.
_LOG_STD_MIN = -3.0
_LOG_STD_MAX = -0.5
_LOG_STD_INIT = -1.0

# Reward statistics behave like an average over about this many samples. A
# larger window adapts too slowly when the reward scale changes between builds.
_REWARD_STATS_WINDOW = 1_000.0

# Stop the update epochs early once the policy has moved this far in KL terms.
_TARGET_KL = 0.03


@dataclass(frozen=True)
class PpoAction:
    """One sampled decision. Turning logits into weights is the balancer's job."""

    raw_logits: tuple[float, ...]
    alive_mask: tuple[bool, ...]
    log_probability: float


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
        *,
        learning_rate: float,
        gamma: float,
        gae_lambda: float,
        clip_epsilon: float,
        update_epochs: int,
        rollout_size: int,
        value_coefficient: float,
        entropy_coefficient: float,
        model_path: str = "am_ppo_model.pt",
        feature_per_server: int = _FEATURES_PER_SERVER,
    ) -> None:
        super().__init__()
        if rollout_size <= 0 or update_epochs <= 0:
            raise ValueError("Rollout size and update epochs must be positive")

        self._gamma = gamma
        self._gae_lambda = gae_lambda
        self._clip_epsilon = clip_epsilon
        self._update_epochs = update_epochs
        self._rollout_size = rollout_size
        self._value_coefficient = value_coefficient
        self._entropy_coefficient = entropy_coefficient
        self._model_path = model_path
        self._feature_per_server = feature_per_server

        self._actor_fe = nn.Sequential(nn.Linear(feature_per_server, 32), nn.Tanh())
        self._actor_score = nn.Sequential(nn.Linear(64, 32), nn.Tanh(), nn.Linear(32, 1))

        self._critic_fe = nn.Sequential(nn.Linear(feature_per_server, 32), nn.Tanh())
        self._critic_score = nn.Sequential(nn.Linear(32, 32), nn.Tanh(), nn.Linear(32, 1))

        for module in self.modules():
            if isinstance(module, nn.Linear):
                nn.init.orthogonal_(module.weight, gain=math.sqrt(2.0))
                nn.init.zeros_(module.bias)
        nn.init.orthogonal_(self._actor_score[-1].weight, gain=0.01)
        self._init_critic()

        # The bounds must contain the initial value. clamp() has zero gradient
        # outside its range, so a start beyond a bound freezes the std for good.
        self._log_std = nn.Parameter(torch.tensor([_LOG_STD_INIT]))
        # Running reward scale. A constant critic of reward/(1-gamma) is about
        # -200 when rewards sit near -2; dividing by this scale keeps values near 1.
        self.register_buffer("_reward_mean", torch.zeros(()))
        self.register_buffer("_reward_var", torch.ones(()))
        self.register_buffer("_reward_count", torch.zeros(()))
        self._optimizer = torch.optim.Adam(self.parameters(), lr=learning_rate)
        self._rollout: list[_Transition] = []
        # False freezes the policy: no rollout, no updates, no saves, and the
        # action is the distribution mean instead of a noisy sample.
        self._learning_enabled = True
        self._update_count = 0

        self._load_weights()

    def _init_critic(self) -> None:
        for module in self._critic_fe.modules():
            if isinstance(module, nn.Linear):
                nn.init.orthogonal_(module.weight, gain=math.sqrt(2.0))
                nn.init.zeros_(module.bias)
        for module in self._critic_score.modules():
            if isinstance(module, nn.Linear):
                nn.init.orthogonal_(module.weight, gain=math.sqrt(2.0))
                nn.init.zeros_(module.bias)
        # Small correction on top of the spread penalty in _critic_forward.
        nn.init.orthogonal_(self._critic_score[-1].weight, gain=0.01)
        nn.init.zeros_(self._critic_score[-1].bias)

    def _critic_is_stuck(self) -> bool:
        last = self._critic_score[-1]
        return float(last.weight.detach().norm()) > 5.0 or abs(float(last.bias.detach())) > 2.0

    def _load_weights(self) -> None:
        if os.path.exists(self._model_path):
            try:
                # strict=False: a file from an older build may carry keys that no
                # longer exist, or miss a buffer that then keeps its fresh value.
                incompatible = self.load_state_dict(
                    torch.load(self._model_path, weights_only=True),
                    strict=False,
                )
                logger.info(f"Loaded AM-PPO weights from {self._model_path}")
                if incompatible.missing_keys:
                    logger.info("AM-PPO load left fresh buffers: %s", incompatible.missing_keys)
            except Exception as e:
                logger.warning(f"Failed to load AM-PPO weights from {self._model_path}: {e}")
        with torch.no_grad():
            # A file saved by an older build may hold a value outside the range.
            self._log_std.clamp_(_LOG_STD_MIN, _LOG_STD_MAX)
        if self._critic_is_stuck():
            logger.warning("Reset stuck AM-PPO critic; its output no longer depended on the state")
            self._init_critic()

    def _save_weights(self) -> None:
        try:
            torch.save(self.state_dict(), self._model_path)
        except Exception as e:
            logger.warning(f"Failed to save AM-PPO weights to {self._model_path}: {e}")

    def _actor_forward(self, states: torch.Tensor) -> torch.Tensor:
        # states: (B, N, F)
        f = self._actor_fe(states)  # (B, N, 32)
        f_pool = f.mean(dim=1, keepdim=True).expand(-1, states.size(1), -1)  # (B, N, 32)
        f_cat = torch.cat([f, f_pool], dim=-1)  # (B, N, 64)
        logits = self._actor_score(f_cat).squeeze(-1)  # (B, N)
        # Weights are refit to a fixed total, so a logit shared by every server
        # disappears. Keep the deviation from the live-server mean.
        alive = states[..., 4].clamp(0.0, 1.0)
        count = alive.sum(dim=-1, keepdim=True).clamp(min=1.0)
        mean = (logits * alive).sum(dim=-1, keepdim=True) / count
        return (logits - mean) * alive

    def _critic_forward(self, states: torch.Tensor) -> torch.Tensor:
        # states: (B, N, F). Value sees how far servers sit from each other.
        # The mean level is removed, so an even cluster at 55% and at 100% match,
        # while a split cluster does not.
        encoded = self._critic_fe(states)
        deviation = (encoded - encoded.mean(dim=1, keepdim=True)).abs().mean(dim=1)
        learned = self._critic_score(deviation).squeeze(-1)
        # Same CPU spread as the reward, in normalized-reward units. A gap that
        # costs several reward points moves the value by several points, so the
        # advantage is not just the raw reward.
        cpu = states[..., 0].clamp(0.0, 1.0)
        alive = states[..., 4].clamp(0.0, 1.0)
        count = alive.sum(dim=-1).clamp(min=1.0)
        mean_cpu = (cpu * alive).sum(dim=-1) / count
        mad = ((cpu - mean_cpu.unsqueeze(-1)).abs() * alive).sum(dim=-1) / count
        scale = self._reward_var.detach().sqrt().clamp(min=1e-3)
        return learned - mad * (AM_PPO_REWARD_SPREAD_WEIGHT / scale)

    @property
    def learning_enabled(self) -> bool:
        return self._learning_enabled

    def set_learning_enabled(self, enabled: bool) -> None:
        enabled = bool(enabled)
        if enabled == self._learning_enabled:
            return
        self._learning_enabled = enabled
        # A half-collected rollout belongs to the other mode and must not
        # be mixed into the first update after learning is switched back on.
        self.discard_rollout()
        logger.info("AM-PPO learning %s", "enabled" if enabled else "frozen")

    def act(self, state: ClusterState) -> PpoAction:
        features = tuple(state.to_am_ppo_feature_vector())
        alive_mask = tuple(server.is_healthy for server in state.servers)
        num_servers = len(alive_mask)
        state_tensor = torch.tensor([features], dtype=torch.float32).view(1, num_servers, self._feature_per_server)

        with torch.no_grad():
            distribution = self._distribution(state_tensor)
            # Exploration noise is a training tool. A frozen model acts on the mean.
            sampled_action = (
                distribution.sample()[0] if self._learning_enabled else distribution.mean[0]
            )
            mask_tensor = torch.tensor(alive_mask, dtype=torch.float32)
            log_probability = (distribution.log_prob(sampled_action) * mask_tensor).sum()

        return PpoAction(
            raw_logits=tuple(float(value) for value in sampled_action.tolist()),
            alive_mask=alive_mask,
            log_probability=float(log_probability.item()),
        )

    def observe_transition(
        self,
        state: ClusterState,
        action: PpoAction,
        reward: float,
        next_state: ClusterState,
    ) -> None:
        if not self._learning_enabled:
            return
        features = tuple(state.to_am_ppo_feature_vector())
        next_features = tuple(next_state.to_am_ppo_feature_vector())
        # A join or leave changes the action size. Drop the open rollout
        # instead of stacking vectors of different lengths.
        if self._rollout and len(features) != len(self._rollout[0].state):
            self.discard_rollout()
        self._rollout.append(
            _Transition(
                state=features,
                action=action.raw_logits,
                alive_mask=action.alive_mask,
                log_probability=action.log_probability,
                reward=float(reward),
                next_state=next_features,
            )
        )
        if len(self._rollout) >= self._rollout_size:
            self._update_policy()

    def discard_rollout(self) -> None:
        # Idle gaps must not be stitched into the next loaded trajectory.
        self._rollout.clear()

    def _distribution(self, states: torch.Tensor) -> Normal:
        means = self._actor_forward(states)
        standard_deviations = self._log_std.clamp(_LOG_STD_MIN, _LOG_STD_MAX).exp().expand_as(means)
        return Normal(means, standard_deviations)

    def _update_policy(self) -> None:
        rollout = self._rollout
        self._rollout = []
        
        states_flat = torch.tensor([step.state for step in rollout], dtype=torch.float32)
        next_states_flat = torch.tensor([step.next_state for step in rollout], dtype=torch.float32)
        
        states = states_flat.view(len(rollout), -1, self._feature_per_server)
        next_states = next_states_flat.view(len(rollout), -1, self._feature_per_server)
        
        # Server count is fixed inside one rollout; a change discards it first.
        actions = torch.tensor([step.action for step in rollout], dtype=torch.float32)
        alive_masks = torch.tensor([step.alive_mask for step in rollout], dtype=torch.float32)

        raw_rewards = torch.tensor([step.reward for step in rollout], dtype=torch.float32)
        normalized_rewards = self._normalize_rewards(raw_rewards)

        with torch.no_grad():
            old_values = self._critic_forward(states)
            next_values = self._critic_forward(next_states)

        advantages = [0.0] * len(rollout)
        returns = [0.0] * len(rollout)
        generalized_advantage = 0.0
        reward_values = normalized_rewards.tolist()
        value_list = old_values.tolist()
        next_value_list = next_values.tolist()
        for index in reversed(range(len(rollout))):
            temporal_difference = (
                reward_values[index] + self._gamma * next_value_list[index] - value_list[index]
            )
            generalized_advantage = (
                temporal_difference + self._gamma * self._gae_lambda * generalized_advantage
            )
            advantages[index] = generalized_advantage
            returns[index] = generalized_advantage + value_list[index]

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

        approx_kl = 0.0
        clip_fraction = 0.0
        entropy = torch.zeros(())
        epochs_run = 0
        first_policy_loss = 0.0
        for epoch in range(self._update_epochs):
            distribution = self._distribution(states)
            new_log_probabilities = (
                distribution.log_prob(actions) * alive_masks
            ).sum(dim=1)
            entropy = (distribution.entropy() * alive_masks).sum(dim=1).mean()
            log_ratios = new_log_probabilities - old_log_probabilities
            ratios = log_ratios.exp()
            with torch.no_grad():
                approx_kl = float(((ratios - 1.0) - log_ratios).mean())
                clip_fraction = float(((ratios - 1.0).abs() > self._clip_epsilon).float().mean())
            # The policy already left the trust region; more epochs on the same
            # batch would only overfit 16-32 noisy samples.
            if epoch > 0 and approx_kl > 1.5 * _TARGET_KL:
                break
            unclipped = ratios * advantage_tensor
            clipped = ratios.clamp(
                1.0 - self._clip_epsilon,
                1.0 + self._clip_epsilon,
            ) * advantage_tensor
            policy_loss = -torch.minimum(unclipped, clipped).mean()
            if epoch == 0:
                first_policy_loss = float(policy_loss.detach())
            epochs_run += 1
            values = self._critic_forward(states)
            clipped_values = old_values + (values - old_values).clamp(
                -self._clip_epsilon,
                self._clip_epsilon,
            )
            # Keep the worse fit so one update cannot drag the value far from
            # the prediction that produced this batch.
            value_loss = torch.maximum(
                (values - return_tensor).square(),
                (clipped_values - return_tensor).square(),
            ).mean()
            loss = (
                policy_loss
                + self._value_coefficient * value_loss
                - self._entropy_coefficient * entropy
            )

            self._optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(self.parameters(), max_norm=0.5)
            self._optimizer.step()

        self._save_weights()
        self._update_count += 1
        logger.info(
            "AM-PPO update transitions=%d epochs=%d reward_mean=%.4f reward_scale=%.4f value_mean=%.4f "
            "policy_loss=%.4f value_loss=%.4f kl=%.4f clip=%.2f std=%.3f",
            len(rollout),
            epochs_run,
            float(raw_rewards.mean()),
            float(self._reward_var.sqrt()),
            float(old_values.mean()),
            first_policy_loss,
            float(value_loss.detach().item()),
            approx_kl,
            clip_fraction,
            float(self._log_std.detach().clamp(_LOG_STD_MIN, _LOG_STD_MAX).exp()),
        )

    def _normalize_rewards(self, rewards: torch.Tensor) -> torch.Tensor:
        batch_count = rewards.numel()
        batch_mean = rewards.mean()
        batch_var = rewards.var(unbiased=False) if batch_count > 1 else rewards.new_zeros(())
        count = self._reward_count
        if float(count) <= 0.0:
            new_mean = batch_mean
            new_var = batch_var if batch_count > 1 else rewards.new_ones(())
            new_count = rewards.new_tensor(float(batch_count))
        else:
            total = count + batch_count
            delta = batch_mean - self._reward_mean
            new_mean = self._reward_mean + delta * batch_count / total
            new_var = (
                count * self._reward_var
                + batch_count * batch_var
                + delta.square() * count * batch_count / total
            ) / total
            new_count = total.clamp(max=_REWARD_STATS_WINDOW)
        self._reward_mean.copy_(new_mean.detach())
        self._reward_var.copy_(new_var.detach().clamp(min=1e-4))
        self._reward_count.copy_(new_count.detach())
        scale = self._reward_var.sqrt().clamp(min=1e-3)
        return (rewards - self._reward_mean) / scale