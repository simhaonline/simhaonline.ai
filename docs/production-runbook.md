# Simha Online production runbook

## Release gate

Run `docker compose config --quiet`, the gateway tests, Python compilation, and the frontend production build. Confirm `/healthz` for control-plane, gateway, worker, and the public domains. Do not deploy with unrotated credentials, failing model discovery, or an untested database restore.

## Database backup and restore

The worker creates gzip-compressed plain SQL dumps in `/backups`. Validate a backup with `gzip -t file.sql.gz`, then restore it into an isolated PostgreSQL database with `gzip -cd file.sql.gz | psql --set ON_ERROR_STOP=on ...`. `pg_restore` is not applicable to these plain SQL files. Production must additionally enable WAL archiving and regularly test point-in-time recovery.

## Incident response

For provider failures, inspect gateway request IDs, account cooldowns, discovered models, and provider response status. A 429 must identify whether the cause is user quota, provider quota, account cooldown, capacity, or model absence. Rotate any exposed API key immediately, revoke the old key, and review the audit log.

## Required external hardening

Use a managed secret store, least-privilege object-storage credentials, PostgreSQL replicas, WAL/PITR storage, a WAF/CDN, centralized logs/metrics/traces, and a tested rollback process. These cannot be proven by the local Compose environment alone.
