Do not require `JUDGE_BASE_URL` or `JUDGE_MODEL` in `.env`.

Rebuild this so the Judge Engine is fully integrated with the existing SIMHA provider/model registry and can be configured dynamically from the Admin Dashboard and database.

Requirements:

* The Judge Engine must automatically discover all available OpenAI-compatible, Anthropic-compatible, local, Ollama, OpenRouter, and other configured providers/models already registered in SIMHA.
* Add Admin → Evaluation → Judge Settings.
* Allow selecting Primary Judge Model, Secondary Judge Model, Tie-Breaker Judge Model, and optional Local/Fallback Judge.
* Support multi-judge consensus.
* Store configuration in the existing database/config system, not `.env`.
* API keys must continue using SIMHA’s existing encrypted provider credential management.
* If no LLM Judge is configured, use the heuristic judge only as a fallback and clearly show `HEURISTIC MODE` in the dashboard.
* If the selected judge model/provider becomes unavailable, automatically fail over to configured fallback judges.
* Include health checks, latency, token usage, cost, scoring statistics, and judge failure rates.
* Judge models must be changeable without restarting or redeploying SIMHA.
* Do not hard-code any judge endpoint or model.
* Do not create a separate duplicate provider configuration system specifically for the Judge Engine.

Also add an `AUTO` mode where SIMHA selects the best available judge model based on quality, reliability, cost, latency, context requirements, and current provider health.

The final architecture should be:

User/Admin Judge Policy
→ SIMHA Model & Provider Registry
→ Judge Router
→ Primary Judge
→ Fallback / Multi-Judge Consensus
→ Aggregated Evaluation Result

`.env` should only be supported as an optional backward-compatible bootstrap mechanism, not as the primary production configuration method.
