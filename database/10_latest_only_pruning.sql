-- 10_latest_only_pruning.sql — round 2: retire superseded point releases.
-- Principle: one LIVE model per product family (latest generation), tier
-- siblings (mini/nano/flash/pro) of the latest version stay, everything the
-- newest release supersedes is disabled by policy (survives refresh cycles).
INSERT INTO model_deprecations(pattern, reason, kind) VALUES
('o1-%', 'o-series superseded by gpt-5.x', 'deprecated'),
('o3-%', 'o-series superseded by gpt-5.x', 'deprecated'),
('o4-%', 'o-series superseded by gpt-5.x', 'deprecated'),
('o1', 'o-series superseded by gpt-5.x', 'deprecated'),
('o3', 'o-series superseded by gpt-5.x', 'deprecated'),
('%gpt-5.1%', 'Superseded by gpt-5.5', 'deprecated'),
('%gpt-5.2%', 'Superseded by gpt-5.5', 'deprecated'),
('%gpt-5.4%', 'Superseded by gpt-5.5', 'deprecated'),
('%gpt-4.1%', 'GPT-4.1 superseded by gpt-5.x', 'legacy'),
('%glm-4.%', 'GLM 4.x superseded by GLM 5.x', 'legacy'),
('glm-5.1', 'Superseded by glm-5.3', 'deprecated'),
('glm-5.2', 'Superseded by glm-5.3', 'deprecated'),
('%claude-opus-4.1%', 'Superseded by claude-opus-5', 'deprecated'),
('%claude-opus-4.5%', 'Superseded by claude-opus-5', 'deprecated'),
('%claude-opus-4.6%', 'Superseded by claude-opus-5', 'deprecated'),
('%claude-opus-4.7%', 'Superseded by claude-opus-5', 'deprecated'),
('%claude-sonnet-4.5%', 'Superseded by claude-sonnet-5', 'deprecated'),
('%grok-4.3', 'Superseded by grok-4.20', 'deprecated'),
('%grok-4.5', 'Superseded by grok-4.20', 'deprecated'),
('%grok-4.6', 'Superseded by grok-4.20', 'deprecated'),
('%qwen3.5-%', 'Superseded by qwen3.8 generation', 'deprecated'),
('%qwen3.6-%', 'Superseded by qwen3.8 generation', 'deprecated'),
('qwen3-max%', 'Superseded by qwen3.8-max', 'deprecated'),
('%qwen-plus-2025-%', 'Old qwen-plus dated snapshot', 'snapshot'),
('%mistral-large-2407%', 'Superseded by mistral-large-2512', 'snapshot'),
('%muse-spark-1.1%', 'Superseded by muse-spark-1.3', 'deprecated'),
('%muse-spark-1.2%', 'Superseded by muse-spark-1.3', 'deprecated'),
('%llama-3.1-8b%', 'Legacy small Llama', 'legacy'),
('%hermes-3-llama%', 'Legacy Hermes 3', 'legacy'),
('%aion-2.0', 'Superseded by aion-3.0', 'deprecated'),
('%kimi-k2.5%', 'Superseded by Kimi-K3', 'deprecated'),
('%kimi-k2.6%', 'Superseded by Kimi-K3', 'deprecated'),
('%kimi-k2.7-code%', 'Superseded by Kimi-K3', 'deprecated'),
('%kimi-k2%', 'Kimi K2 superseded by Kimi K3', 'legacy'),
('%DeepSeek-V3.1%', 'Superseded by DeepSeek-V4', 'deprecated'),
('%qwen2.5%', 'Qwen 2.5 superseded by Qwen3.8', 'legacy'),
('%ling-3.0-flash-fin%', 'Specialized variant not in production use', 'variant')
ON CONFLICT (pattern) DO UPDATE SET reason = EXCLUDED.reason, kind = EXCLUDED.kind;

-- Re-apply all policies
UPDATE discovered_models dm SET enabled = false
FROM model_deprecations dp
WHERE dp.enabled = true AND dm.model ILIKE dp.pattern;
