# Desktop Release Pipeline

## Workflows

- Build-only CI: `.github/workflows/desktop-build.yml`
- Signed release CI: `.github/workflows/desktop-release.yml`
- Open-core publishing: `.github/workflows/open-core-publish.yml`
- Enterprise extension distribution: `.github/workflows/enterprise-extension-distribute.yml`
- Benchmark gate: `.github/workflows/benchmark-gate.yml`
- Public docs site deploy: `.github/workflows/docs-site.yml`

## Required Secrets

### macOS Signing and Notarization

- `MACOS_CSC_LINK`
- `MACOS_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

### Windows Signing

- `WINDOWS_CSC_LINK`
- `WINDOWS_CSC_KEY_PASSWORD`

### Update Delivery

- Repository variable: `ATLAS_UPDATE_BASE_URL`

## Release Channels

- `stable`: GA channel
- `beta`: prerelease channel

The workflow dispatch input `channel` controls which channel metadata is emitted. Runtime channel defaults to `stable` and can be switched in the desktop UI.

## Provenance

Release workflow emits artifact attestations using `actions/attest-build-provenance` for generated desktop artifacts.
