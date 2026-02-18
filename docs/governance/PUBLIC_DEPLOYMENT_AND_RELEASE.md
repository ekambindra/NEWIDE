# Public Deployment and Release

## Product Model

- Open-core public repository (Apache-2.0 core)
- Enterprise extensions delivered privately
- Open-core publish workflow: `.github/workflows/open-core-publish.yml`
- Enterprise extension distribution workflow: `.github/workflows/enterprise-extension-distribute.yml`

## Cloud Target

- AWS baseline
- Implemented IaC baseline in `infra/terraform`:
  - ECS/Fargate control-plane service
  - RDS Postgres metadata store
  - S3 artifact bucket
  - CloudFront front door
  - Staging/prod environment roots
  - ECS blue/green deployment group via CodeDeploy

## Desktop Distribution Targets

1. macOS signed/notarized build
2. Windows signed MSI
3. Stable and beta update channels
4. Implemented CI build pipelines: `.github/workflows/desktop-build.yml` (macOS + Windows artifact builds)
5. Implemented release pipeline: `.github/workflows/desktop-release.yml` (channel-aware signing, notarization, provenance attestation)

## CI/CD

- GitHub Actions for lint/test/build
- Implemented provenance attestations in release workflow
- Implemented release workflows for signed desktop artifacts
- Implemented benchmark regression gate workflow: `.github/workflows/benchmark-gate.yml`
- Implemented docs site deploy workflow: `.github/workflows/docs-site.yml`
  - Uses `actions/configure-pages@v5` with `enablement: true` to bootstrap GitHub Pages automatically.

## Telemetry and Privacy

- Opt-in telemetry only
- Local-only mode remains available
