# Atlas Meridian v0.1.1 Release Notes

Release date: 2026-02-25 (UTC)
Tag: `v0.1.1`

## Highlights

1. Added deployment/testing automation hardening:
   - `heavy-test.yml` (manual + nightly)
   - `benchmark-publish.yml` (manual + weekly)
2. Added release-signing preflight gates with cross-platform support.
3. Fixed deterministic workspace dependency build ordering to stabilize CI and release pipelines.
4. Fixed heavy-test portability issue (removed local absolute path in stress project generation).
5. Published fresh benchmark transparency artifacts and updated benchmark docs page.

## Validation Evidence

- CI: https://github.com/ekambindra/atlas-meridian/actions/runs/22411721453
- Desktop build: https://github.com/ekambindra/atlas-meridian/actions/runs/22411721451
- Benchmark gate: https://github.com/ekambindra/atlas-meridian/actions/runs/22411721456
- Heavy test: https://github.com/ekambindra/atlas-meridian/actions/runs/22411266585
- Benchmark publish: https://github.com/ekambindra/atlas-meridian/actions/runs/22411405089
- Desktop release (stable): https://github.com/ekambindra/atlas-meridian/actions/runs/22412163336

## Benchmark Publication

- Latest run ID: `ga-20260225T185928Z-seed1337`
- Artifacts: `public-docs/benchmark-artifacts/ga-20260225T185928Z-seed1337/`
- Transparency page: `public-docs/benchmarks.html`

## Operational Notes

1. macOS notarization credentials are currently optional in preflight; signed builds proceed when cert secrets are present.
2. If notarization is required for policy, configure:
   - `APPLE_ID`
   - `APPLE_APP_SPECIFIC_PASSWORD`
   - `APPLE_TEAM_ID`
