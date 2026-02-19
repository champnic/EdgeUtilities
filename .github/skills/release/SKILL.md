---
name: release
description: "Release a new version of EdgeUtilities. Use when asked to 'release', 'publish', 'create a release', 'bump version', or 'ship a new version'."
---

# Release EdgeUtilities

Publish a new version of EdgeUtilities via GitHub Releases with auto-update support.

## Prerequisites

- The app must build successfully (invoke the **build** skill if needed)
- The `TAURI_SIGNING_PRIVATE_KEY` secret must be configured in the GitHub repo settings
  - Key is stored locally at `~/.tauri/edge-utilities.key`
  - Add it at: Repository Settings → Secrets and variables → Actions → `TAURI_SIGNING_PRIVATE_KEY`

## Steps

### 1. Determine the new version

Read the current version from `src-tauri/tauri.conf.json` (the `version` field).

Suggest the next patch version (e.g., `0.1.0` → `0.1.1`). Ask the user to confirm or provide a different version number. Use semver format (`MAJOR.MINOR.PATCH`).

### 2. Update version in both config files

Update the version string in **both** of these files to the new version:
- `src-tauri/tauri.conf.json` → `"version": "<new_version>"`
- `package.json` → `"version": "<new_version>"`

### 3. Commit and tag

```powershell
cd D:\EdgeUtilities
git add -A
git commit -m "Release v<new_version>"
git tag v<new_version>
```

### 4. Push with tags

```powershell
git push origin main --tags
```

This triggers the GitHub Actions workflow at `.github/workflows/release.yml`, which will:
- Build the Tauri app on Windows
- Create a GitHub Release with the installer artifacts
- Generate and upload `latest.json` for the auto-updater
- Sign the update bundles with the private key

### 5. Verify the release

After pushing, let the user know:
- The release workflow is running at `https://github.com/champnic/EdgeUtilities/actions`
- Once complete, the release will be at `https://github.com/champnic/EdgeUtilities/releases`
- Existing installations will detect the update on next launch
