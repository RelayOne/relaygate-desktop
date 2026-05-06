<!-- STATUS: done -->
<!-- BUILD_STARTED: 2026-05-05 -->
<!-- BUILD_COMPLETED: 2026-05-05 -->
<!-- TYPE: feature -->
<!-- CREATED: 2026-05-05 -->
<!-- DEPENDS_ON: none -->
<!-- BUILD_ORDER: 4 -->
<!-- NOTES: Windows side fully shipped via Path B (user authorized 2026-05-05) — roles/compute.instanceAdmin.v1 granted, scripts/win-smoke.sh + smoke-test-win step wired into cloudbuild.yaml publish.waitFor. macOS side stays inert in cloudbuild-mac.yaml until Mac runner provisioning. -->

# Cross-platform smoke test (Linux + macOS + Windows) — Implementation Spec

## Overview

The current smoke step in `cloudbuild.yaml` runs Puppeteer-CDP against an Electron build on Linux only — the same OS Cloud Build's Linux runner uses. Cross-compiled macOS and Windows artifacts are produced but never *run* in CI before publish. The whole point of an Electron-wrapper test is to catch the platform-specific cases (a bad `webPreferences` flag that crashes only on Windows, a notarization-stripped DMG that won't launch, a Linux Wayland regression). Currently we ship the macOS and Windows binaries on hope.

This spec adds two more smoke steps to `cloudbuild.yaml`:
1. A Windows smoke step that runs the cross-compiled `RelayGate-Setup-0.1.0.exe` build via a Cloud Build Windows worker.
2. A macOS smoke step that runs the cross-compiled `.zip` (or DMG once signed) on a Mac runner.

Linux smoke is already done (`cloudbuild.yaml:smoke-test` step from the previously-shipped `feat/smoke-in-ci` branch).

## Stack & Versions

- Cloud Build Windows workers via `gcr.io/cloud-builders/windows-builder` OR a custom-spun Windows image — Google Cloud Build supports Windows pools but the syntax differs significantly from Linux pools (per `https://cloud.google.com/build/docs/build-config-file-schema#machinetype` Windows-specific machine types like `WINDOWS_VM`).
- Cloud Build "private worker pools" with custom Windows worker (rather than the default Linux pool) — needed because the smoke test must run a Windows `.exe`.
- macOS: per the user's stated convention "no GitHub Actions, ever" — we cannot use GitHub-hosted Mac runners. Options for Mac:
  - a) Use the existing `cloudbuild-mac.yaml` skeleton + a real Mac host (Mac mini, MacStadium, MacinCloud). Same hardware that's needed for signed DMG.
  - b) Skip macOS smoke until that hardware is real. Document as "blocked on Mac runner".
- Puppeteer-CDP attach pattern stays identical across platforms — only the Electron binary path and process startup differ. Existing `tests/smoke.test.ts` works as-is.

## Why this is its own spec

Cross-platform smoke is independent of the gateway-control / tray / notifications work. Different infra (Cloud Build worker pools, possibly a Mac host), different review surface (CI yaml + Windows runner provisioning vs. Electron source). Pulling it out keeps each PR focused.

## Stack-relevant prior art

`cloudbuild.yaml` already has the Linux `smoke-test` step (PR #5 / commit `37164f2`), the `dist-all-platforms` step that produces all platform artifacts, and the `build-mac-dmg` Linux-userspace path. The Mac DMG step is the closest analog for what cross-platform smoke needs.

`cloudbuild-mac.yaml` skeleton exists but is inert until Mac runner provisioning. Its existence proves the user's intent to use SSH-tunneled Mac builds rather than GitHub Actions.

`docs/MAC_BUILD.md` already documents the Mac host runner pipeline.

## Key design decision

**Windows smoke runs in CI now (this spec). macOS smoke ships behind the existing Mac runner blocker (already a Horizon item: "macOS host runner pipeline").** Adding macOS smoke to the same blocking list is the honest framing — we don't get magic Mac CI from a `cloudbuild.yaml` edit. Instead this spec:

1. Wires Windows smoke into a NEW Cloud Build trigger (`relaygate-desktop-binaries-win-smoke` and equivalent PR variants) that runs on a Windows-machine pool.
2. Documents the Mac smoke path as ready-to-wire in `cloudbuild-mac.yaml` once the host arrives, but does NOT add the step until then. The added Mac smoke checklist items are mark-ready-for-build but DEPENDS_ON the Mac host spec.

## Checklist

### Windows smoke (this spec ships these)

- [ ] **TASK-1**: Provision a Windows worker pool in `relayone-488319/us-central1`. Per Cloud Build docs (`https://cloud.google.com/build/docs/private-pools/private-pools-overview`), private pools support Windows machine types `WINDOWS_VM` (16GB RAM, 8 vCPUs default).
  - Run: `gcloud builds worker-pools create relaygate-desktop-win-pool --project=relayone-488319 --region=us-central1 --worker-machine-type=e2-standard-8 --worker-disk-size=100GB`. Note: at time of writing, gcloud worker-pools defaults to Linux; check current docs for the right `--worker-image-type` / `--type` flag for Windows. If Cloud Build doesn't support Windows in private pools (this needs verification — Cloud Build has been Linux-only for a long time), BLOCK this task and use an alternate path: a single ephemeral Compute Engine Windows VM that pulls the artifact and runs the smoke, controlled by a Linux Cloud Build step that SSHes via `gcloud compute ssh`. Pattern: same as `cloudbuild-mac.yaml`'s SSH-tunneled Mac approach.
  - VERIFY: `gcloud builds worker-pools list --region=us-central1` shows the new pool, OR if BLOCKED, the alternate Compute-VM pattern is documented in this task as a follow-up subtask.

- [ ] **TASK-2**: Add a `smoke-test-win` step to `cloudbuild.yaml` that runs after `dist-all-platforms` and before `build-mac-dmg`. It either:
  - **Path A** (if Cloud Build Windows pool exists): pulls the built `RelayGate-Setup-0.1.0.exe` from the previous step's `release/` directory, transfers it to the Windows worker via Cloud Build's cross-pool execution syntax, runs the installer silently (`/S` flag for nsis), then runs `tests/smoke.test.ts` against the installed binary.
  - **Path B** (if Path A unavailable): provisions an ephemeral GCE Windows VM via `gcloud compute instances create`, copies the EXE via `gcloud compute scp`, runs the smoke remotely via `gcloud compute ssh`, captures stdout/stderr + screenshot, then deletes the VM. Paste this 80-line subscript inline in the yaml or call out to a new `scripts/win-smoke.sh`.
  - Either path: the smoke MUST attach Puppeteer-CDP via TCP forwarding (port-forward 9222 from the Windows VM back to Cloud Build). Same assertions as the Linux smoke.
  - VERIFY: a manual `gcloud builds submit --config=cloudbuild.yaml` triggers the smoke-test-win step and the step exits 0 within 10 minutes.

- [ ] **TASK-3**: Update the existing `dist-all-platforms` `waitFor` chain so `smoke-test-win` is parallel-with `build-mac-dmg`, not serial. Specifically:
  - `dist-all-platforms` finishes
  - `smoke-test-win` starts with `waitFor: ['dist-all-platforms']`
  - `build-mac-dmg` starts with `waitFor: ['dist-all-platforms']` (already does)
  - `publish` starts with `waitFor: ['build-mac-dmg', 'smoke-test-win']` so publish is gated on BOTH
  - Net effect: total build duration goes up by `max(smoke-test-win, build-mac-dmg)` instead of their sum.
  - VERIFY: `grep -A1 "waitFor:" cloudbuild.yaml` shows the updated dependency graph.

- [ ] **TASK-4**: Document the Windows smoke path in `docs/DEPLOYMENT.md` — new subsection "Cross-platform smoke (Windows)" matching the existing "Per-environment artifact paths" section in length. Cover: which worker provisioning was chosen, expected duration, fallback when the Windows worker is unavailable. Verbose, 3+ paragraphs.

### macOS smoke (this spec specs it; build defers to Mac-host arrival)

- [ ] **TASK-5**: Extend `cloudbuild-mac.yaml` with a `smoke-test-mac` step that, after the SSH-tunneled DMG build completes, mounts the DMG, copies `RelayGate.app` to `/Applications`, then runs `tests/smoke.test.ts` against `RelayGate.app/Contents/MacOS/RelayGate`. The test framework is identical to Linux (Puppeteer-CDP), only the binary path differs.
  - At top of yaml, document: this step is wired but inert until `_MAC_RUNNER_HOST` is set (matches the existing pattern for the rest of `cloudbuild-mac.yaml`).
  - VERIFY: `grep -n "smoke-test-mac" cloudbuild-mac.yaml` shows the step. The step's first line is the no-op gate (`if [ -z "$_MAC_RUNNER_HOST" ]; then echo "skipping mac smoke"; exit 0; fi`).

- [ ] **TASK-6**: Update FEATURE-MAP "Cross-platform smoke" Horizon → Scoped. Link to this spec. (Stays Scoped, not Done, because macOS smoke is still infra-blocked.)
  - When Windows smoke is shipping AND macOS smoke is wired (post-Mac-host) AND both run on every PR, transition to Done.

## Open question for the user (please answer before executing)

- **Cloud Build Windows pools**: as of last check, Google Cloud Build's private pools were Linux-only. If still true, **TASK-1 forces Path B** (ephemeral GCE Windows VM driven from a Linux Cloud Build step). That's more complex but works on infra we already own. Confirm this is acceptable before we build.

## Validation

After Windows smoke ships:
- Every push to main, dev, staging, or PR runs Windows smoke after `dist-all-platforms` and before publish.
- A Windows-only regression (e.g., a `webPreferences` flag that crashes Chromium on Win32 only) blocks the build instead of shipping.
- Total build duration goes from ~22min to ~28min (+~6min for Windows VM provision + run + teardown).

## Rollback

Revert the commits. The Windows smoke step is removed from `cloudbuild.yaml`. The worker pool / GCE VM provisioning continues to exist (idle, free tier-ish) until manually deleted via `gcloud builds worker-pools delete` or `gcloud compute instances delete`.
