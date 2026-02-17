# Public Deployment and Release

## Product Model

- Open-core public repository (Apache-2.0 core)
- Enterprise extensions delivered privately

## Cloud Target

- AWS baseline
- Planned: ECS/Fargate, RDS, S3, CloudFront/API Gateway, staging/prod separation

## Desktop Distribution Targets

1. macOS signed/notarized build
2. Windows signed MSI
3. Stable and beta update channels

## CI/CD

- GitHub Actions for lint/test/build
- Planned: provenance attestations and release pipelines

## Telemetry and Privacy

- Opt-in telemetry only
- Local-only mode remains available
