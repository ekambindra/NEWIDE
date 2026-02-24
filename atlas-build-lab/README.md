# Atlas Build Lab

This folder holds generated build outputs used to validate Atlas Meridian's product builder capabilities.

## Structure
- `test-cases/`: generated multi-service template products.
- `games/`: game-style sample products used as creative build tests.

## Current Samples
- `test-cases/atlas-crm-platform`
- `test-cases/atlas-ops-console`
- `test-cases/atlas-commerce-engine`
- `games/atlas-number-duel`

## Validation Workflow
For each sample project:
1. Install dependencies when needed.
2. Run `npm run lint` (if present).
3. Run `npm run test`.
4. Run `npm run build` (if present).
