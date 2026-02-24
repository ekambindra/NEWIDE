# Runbook

## Startup
- `docker compose up -d`

## Health
- API: `curl http://localhost:4000/health`
- Worker: inspect container logs for tick output.

## Recovery
- Restart failing service: `docker compose restart <service>`
- Reinitialize DB: remove volume and re-run compose.
