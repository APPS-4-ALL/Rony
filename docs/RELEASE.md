# Releasing Rony — installers, signing & auto-update

This covers how the desktop installers are built and published, how to turn on
code signing (and macOS notarization), and how the in-app auto-update flow works.

## 1. Building the installers

The **Build Installers** workflow (`.github/workflows/build-installers.yml`)
produces the Windows `.exe` and macOS `.dmg`. It runs:

- **on demand** — Actions tab → _Build Installers_ → _Run workflow_ — builds
  only, uploaded as **artifacts** (`rony-windows`, `rony-macos`); no Release is
  touched; or
- **on a version tag** — builds **and publishes** to a GitHub Release for the
  auto-updater (see §3):

  ```bash
  git tag v1.0.0
  git push origin v1.0.0
  ```

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

## 3. Auto-update

The **in-app updater is already shipped** (RONY-20, `src/main/update/index.ts`,
wired from `src/main/index.ts`). On launch, a packaged build checks GitHub
Releases via `electron-updater`, downloads a newer version in the background, and
installs it on the next quit. It's production-only (`!is.dev`) and fully
failure-tolerant (offline / GitHub down is a silent no-op).

The release channel is the `publish` block already in `electron-builder.yml`:

```yaml
publish:
  provider: github
  owner: shbh8205-lgtm
  repo: invoice-scanner-rony
```

### How a release reaches users

```
git tag v1.0.1 && git push origin v1.0.1
        │
        ▼
Build Installers workflow runs with --publish always
        │  uploads the .exe/.dmg AND the latest.yml / latest-mac.yml
        │  update manifests to a GitHub Release (created as a DRAFT)
        ▼
You publish the draft Release on GitHub
        │
        ▼
Installed apps see it on next launch and self-update
```

- A **tag push** publishes; a **manual** _Run workflow_ only builds artifacts
  (`--publish never`), so you can test-build without touching a Release.
- electron-builder creates the Release as a **draft**, and the auto-updater
  **ignores drafts** — so nothing rolls out until you click _Publish_ on the
  draft. That's the intended human gate; review, then publish.

### ⚠️ Signing is still required for this to work end-to-end

Auto-update depends on signing — especially on **macOS**, where Gatekeeper
rejects an unsigned/un-notarized update, so the download installs but won't
launch. Windows auto-update generally works unsigned (with SmartScreen
friction). Until the certs from §2 are in place, treat macOS auto-update as
**not yet functional**.

### Local smoke test

`dev-app-update.yml` mirrors the publish block so you can exercise the updater
against a real Release from a locally-built, packaged app (not `npm run dev`,
which is dev-gated). `npm run release` (build + `electron-builder --publish
always`) publishes from a developer machine if you ever need to bypass CI.
