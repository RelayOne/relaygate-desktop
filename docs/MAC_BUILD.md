# macOS DMG build — local + future Cloud Build path

## TL;DR

The cross-platform Linux pipeline (`cloudbuild.yaml`) ships **unsigned mac.zip** for both x64 and arm64 — the `.app` bundle is inside the zip, users mount and run. Two unzip → drag flow.

For a **signed and notarized .dmg**, the build must run on a macOS host. Cloud Build does not natively support macOS workers, so we ship two paths:

1. **Now (local)** — A developer with macOS runs `npm run dist:mac` locally. Output lands in `release/RelayGate-0.1.0-x64.dmg` and `release/RelayGate-0.1.0-arm64.dmg`.
2. **Future (CI)** — `cloudbuild-mac.yaml` is a scaffold for SSH'ing into a self-hosted macOS Mac mini / MacStadium / MacinCloud runner from a regular Cloud Build job. Same pattern as `sites/cloudbuild-deploy-sites.yaml` uses for VM-rsync deploys.

## Why this is the right answer

The same constraint applies to every Electron product in the RelayOne org. Sister product `RelayOne/apps/agent-desktop` has identical electron-builder DMG config but no Cloud Build pipeline — DMG is built locally on dev macOS. This is the org pattern.

Cross-platform DMG creation from Linux requires:

- `libdmg-hfsplus` (not in standard apt)
- HFS+ filesystem support
- Custom toolchain compilation

It's a multi-day rabbit hole that produces an **unsigned** DMG that still triggers Gatekeeper warnings. The pragmatic path is "ship signed DMG when we have macOS infrastructure" rather than "ship unsigned DMG that Gatekeeper still warns about."

## Local build (developer with macOS)

```bash
nvm use            # node 20.18.1
npm install
npm run dist:mac
ls -la release/
# → RelayGate-0.1.0-x64.dmg
# → RelayGate-0.1.0-arm64.dmg
# → RelayGate-0.1.0-x64-mac.zip
# → RelayGate-0.1.0-arm64-mac.zip
```

For signing/notarization, set environment variables before `npm run dist:mac`:

```bash
export CSC_LINK="/path/to/DeveloperIDApplication.p12"
export CSC_KEY_PASSWORD="<.p12 password>"
export APPLE_ID="<your-apple-id>"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="<10-char team id>"
```

`electron-builder.yml` will pick up `CSC_LINK` and run `codesign` + `xcrun notarytool` automatically.

Upload to the public bucket:

```bash
gcloud storage cp release/RelayGate-0.1.0-x64.dmg \
  gs://relayone-488319-public/relaygate-desktop/$(git rev-parse --short HEAD)/RelayGate-0.1.0-x64.dmg
gcloud storage cp release/RelayGate-0.1.0-x64.dmg \
  gs://relayone-488319-public/relaygate-desktop/latest/RelayGate-0.1.0-x64.dmg
# … repeat for arm64
```

## Future CI path

`cloudbuild-mac.yaml` is the scaffold. It is currently a no-op without:

1. A macOS runner host. Options:
   - Self-hosted Mac mini in the office (cheapest at scale)
   - MacStadium ($79+/mo dedicated Mac mini)
   - MacinCloud ($30+/mo shared, $130+/mo dedicated)
   - GitHub Actions macOS runners — **not used per org policy** (no GitHub Actions)
2. Apple Developer ID account ($99/year) with a "Developer ID Application" certificate
3. Secret Manager entries:
   - `relaygate-desktop-mac-deploy-key` — SSH key for runner
   - `apple-developer-id-cert` — base64 of `.p12`
   - `apple-developer-id-cert-pass` — password
   - `apple-id-email`
   - `apple-app-specific-password`
   - `apple-team-id`
4. A second Cloud Build trigger (`relaygate-desktop-mac-binaries`) pointed at `cloudbuild-mac.yaml` with `_MAC_RUNNER_HOST` substitution set to the runner's external IP

When all four are in place, push to main triggers the Linux pipeline (zip + AppImage + deb + nsis) AND the mac pipeline (DMG signed + notarized) in parallel.

## Why not GitHub Actions

Per the org's `CLAUDE.md`-equivalent rules: "No GitHub CI, ever. All builds run through Cloud Build or VMs you spin up." GitHub Actions has free macOS runners, but they're off the table. The org has standardized on Cloud Build, and the macOS-runner-via-SSH pattern is consistent with how `sites/cloudbuild-deploy-sites.yaml` already deploys to a portfolio-sites GCE VM.
