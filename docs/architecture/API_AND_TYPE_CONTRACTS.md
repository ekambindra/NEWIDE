# API and Type Contracts

Source of truth schemas are defined in:

- `packages/shared/src/index.ts`

## Core Contracts

1. ToolCall
2. StepPlan
3. StepResult
4. PatchArtifact
5. RunManifest
6. PolicyConfig
7. AuditEvent
8. IndexSymbol
9. GroundingEvidence
10. BenchmarkTask
11. MetricRecord
12. DecisionLog
13. ReplayComparison

## Control Plane Endpoints (baseline)

Implemented in:

- `apps/control-plane/src/server.ts`

Routes:

1. `/orgs`
2. `/workspaces`
3. `/policies`
4. `/audit/events`
5. `/metrics`
6. `/auth/sso`
7. `/releases`
8. `/health`
