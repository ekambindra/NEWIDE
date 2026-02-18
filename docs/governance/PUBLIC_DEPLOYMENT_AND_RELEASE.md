# Public Deployment and Release

## Product Model

- Open-core public repository (Apache-2.0 core)
- Enterprise extensions delivered privately

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

## CI/CD

- GitHub Actions for lint/test/build
- Planned: provenance attestations and release pipelines

## Telemetry and Privacy

- Opt-in telemetry only
- Local-only mode remains available
