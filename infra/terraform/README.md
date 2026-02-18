# Atlas Meridian Terraform (AWS)

This directory contains the managed cloud baseline for Atlas Meridian control-plane deployment on AWS.

## Coverage

- `CLOUD-006`: AWS baseline stack with ECS/Fargate, RDS Postgres, S3 artifacts, and CloudFront front door.
- `CLOUD-007`: Separate `staging` and `prod` environment roots.
- `CLOUD-008`: ECS blue/green deployment support using CodeDeploy deployment groups and dual target groups.

## Layout

- `modules/atlas-control-plane`: reusable infrastructure module.
- `environments/staging`: staging environment root.
- `environments/prod`: production environment root.

## Quick Start

1. Copy an example tfvars file:
   - `cp infra/terraform/environments/staging/terraform.tfvars.example infra/terraform/environments/staging/terraform.tfvars`
2. Fill in real secrets/ARNs.
3. Initialize and plan:
   - `cd infra/terraform/environments/staging`
   - `terraform init`
   - `terraform plan`
4. Apply when ready:
   - `terraform apply`

## Blue/Green Release Notes

- ECS service uses `deployment_controller = CODE_DEPLOY`.
- CodeDeploy deployment group references blue and green target groups.
- Production traffic route is tied to the ALB listener.
- Rollback on deployment failure is enabled.

## Security Notes

- RDS is configured with storage encryption and deletion protection.
- Artifact bucket enforces SSE-S3 and object versioning.
- Use secret managers/CI variables for `db_password` and image credentials.
