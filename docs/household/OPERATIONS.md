# Operate a Household server

## Provision a production deployment

Use a Linux host with Docker Compose, persistent disk, a DNS name, and inbound TCP ports 80 and 443.
The host must remain available for cross-network synchronization. A sleeping development PC cannot provide that service.

1. Copy `household/.env.example` to `household/.env` outside source control.
2. Generate independent random values for `POSTGRES_PASSWORD` and `BOOTSTRAP_TOKEN` with at least 32 bytes of entropy.
3. Put the database password into `DATABASE_URL`, URL-encoding reserved characters.
4. Set `PUBLIC_HOST` to the reachable DNS name. Point its DNS record to the host.
5. Set `CATALOG_HOST_ALLOWLIST` to the exact permitted metadata hosts. The application rejects provider credentials in URLs.
6. Run `docker compose --env-file household/.env -f household/compose.yaml config` to validate the configuration.
7. Run `docker compose --env-file household/.env -f household/compose.yaml up --build -d`.
8. Confirm `/v1/health` and `/v1/ready` through HTTPS. Open the application and enroll the administrator.
9. Store the administrator password in a household password manager. Keep the environment file readable only by the operator.

Caddy obtains and renews TLS certificates. Its data volumes and the PostgreSQL volume must survive container replacement.
The API is not published directly. Its forwarded-header trust assumes only the private Compose network can reach it.
Do not expose that internal port without revisiting this trust boundary.

The worker retries catalog outages with exponential backoff and preserves the last successful collection.
Imports are database jobs; restarting the worker does not discard queued batches.
`GET /v1/openapi.json` provides the API contract. `/docs` provides FastAPI's interactive documentation when its public assets are reachable.
Do not publish interactive API access to untrusted networks without the same authentication and network protections as the service.

## Back up and restore

Use the included `tools/household/backup.py` on the host to create an encrypted PostgreSQL custom-format backup.
The backup script invokes the operator's `pg_dump` and encrypts its output with AES-GCM using `cryptography`.
Provision `BACKUP_KEY` outside the repository. Store that key separately from backup files.
Use a dedicated encrypted disk for the PostgreSQL volume. The application does not provide database-volume encryption.

Restore into a separate PostgreSQL database first. Run migrations and `/v1/ready`, then verify profile counts, import counts, and watch-event counts.
Do not overwrite the live database before that check. Keep the previous database until the restored deployment has passed verification.
The restore procedure and encrypted backups remain unverified locally because the Docker engine is unavailable.

## Run local development

`tools/household/Start-Local.ps1` creates a protected `.env.local`, a SQLite database, and process IDs in `household/local-processes.json`.
The API binds only to loopback port 8765. The worker runs independently.
Use `tools/household/Stop-Local.ps1` to stop these processes. The script verifies their executable path, command, and child processes before stopping them.
Starting the local service again stops the prior owned processes and applies migrations first.
Local data and logs are ignored by Git. Do not use SQLite as the production replacement for the PostgreSQL deployment gate.

## Upgrade

Back up first. Build from the lockfiles, apply `alembic upgrade head`, and replace API and worker together.
Run the automated checks and inspect [ACCEPTANCE.md](ACCEPTANCE.md) before distributing client artifacts.
Keep Android release keys separate from the upstream DX.BI keys. Unsigned Windows builds are labeled development artifacts.
Configure signing through the platform's protected build environment before public distribution.
No upstream installer or plugin update may overwrite Household Edition.

## Known operational limits

The present client outboxes retry during playback and when the corresponding profile reopens.
Background retries across every OS lifecycle, cold-start offline account access, and native Stremio reconciliation need further work.
Unknown media identities remain queued until the title exists in a permitted catalog. A successful API health check does not establish playback or discovery correctness.
