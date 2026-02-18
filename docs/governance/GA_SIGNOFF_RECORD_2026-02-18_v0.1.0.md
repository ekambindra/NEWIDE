# GA Signoff Record - Atlas Meridian v0.1.0

- Execution date (UTC): 2026-02-18
- Release tag: `v0.1.0`
- Commit: `de411b7a4f14d579c05230c31587f4711ca8d574`

## Workflow Evidence

- `ci`: [run 22127407090](https://github.com/ekambindra/atlas-meridian/actions/runs/22127407090) - success
- `desktop-build`: [run 22127407083](https://github.com/ekambindra/atlas-meridian/actions/runs/22127407083) - success
- `benchmark-gate`: [run 22127407063](https://github.com/ekambindra/atlas-meridian/actions/runs/22127407063) - success
- `docs-site`: [run 22127407085](https://github.com/ekambindra/atlas-meridian/actions/runs/22127407085) - success
- `desktop-release (stable, signed)`: [run 22127466297](https://github.com/ekambindra/atlas-meridian/actions/runs/22127466297) - success

## Reliability

1. CI workflows green on `main` for 7 consecutive days.
   - Status: `CONDITIONAL`
   - Evidence: latest required workflows are green; historical 7-day streak window not yet accrued in this repository lifecycle.
2. No P0/P1 open regressions in core desktop runtime.
   - Status: `PASS`
   - Evidence: no open P0/P1 issues recorded in repository issue tracker at execution time.
3. Replay/checkpoint integrity tests pass at 100% artifact presence.
   - Status: `PASS`
   - Evidence: benchmark report KPI `checkpoint_integrity = 1.0`.

## Security

1. Secrets redaction tests pass.
   - Status: `PASS`
   - Evidence: `apps/desktop/src/main/security-utils.test.ts` passing in `npm run test`.
2. Policy gate tests pass for command/path/dependency/sensitive-file controls.
   - Status: `PASS`
   - Evidence: `packages/policy-engine/src/index.test.ts` and refactor/terminal policy tests passing.
3. OIDC/SAML + RBAC integration tests pass in CI.
   - Status: `PASS`
   - Evidence: `apps/desktop/src/main/auth.test.ts` passing in CI.
4. Control-plane TLS requirement enabled for production mode.
   - Status: `PASS`
   - Evidence: `apps/desktop/src/main/enterprise-settings.ts` enforces TLS when required; covered by `enterprise-settings.test.ts`.

## Performance

From `packages/benchmark/fixtures/latest-report.json` generated `2026-02-18T05:05:04.338Z`:

1. Inline suggestion latency P95 <= 250ms.
   - Status: `PASS` (`218ms`)
2. Index freshness latency <= 200ms small and <= 2s batch.
   - Status: `PASS` (`149.94ms` small, `1571.72ms` batch)
3. Medium feature completion <= 5 minutes.
   - Status: `PASS` (`264.56s` avg task completion)

## Release and Operations

1. macOS and Windows installers built and signed.
   - Status: `PASS`
   - Evidence: `desktop-release` run 22127466297, both OS jobs success.
2. Stable update channel points to latest GA artifacts.
   - Status: `PASS`
   - Evidence: release workflow executed with `channel=stable`; artifacts produced for both OS jobs.
3. Provenance attestations generated.
   - Status: `PASS`
   - Evidence: `Attest macOS artifacts` and `Attest Windows artifacts` steps succeeded in run 22127466297.
4. Rollback path tested (desktop updater + control plane blue/green).
   - Status: `CONDITIONAL`
   - Evidence: runbook exists; explicit live rollback drill not executed in this session.
5. Backup/restore smoke test for control-plane metadata.
   - Status: `PASS`
   - Evidence: `apps/control-plane/src/encrypted-store.test.ts` backup/restore test passing.

## Documentation

1. README and docs portal reflect GA version.
   - Status: `PASS`
2. Security and runbook docs reflect controls.
   - Status: `PASS`
3. Benchmark transparency page updated with latest report.
   - Status: `PASS`
   - Evidence: `public-docs/benchmarks.html` updated and linked to `public-docs/benchmark-artifacts/ga-20260218T050504Z-seed1337/`.

## Approval Record

- Security approval: `recorded`
- Reliability approval: `recorded`
- Product release approval: `recorded`
- Date and version tag in release notes: `2026-02-18 / v0.1.0`
