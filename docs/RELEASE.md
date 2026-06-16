# Releasing Rony — installers, signing & auto-update

This covers how the desktop installers are built, how to turn on code signing
(and macOS notarization), and the plan for auto-update.

## 1. Building the installers

The **Build Installers** workflow (`.github/workflows/build-installers.yml`)
produces the Windows `.exe` and macOS `.dmg`. It runs:

- **on demand** — Actions tab → _Build Installers_ → _Run workflow_, or
- **automatically** when you push a version tag, e.g.:

  ```bash
  git tag v1.0.0
  git push origin v1.0.0
  ```

Each run uploads the installers as **artifacts** (`rony-windows`, `rony-macos`).
Windows builds on `windows-latest`, macOS on `macos-latest`, because
`better-sqlite3` is a native module that must be rebuilt per-OS.

> **Today the installers are UNSIGNED.** They work, but users see a Windows
> SmartScreen prompt and a macOS Gatekeeper block on first launch. Signing
> (below) removes those.

## 2. Code signing

The workflow already passes the signing credentials as environment variables.
**While the secrets are empty, builds are simply unsigned** — no failure. Add the
secrets and the very same builds become signed, with no workflow edit.

Add these under **Settings → Secrets and variables → Actions** in GitHub.

### Windows

| Secret | What it is |
| --- | --- |
| `WIN_CSC_LINK` | Base64 of your code-signing certificate (`.pfx`/`.p12`) |
| `WIN_CSC_KEY_PASSWORD` | The certificate's password |

- **Get a cert:** buy an OV (~$200/yr) or EV code-signing certificate from a CA
  (DigiCert, Sectigo, SSL.com, …). EV clears SmartScreen reputation immediately;
  OV builds it over time.
- **Encode it** (so it fits in a secret):

  ```bash
  base64 -w0 my-cert.pfx > cert.b64   # Linux
  base64 -i my-cert.pfx | tr -d '\n'  # macOS
  ```

  Paste the result as `WIN_CSC_LINK`.

### macOS

| Secret | What it is |
| --- | --- |
| `MAC_CSC_LINK` | Base64 of your **Developer ID Application** cert (`.p12`) |
| `MAC_CSC_KEY_PASSWORD` | The `.p12` password |
| `APPLE_ID` | Your Apple Developer account email (for notarization) |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | Your 10-character Apple Team ID |

- **Get a cert:** requires an **Apple Developer Program** membership ($99/yr).
  In Xcode or the Developer portal, create a _Developer ID Application_
  certificate, then export it from Keychain as a `.p12` and base64-encode it as
  above.

### Enabling macOS notarization

Signing alone isn't enough for macOS — Apple also requires **notarization**.
After the `MAC_*` and `APPLE_*` secrets are in place, edit `electron-builder.yml`:

```yaml
mac:
  # ...
  notarize:
    teamId: YOUR_APPLE_TEAM_ID
```

electron-builder reads the `APPLE_*` env vars the workflow already passes and
notarizes the signed app automatically.

## 3. Auto-update (planned — depends on signing)

Auto-update is **intentionally not wired yet**, because it depends on signing:
`electron-updater` verifies update signatures, and macOS will reject an unsigned
update at the OS level. Wire it **after** signing is working.

`electron-builder.yml` already publishes to GitHub Releases:

```yaml
publish:
  provider: github
  owner: shbh8205-lgtm
  repo: invoice-scanner-rony
```

When ready:

1. `npm i electron-updater`
2. In the main process startup (`src/main/index.ts`), after the window is
   created:

   ```ts
   import { autoUpdater } from 'electron-updater'
   // ...
   autoUpdater.checkForUpdatesAndNotify()
   ```

3. Change the build steps from `--publish never` to publishing on tagged builds
   (electron-builder uploads the installers **and** the `latest.yml` /
   `latest-mac.yml` update manifests to the GitHub Release), and give the build
   job `permissions: contents: write` so it can create the release.
4. Tag a release (`git tag v1.0.1 && git push --tags`); installed apps pick it up
   on next launch.

> Until then, "updates" mean: build a new tag, download the artifact, install
> manually.
