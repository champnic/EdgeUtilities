---
name: regen-signing-key
description: "Regenerate the Tauri updater signing key. Use when asked to 'regenerate key', 'new signing key', 'fix signing key', 'wrong key password', or 'regen signing key'."
---

# Regenerate Tauri Updater Signing Key

Regenerate the Tauri signing keypair used for auto-update artifact signing, update the local config and GitHub secrets.

## When to use

- The signing key password was lost or forgotten
- The release workflow fails with `failed to decode secret key: incorrect updater private key password`
- The key needs to be rotated for any reason

## Steps

### 1. Generate a new keypair

Run from the EdgeUtilities repo root:

```powershell
cd D:\EdgeUtilities
npx tauri signer generate --no-password -w ~/.tauri/edge-utilities.key
```

This creates two files:
- `~/.tauri/edge-utilities.key` — the **private key** (keep secret)
- `~/.tauri/edge-utilities.key.pub` — the **public key**

The command also prints the public key to the console. Copy it.

If the user wants a password-protected key, omit `--no-password` and note the password for Step 3.

### 2. Update the public key in tauri.conf.json

Replace the `pubkey` value in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey` with the new public key string from Step 1.

**Important**: Existing installed copies of the app will fail auto-update checks after this change because they have the old public key. Users will need to manually download the new version once.

### 3. Update GitHub secrets

Walk the user through updating secrets in the GitHub repo:

1. Go to **https://github.com/champnic/EdgeUtilities/settings/secrets/actions**
2. Update **`TAURI_SIGNING_PRIVATE_KEY`**:
   - Click the edit (pencil) icon next to `TAURI_SIGNING_PRIVATE_KEY`
   - Paste the full contents of `~/.tauri/edge-utilities.key`
   - Click **Update secret**
3. Update **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`**:
   - If the key was generated with `--no-password`: delete this secret, or set it to an empty string
   - If the key has a password: set this secret to that password

### 4. Verify the workflow config

Confirm `.github/workflows/release.yml` references the secrets correctly:

- If using a password: `TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}`
- If no password: `TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ""`

### 5. Commit and push

```powershell
cd D:\EdgeUtilities
git add -A
git commit -m "Regenerate updater signing key"
git push
```

### 6. Test with a release

Invoke the **release** skill to trigger a new release and verify the signing key works end-to-end.
