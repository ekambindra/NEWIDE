# GA Signoff Refresh - 2026-02-25

This record captures deployment/testing hardening completed on 2026-02-25 and the remaining operational actions in GitHub.

## Completed in Repository

1. Added release signing preflight checks:
   - `scripts/check-release-signing-secrets.sh`
   - wired into `.github/workflows/desktop-release.yml`
2. Added heavy validation workflow:
   - `.github/workflows/heavy-test.yml`
3. Added benchmark publication workflow:
   - `.github/workflows/benchmark-publish.yml`
4. Added benchmark publication automation script:
   - `scripts/publish-benchmark-artifacts.mjs`
5. Refreshed benchmark transparency docs:
   - `public-docs/benchmark-artifacts/latest-run.txt`
   - `public-docs/benchmark-artifacts/ga-20260225T183545Z-seed1337/`
   - `public-docs/benchmarks.html`

## Local Verification Evidence

1. Release secret preflight checks (simulated env values):
   - `npm run release:preflight:macos` -> pass
   - `npm run release:preflight:windows` -> pass
2. Workspace quality gates:
   - `npm run lint` -> pass
   - `npm run test` -> pass
   - `npm run build` -> pass
3. Heavy validation:
   - `./scripts/heavy-test.sh` -> pass
   - report: `atlas-build-lab/reports/heavy-20260225133702.json`
4. Benchmark publication:
   - `npm run benchmark:publish` -> pass
   - run id: `ga-20260225T183545Z-seed1337`

## Remaining GitHub Operational Steps

1. Configure repository signing/notarization secrets and update base URL variable.
2. Run `desktop-release.yml` with `channel=stable`.
3. Run `benchmark-publish.yml` (workflow_dispatch) and verify commit/update on `main`.
4. Confirm `docs-site.yml` deployment picks up refreshed benchmark transparency page.
5. Stamp or update GA release tag after checklist approval.

## Status Update (Completed)

1. `benchmark-publish.yml` completed successfully: run `22411405089`.
2. `desktop-release.yml` stable completed successfully after workflow hardening: run `22412163336`.
3. Validation workflows green on release commit `e51066cbf8c72a9b606a513df20fa9e20282164a`:
   - `ci`: `22411721453`
   - `desktop-build`: `22411721451`
   - `benchmark-gate`: `22411721456`
   - `docs-site`: `22411721445`
