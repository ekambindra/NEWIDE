# Deploy and Testing Runbook

This runbook covers the remaining release, deployment, and validation steps for Atlas Meridian.

## 1) Configure GitHub Secrets and Variables

Set these repository secrets before running signed release workflows:

- `MACOS_CSC_LINK`
- `MACOS_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `WINDOWS_CSC_LINK`
- `WINDOWS_CSC_KEY_PASSWORD`

Set this repository variable for update metadata:

- `ATLAS_UPDATE_BASE_URL`

## 2) Local Preflight and Validation

Run from repo root:

```bash
npm ci
npm run release:preflight:macos
npm run release:preflight:windows
npm run lint
npm run test
npm run build
./scripts/heavy-test.sh
```

## 3) Required CI Workflow Execution Order

1. `heavy-test.yml` (manual dispatch or nightly schedule)
2. `benchmark-publish.yml` (publishes fresh benchmark artifacts + updates `public-docs/benchmarks.html`)
3. `desktop-release.yml` with `channel=stable`
4. `docs-site.yml` to publish updated public documentation

## 4) Verify Release Artifacts

Confirm:

1. Signed macOS and Windows artifacts uploaded in `desktop-release`.
2. Provenance attestation steps passed for both OS jobs.
3. `public-docs/benchmark-artifacts/latest-run.txt` matches the latest published run folder.
4. `public-docs/benchmarks.html` points at the same latest run.

## 5) Refresh GA Signoff Evidence

Update GA evidence file with latest run links and results:

- `docs/governance/GA_SIGNOFF_RECORD_2026-02-18_v0.1.0.md` (or add a new dated GA signoff record)

Reference checklist:

- `docs/governance/GA_SIGNOFF_CHECKLIST.md`
