# Atlas Meridian v0.1.0 Release Notes

Release date: 2026-02-18 (UTC)
Tag: `v0.1.0`

## Highlights

- Signed desktop release pipeline validated for macOS and Windows.
- Deterministic benchmark report refreshed and published in docs.
- GA signoff checklist executed with evidence-backed record.

## Validation Evidence

- Desktop stable signed release: https://github.com/ekambindra/atlas-meridian/actions/runs/22127232444
- Benchmark artifacts: `public-docs/benchmark-artifacts/ga-20260218T050504Z-seed1337/`
- GA signoff record: `docs/governance/GA_SIGNOFF_RECORD_2026-02-18_v0.1.0.md`

## Known Conditions

- 7-day consecutive green-history and live rollback drill are tracked as operational follow-ups.

## Rollback Notes

- Desktop clients: move update channel pointer back to prior stable artifacts.
- Control plane: use blue/green switchback and metadata backup restore path.
