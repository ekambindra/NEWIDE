# Open-Core and Enterprise Distribution

## Open-Core Publishing (`REL-008`)

Workflow: `/Users/ekambindra/NEWIDE/.github/workflows/open-core-publish.yml`

What it does:

- Validates repository (`lint`, `test`, `build`)
- Produces open-core source archive
- Publishes open-core npm packages (`@ide/shared`, `@ide/policy-engine`, `@ide/indexer`, `@ide/agent-runtime`, `@ide/benchmark`) when `dry_run=false` and `NPM_TOKEN` is configured
- Supports dry-run package previews via `npm pack --dry-run`

## Enterprise Extension Distribution (`REL-009`)

Workflow: `/Users/ekambindra/NEWIDE/.github/workflows/enterprise-extension-distribute.yml`

Package: `/Users/ekambindra/NEWIDE/enterprise/extension/package.json`

What it does:

- Versions enterprise extension package
- Builds tarball artifact
- Publishes to GitHub Packages as restricted package when `dry_run=false`

## Public Docs Site (`REL-010`)

Workflow: `/Users/ekambindra/NEWIDE/.github/workflows/docs-site.yml`

Site source: `/Users/ekambindra/NEWIDE/public-docs`

What it does:

- Publishes docs site to GitHub Pages
- Includes roadmap and benchmark transparency pages
