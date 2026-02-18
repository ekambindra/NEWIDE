# GA Signoff Checklist

This checklist defines M11 GA readiness signoff for Atlas Meridian.

## Reliability

1. CI workflows green on `main` for 7 consecutive days:
   - `ci`
   - `desktop-build`
   - `benchmark-gate`
   - `docs-site`
2. No P0/P1 open regressions in core desktop runtime.
3. Replay and checkpoint integrity tests pass at 100% artifact presence.

## Security

1. Secrets redaction tests pass in desktop/runtime suites.
2. Policy gate tests pass for command/path/dependency/sensitive-file controls.
3. OIDC/SAML + RBAC integration tests pass in CI.
4. Control-plane TLS requirement is enabled in production configuration.

## Performance

1. Inline suggestion latency P95 <= 250ms.
2. Index freshness latency <= 200ms small changes and <= 2s batched updates.
3. Medium feature task completion <= 5 minutes (benchmark median).

## Release and Operations

1. macOS and Windows installers built and signed.
2. Stable update channel points to latest GA artifacts.
3. Provenance attestation generated for release artifacts.
4. Rollback path tested:
   - desktop updater rollback
   - control-plane blue/green rollback
5. Backup/restore smoke test executed for control-plane metadata.

## Documentation

1. `README.md` and docs portal reflect current GA version.
2. Security and runbook documents reflect current controls.
3. Benchmark transparency page updated with latest published report.

## GA Approval Record

1. Security approval: `required`
2. Reliability approval: `required`
3. Product release approval: `required`
4. Date and version tag recorded in release notes
