# Architecture

- API service handles synchronous requests and exposes health endpoints.
- Worker service runs periodic jobs and writes structured logs.
- Postgres provides durable state with bootstrap schema in `db/init`.
