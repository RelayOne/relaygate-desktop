# Deployment

## Overview

RelayGate Desktop deploys via two Google Cloud Build pipelines that share a single GCS publication target.

The primary pipeline, `cloudbuild.yaml`, runs on every push to `main` and produces all nine-plus shipping artifacts (Linux AppImage x64+arm64, Linux .deb x64+arm64, Windows nsis x64, macOS .zip x64+arm64, macOS .dmg x64+arm64 unsigned) inside a single Linux runner using `electron-builder` cross-compile plus the Mozilla fork of `libdmg-hfsplus` for the unsigned DMG step.

The secondary pipeline, `cloudbuild-mac.yaml`, is a future-state pipeline for SSH-tunneled signed and notarized macOS builds — it is wired and committed but inert until a macOS host (Mac mini, MacStadium, MacinCloud, etc.) and the corresponding Apple Developer secrets land in Secret Manager.

There is no staging environment and no production environment in the conventional sense — every push to `main` produces an immutable, content-addressable artifact set under `gs://relayone-488319-public/relaygate-desktop/{COMMIT_SHA}/` and a mutable `latest/` mirror that downstream download URLs point at.

## Prerequisites

The following must exist before a fresh deployment will succeed end to end. Substitute project names and bucket names appropriately if forking this repo.

- **GCP project**: `relayone-488319` (or fork-equivalent). The Cloud Build API must be enabled on the project (`gcloud services enable cloudbuild.googleapis.com`).
- **Cloud Build trigger** named `relaygate-desktop-main` (or equivalent), source = GitHub `RelayOne/relaygate-desktop`, event = push to branch `main`, build config = `cloudbuild.yaml`. The trigger was wired in commit `e1b12fa` (closeout commit).
- **GCS bucket**: `gs://relayone-488319-public/` exists and is configured with public-read on the `relaygate-desktop/latest/*` and `relaygate-desktop/{sha}/*` prefixes (uniform bucket-level access plus an `allUsers:objectViewer` IAM binding scoped to that path is the recommended pattern; alternatively per-object ACLs).
- **Service account** attached to the Cloud Build trigger has `roles/storage.objectAdmin` on the bucket so it can write the `{sha}/`, `latest/`, and `build-{BUILD_ID}/` paths.
- **GitHub repo connection**: the trigger's GitHub source binding must be authorized via the Cloud Build GitHub App (one-time setup per project).
- **Mac signed-DMG path only**: a macOS host reachable over SSH on the public internet (or via a bastion), plus Secret Manager entries listed in the "Mac signed/notarized DMG (future state)" section below. Without these, `cloudbuild-mac.yaml` exits 0 with a "skipping" log line — it is intentionally a no-op until provisioned.
- **Local-build prerequisites**: Node 20.18.1 (per `.nvmrc`), `nvm` or equivalent, and a working `npm ci` against the committed lockfile. Linux developers cross-compiling Windows installers locally additionally need `wine` and `mono` installed; macOS developers building DMGs additionally need Xcode Command Line Tools.

## Environment Variables / Substitutions

Cloud Build substitutions used by the two pipelines, sourced either from Cloud Build builtins or from `--substitutions` flags on a manual run:

| Variable | Source | Purpose |
|---|---|---|
| `$COMMIT_SHA` | Cloud Build builtin | Embedded into the packaged app via `electron-builder --config.extraMetadata.commit=$COMMIT_SHA` and surfaced at runtime through the preload bridge. Anchors the artifact set to the exact source commit that produced it. |
| `$SHORT_SHA` | Cloud Build builtin | First seven characters of `$COMMIT_SHA`. Used as the per-build GCS prefix: `gs://relayone-488319-public/relaygate-desktop/$SHORT_SHA/`. |
| `$BUILD_ID` | Cloud Build builtin | UUID of the Cloud Build run. Used for the auxiliary archive path: `gs://relayone-488319-public/relaygate-desktop/build-$BUILD_ID/` (declared under `artifacts.objects.location` in `cloudbuild.yaml`). |
| `$PROJECT_ID` | Cloud Build builtin | Used by the macOS pipeline to fetch the `relaygate-desktop-mac-deploy-key` SSH key from Secret Manager via `gcloud secrets versions access latest --project=$PROJECT_ID`. |
| `$_MAC_RUNNER_HOST` | `--substitutions` flag (mac pipeline only) | Hostname or IP address of the macOS host that the SSH-tunneled build connects to. Empty by default; when empty, the pipeline short-circuits with a "skipping" message. |
| `$_MAC_RUNNER_USER` | `--substitutions` flag (mac pipeline only); default `cloudbuild` | SSH username on the macOS host. The runner user must own a Node 20.x toolchain, Xcode Command Line Tools, and write access to `/tmp/relaygate-desktop-build`. |

No application-side environment variables are baked into the build. `RELAYGATE_DESKTOP_URL` (which lets a developer point the desktop app at a non-production dashboard URL such as `http://localhost:3000` or a staging origin) is read at runtime by `src/main.ts` and is not part of the build pipeline. There is no `.env` file anywhere in the build path.

## Build (CI)

The trigger fires automatically on every push to `main`. To kick off a build manually (e.g., to retry a failed run on the same commit):

```bash
gcloud builds triggers run relaygate-desktop-main \
  --branch=main --project=relayone-488319
```

Pipeline steps in `cloudbuild.yaml`, in execution order (each step's `waitFor` is a strict barrier — the pipeline is fully serial because each step consumes the previous step's `release/` directory):

1. **install** (`node:20`) — runs `npm ci` against the committed `package-lock.json`. Strict-versioned reproducible install. No `npm install`, no `--no-optional`, no fast-path. This populates `node_modules/` for every subsequent step in the same `/workspace` volume.
2. **typecheck** (`node:20`, waits on `install`) — runs `npm run typecheck`, which is `tsc --noEmit -p tsconfig.json`. Fails the build on any TypeScript error before we waste cycles on the heavy electron-builder step.
3. **build-main** (`node:20`, waits on `typecheck`) — runs `npm run build`, which is `tsc -p tsconfig.json`. Compiles `src/main.ts` and `src/preload.ts` to `dist/main.js` and `dist/preload.js`. This is the canonical compiled output that electron-builder packages.
4. **dist-all-platforms** (`electronuserland/builder:wine-mono`, waits on `build-main`) — runs `npx electron-builder --linux --win --mac --x64 --arm64 --config.extraMetadata.commit=$COMMIT_SHA --publish never`. The `electronuserland/builder:wine-mono` image ships Wine + Mono so Windows installers can be cross-compiled from Linux. macOS targets are produced as `.zip` only at this step (the shared `electron-builder.yml` ships zip-only for mac because DMG creation requires `hdiutil`, which is macOS-only). The `--publish never` flag disables electron-builder's built-in GitHub/S3 publish — we publish manually in step 6.
5. **build-mac-dmg** (`ubuntu:22.04`, waits on `dist-all-platforms`) — clones the Mozilla fork of `libdmg-hfsplus`, builds the userspace `dmg` (UDIF writer) and `hfsplus` (HFS+ writer that does NOT require the kernel `hfsplus` module — Cloud Build containers don't have it loaded) binaries, then for each `RelayGate-0.1.0-{x64,arm64}-mac.zip`: unzip → compute target image size as `3 * app_size_mb + 200MB` buffer (Electron Framework allocations need the headroom, hence the size bump in commit `28a637e`) → `dd` a raw image → `mkfs.hfsplus -v "RelayGate"` → `hfsplus <img> addall <app_dir>` (userspace, no kernel mount required) → `dmg dmg <img> <out>` to convert to UDIF format. Produces `release/RelayGate-0.1.0-x64.dmg` and `release/RelayGate-0.1.0-arm64.dmg`. Note the Mozilla fork's CLI takes a subcommand (`dmg dmg <iso> <out>`) per commit `853f194`.
6. **publish** (`gcr.io/google.com/cloudsdktool/cloud-sdk:slim`, waits on `build-mac-dmg`) — for each artifact in `release/{*.AppImage,*.deb,*.exe,*-mac.zip,*.dmg}`: `gcloud storage cp` to BOTH `gs://relayone-488319-public/relaygate-desktop/$SHORT_SHA/<basename>` (immutable, content-addressable) AND `gs://relayone-488319-public/relaygate-desktop/latest/<basename>` (mutable, always-points-at-most-recent). Computes `sha256sum` and appends to `release/SHA256SUMS.txt`, then publishes that file to both prefixes as well. The step asserts `published >= 7` (linux x4, mac.zip x2, mac.dmg x2, win x1+ — exits 1 if fewer artifacts than expected, which guards against silent regressions in earlier steps).

The `cloudbuild.yaml` `artifacts.objects.location` clause additionally archives every artifact plus `SHA256SUMS.txt` to `gs://relayone-488319-public/relaygate-desktop/build-$BUILD_ID/` for forensic retention even if `latest/` and `{sha}/` are later overwritten or rolled back.

## Build (local)

A developer can reproduce most of the CI pipeline locally on a Linux box, modulo the macOS DMG signing path which requires a real Mac.

```bash
nvm use                         # node 20.18.1 per .nvmrc
npm ci
npm run typecheck               # tsc --noEmit
npm run build                   # tsc -> dist/
npm run dist:linux              # produces release/RelayGate-*.AppImage and *.deb (x64 + arm64)
npm run dist:win                # cross-compile Windows nsis via Wine (slower; needs wine installed)
npm run dist:mac                # macOS host ONLY — uses electron-builder.mac.yml for DMG target
```

Each `dist:*` script chains `npm run build` first, so it is self-contained. Output lands in `release/`. The shared `electron-builder.yml` controls Linux + Windows + mac.zip targets; `electron-builder.mac.yml` extends it to add the DMG target and is selected by `npm run dist:mac` via `--config electron-builder.mac.yml`. To produce signed and notarized DMGs locally, export `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` before invoking `npm run dist:mac`. See `docs/MAC_BUILD.md` for the full local signing recipe.

To upload a locally produced artifact to the public bucket (e.g., to test the published-URL flow without waiting for CI), use `gcloud storage cp release/<artifact> gs://relayone-488319-public/relaygate-desktop/$(git rev-parse --short HEAD)/<artifact>` and optionally also to the `latest/` mirror. This is the manual escape hatch for ad-hoc Mac DMG uploads while the CI pipeline ships only unsigned DMGs.

## Mac signed/notarized DMG (future state)

`cloudbuild-mac.yaml` is the scaffold for a signed-and-notarized macOS DMG pipeline. It is committed but currently a no-op until the following are provisioned:

- **Provision a macOS host**. Options in increasing order of convenience and cost: a Mac mini in the office on a residential ISP (cheapest at scale, ~$0/mo marginal); MacStadium dedicated Mac mini ($79+/mo); MacinCloud shared ($30+/mo) or dedicated ($130+/mo). GitHub Actions free macOS runners are explicitly off-limits per org policy ("no GitHub CI, ever"; all builds run through Cloud Build).
- **Generate and store the SSH deploy key**. Generate an ed25519 key pair, install the public key under `~cloudbuild/.ssh/authorized_keys` on the mac host, and store the private key in Secret Manager: `gcloud secrets create relaygate-desktop-mac-deploy-key --data-file=mac-deploy-key`.
- **Configure the mac host**. Install `git`, `node@20` (Homebrew or `n`), and `xcode-select --install`. Configure `~/.zshenv` for the `cloudbuild` user with `PATH` entries for `node`, `npm`, and Xcode CLT binaries so non-interactive SSH sessions resolve the toolchain.
- **Apple Developer secrets in Secret Manager**: `apple-developer-id-cert` (base64 of `.p12`), `apple-developer-id-cert-pass` (`.p12` password), `apple-id-email`, `apple-app-specific-password` (generated at `appleid.apple.com`), and `apple-team-id` (10-character team ID).
- **Add a second Cloud Build trigger** (e.g., `relaygate-desktop-mac-binaries`) pointed at `cloudbuild-mac.yaml`, with `_MAC_RUNNER_HOST=<host or IP>` provided via the trigger's substitutions. The default `_MAC_RUNNER_USER` is `cloudbuild`.

When all five are in place, every push to `main` triggers BOTH pipelines in parallel: the Linux pipeline produces the unsigned cross-compile set as today, and the mac pipeline SSHes to the macOS host, clones the repo at `$COMMIT_SHA`, runs `npm ci && npm run typecheck && npm run build && npm run dist:mac` (which uses `electron-builder.mac.yml` with `hardenedRuntime: true` and picks up `CSC_LINK`/`CSC_KEY_PASSWORD` from the host's environment), then `scp`s the signed `.dmg` files back to the Cloud Build workspace and publishes them to GCS — overwriting the unsigned DMGs from the Linux pipeline. Until the mac host exists, the trigger no-ops with `_MAC_RUNNER_HOST` empty (the pipeline checks for empty and exits 0 with a "skipping" message).

## Infrastructure

- **GCS bucket**: `gs://relayone-488319-public/relaygate-desktop/` with public-read on `latest/*` and `{sha}/*` paths. No CDN in front — direct GCS download. GCS multi-regional / dual-regional class is fine for the scale here; single-region is also fine. No object lifecycle rules in place today; old `{sha}/` prefixes accumulate indefinitely. (Adding a 90-day lifecycle rule is a sensible Horizon item.)
- **Cloud Build worker**: `E2_HIGHCPU_8` machine type, 1800-second timeout. Logs to `CLOUD_LOGGING_ONLY` (no GCS log spill).
- **Mac pipeline worker**: `E2_MEDIUM` (the SSH-driver job is light; the heavy lifting happens on the remote mac host).
- **No databases, no Cloud Run services, no Cloud Functions, no DNS records, no load balancers** are owned by this repo. The desktop app is a pure client; all backend infrastructure lives in `relaygate-app` and `relaygate` (the gateway).
- **Workspace volume**: each Cloud Build run mounts `/workspace` as a shared volume across steps. `node_modules/`, `dist/`, and `release/` all persist between steps within a run. The volume is destroyed at the end of the run.
- **Container images** pinned by tag, not digest: `node:20`, `electronuserland/builder:wine-mono`, `ubuntu:22.04`, `gcr.io/google.com/cloudsdktool/cloud-sdk:slim`. Pinning to digests would harden against upstream-image drift but slows the periodic image-refresh cadence; tag-pinning is the chosen tradeoff for now.

## Monitoring & Health

- **Cloud Build console**: `https://console.cloud.google.com/cloud-build/builds?project=relayone-488319`. Filter by trigger name to see only desktop builds. Build duration is typically 10–14 minutes end to end (the wine-mono cross-compile step dominates).
- **Verify a fresh build landed**: `gcloud storage ls gs://relayone-488319-public/relaygate-desktop/latest/` should list nine-plus artifacts plus `SHA256SUMS.txt`. Compare the timestamps against the Cloud Build run completion time.
- **Smoke-test the published binary**: download the platform installer matching your dev machine from `https://storage.googleapis.com/relayone-488319-public/relaygate-desktop/latest/<filename>` and launch it. Should open to the dashboard within ~1 second. (Automating this as a post-publish CI job is tracked in FEATURE-MAP under Horizon.)
- **SHA256SUMS verification**: download a binary plus `SHA256SUMS.txt` from the same `{sha}/` prefix (NOT `latest/` — `latest/` may be a different build than the binary's original `{sha}/`), then run `sha256sum -c SHA256SUMS.txt --ignore-missing` in the directory containing the downloaded binary. A mismatch means the artifact has been tampered with or the upload truncated.
- **Build-status alerts**: not configured today. Cloud Build can publish failure events to Pub/Sub which a Cloud Function can fan out to Slack — wiring this is a Horizon item.
- **Artifact integrity audit**: to verify no historical `{sha}/` prefix has been silently mutated, fetch its `SHA256SUMS.txt`, recompute hashes against re-downloaded binaries, and diff. Mismatches indicate either tampering or an incomplete prior upload — both warrant immediate investigation.
- **Build duration baseline**: a clean run completes in roughly 10–14 minutes on `E2_HIGHCPU_8`. Sustained drift above 20 minutes typically signals npm registry slowness, Wine cross-compile regressions, or a `libdmg-hfsplus` build path change. Open the Cloud Build run, expand each step's timing, and compare to the previous successful run to triage.

## Rollback Procedure

Every successful build overwrites the `latest/` mirror, so rollback is "republish a known-good `{sha}/` prefix to `latest/`." The full procedure:

```bash
KNOWN_GOOD_SHA=abc1234   # short SHA of the last known-good build
for blob in $(gsutil ls gs://relayone-488319-public/relaygate-desktop/$KNOWN_GOOD_SHA/); do
  base=$(basename "$blob")
  gsutil cp "$blob" "gs://relayone-488319-public/relaygate-desktop/latest/$base"
done
```

After the loop completes, every file under `latest/` (binaries plus `SHA256SUMS.txt`) is byte-identical to the known-good build's `{sha}/` prefix. New downloads from any documented `latest/<filename>` URL serve the rolled-back version. Verify with `gsutil ls -L gs://relayone-488319-public/relaygate-desktop/latest/` — generation timestamps should match the new copies.

Users who already installed the bad version will not auto-roll-back — they need to redownload from the same URL and reinstall manually. When auto-update via `electron-updater` ships (currently Horizon in FEATURE-MAP), the rollback story becomes "publish a previous-release update channel and the desktop app fetches it on next launch," which is the Right Thing but is not yet implemented.

If the bad build was bad enough that it should never be served again, also delete the offending `{sha}/` prefix: `gsutil -m rm -r gs://relayone-488319-public/relaygate-desktop/<bad_sha>/`. This makes the rollback durable against accidental future re-promotion.

To produce a fresh forward-rolled build (rather than reverting), revert the offending commit on `main` (`git revert <bad_sha> && git push origin main`); the trigger fires automatically and the new `latest/` mirror reflects the revert within ~12 minutes. Prefer forward rollback over destructive rollback whenever the bad change is small enough to revert cleanly — it keeps the audit trail intact.

A common dry run before any rollback is to compare what `latest/` currently advertises against the desired known-good prefix: `diff <(gsutil ls gs://relayone-488319-public/relaygate-desktop/latest/) <(gsutil ls gs://relayone-488319-public/relaygate-desktop/$KNOWN_GOOD_SHA/)`. The two listings should differ only in path prefix; any extra or missing files between them is a flag to investigate before promoting.

---
*Last updated: 2026-05-04*
