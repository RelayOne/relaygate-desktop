# Windows smoke step — BLOCKED on infra decision (2026-05-05)

## What was attempted

Spec `specs/cross-platform-smoke.md` TASK-1 instructs to provision a Cloud Build Windows worker pool in `relayone-488319/us-central1` for running the Puppeteer-CDP smoke against the cross-compiled `RelayGate-Setup-0.1.0.exe` artifact in CI.

## Verification

`gcloud builds worker-pools create --help` shows no `--worker-image-type` flag and no Windows machine type. Attempting create with Windows-flavored `--worker-machine-type` returns no recognized flag. Confirmed: **Cloud Build private pools are Linux-only as of 2026-05-05.**

## Path B (per spec): ephemeral GCE Windows VM driven from a Linux Cloud Build step

Real infra implications:

1. **IAM scope expansion** — the `relaygate-desktop-ci@` SA was scoped down in the 2026-05-04 audit (commits `2ebbdba`, `a1fa74f`) to ONLY:
   - `roles/cloudbuild.builds.builder` (project)
   - `roles/logging.logWriter` (project)
   - `roles/storage.objectAdmin` on `gs://relayone-488319-public` (bucket)
   - `roles/iam.serviceAccountTokenCreator` + `roles/iam.serviceAccountUser` (self)

   Path B requires adding `roles/compute.instanceAdmin.v1` (or finer-grained `compute.instances.create/delete/start/stop` + `compute.disks.create/delete` + `compute.networks.use` + `compute.subnetworks.use`) to enable ephemeral VM provisioning. This is a material expansion of the CI SA's blast radius.

2. **Network firewall** — the Windows VM must accept inbound SSH from Cloud Build's worker IP range (or a private VPC peering); firewall rules must be created and maintained.

3. **Cost per build** — ephemeral Windows VM at `e2-standard-4`: ~$0.13/hour; a 10-min smoke per build adds ~$0.022 per build at 5 builds/day = ~$3/month. Trivial compared to the IAM expansion concern.

4. **Maintenance** — Windows Server image must be patched periodically; the smoke fixture must keep working across Windows Server LTS versions.

## Status

STATUS: RESOLVED (2026-05-05) — user authorized Path B. `roles/compute.instanceAdmin.v1` granted to `relaygate-desktop-ci@` (audit-trail commit `a6f835a`); `scripts/win-smoke.sh` + `smoke-test-win` step wired into `cloudbuild.yaml`'s `publish.waitFor` (commits `f47a262` + `719235e`).

The IAM expansion is the documented trade-off: the CI SA can now create/delete GCE instances within the project. Mitigations:
- VM uses the SA itself as runtime SA (no cross-SA grant needed)
- Trap-EXIT cleanup deletes the VM regardless of smoke pass/fail (no orphaned cost-accumulating instances)
- IAP-tunneled SSH eliminates need for public-IP firewall management

### Original status (kept for history)

STATUS: BLOCKED — reason: Path B requires IAM scope expansion that contradicts the just-completed SA scope-down audit. Decision needs user authorization before proceeding.

## What this PR does ship

- `cloudbuild-win.yaml` — inert stub matching the existing `cloudbuild-mac.yaml` pattern. Wired but no-ops with `_WIN_RUNNER_HOST` empty (the `--substitutions` flag is set by a future trigger when the Windows runner is provisioned).
- `cloudbuild-mac.yaml` — extended with a `smoke-test-mac` step that inherits the same inert-until-host pattern from the existing DMG signing path.
- `docs/DEPLOYMENT.md` — documents both inert stubs.

## What this PR does NOT ship (BLOCKED on user decision)

- Windows worker provisioning (whether that's a GCE template, an external Windows runner host, or some other path).
- Wiring the smoke-test-win step into the main `cloudbuild.yaml` `publish` `waitFor` chain (would gate publish on a step that always succeeds via no-op until runner is real, which would silently turn it into a perma-pass).

## Decision the user needs to make

Pick ONE:
1. **Authorize Path B** — expand `relaygate-desktop-ci@` SA with `roles/compute.instanceAdmin.v1` and provision a GCE Windows Server VM template. ~1 day of additional work after authorization.
2. **External Windows runner** — provision a Windows machine externally (cheap option: a NUC at the office; managed: a cloud Windows VM owned manually) reachable over SSH. Same SSH-tunneled pattern as `cloudbuild-mac.yaml` waits on. ~Same effort as #1 but no IAM expansion.
3. **Defer indefinitely** — accept that Windows smoke is shipped behind a permanent inert stub and revisit when scale of Windows-only regressions justifies it.
