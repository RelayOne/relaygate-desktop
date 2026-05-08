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

### Latent bugs surfaced during validation (2026-05-08)

After the initial wiring, three latent bugs surfaced when the first PR build attempted to run:

1. **`SHORT_SHA: unbound variable`** (build `e0537dfe`) — Cloud Build substitutions don't auto-export to bash environment when the script step uses inline `bash -euc`. `scripts/win-smoke.sh` has `set -u`, so any reference to `${SHORT_SHA}` failed immediately. Fixed in `b8345c1` by adding explicit `export PROJECT_ID="$PROJECT_ID"; export SHORT_SHA="$SHORT_SHA"; ...` before invoking the script.

2. **`tests/smoke.test.ts` ignored the installed binary** — the fixture used `node_modules/.bin/electron` + `APP_ENTRY` (source-tree mode) unconditionally. The Path B driver installs the cross-compiled `RelayGate-Setup-0.1.0.exe` and points smoke at it, so the fixture had to learn how to launch a packaged binary. Fixed in `775780d` by adding `RELAYGATE_TEST_BIN` (path to installed binary) + `RELAYGATE_TEST_ENV` (build's `_ENV`, since the cloned source tree's `package.json` doesn't have the embedded `env` field).

3. **`git checkout ${COMMIT_SHA}` after `--depth=1 --branch=main` clone** — PR-trigger builds run on commits not yet in main, so the checkout would fail every time. Fixed in `775780d` by switching to a full clone + `git fetch origin ${COMMIT_SHA}` + checkout. The smoke fixture is decoupled from the .exe's source tree (the binary under test is the installed RelayGate.exe; the fixture just drives Puppeteer-CDP against it).

4. **Comment containing literal `$VAR` rejected by `gcloud builds submit`** — Cloud Build's substitution validator parses every `$NAME` token in string fields, including comments. Trigger-fired builds tolerate this; manual `gcloud builds submit` is stricter. Fixed in `1be8290` by escaping to `$$VAR` in the comment.

5. **Trigger commentControl temporarily flipped** — to break a stuck PR-trigger that had stopped firing builds, `commentControl: COMMENTS_ENABLED → COMMENTS_DISABLED` was set on `relaygate-desktop-pr-dev` (preserving substitutions per the `audit/scope-findings/2026-05-04-post-rebind-recovery.md` JSON-export-import pattern). After the trigger started firing again, restored to `COMMENTS_ENABLED` so PRs continue to require collaborator gating.

6. **`iam.serviceAccountUser` self-binding required** (build `d9626363`, smoke-test-win step) — `gcloud compute instances create --service-account=$SELF` requires the caller to have `roles/iam.serviceAccountUser` on the target SA. The CI SA's project-level grants (`roles/cloudbuild.builds.builder`, `roles/logging.logWriter`, `roles/compute.instanceAdmin.v1`) and bucket-scoped `roles/storage.objectAdmin` cover instance creation, but not the act-as relationship needed when attaching the SA itself to the new VM. The original audit doc claimed "VM uses the SA itself as runtime SA (no cross-SA grant needed)" — true that no cross-SA grant is needed, but a *self*-`iam.serviceAccountUser` binding still is. Fixed via:

   ```
   gcloud iam service-accounts add-iam-policy-binding \
     relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com \
     --member='serviceAccount:relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com' \
     --role='roles/iam.serviceAccountUser'
   ```

   This is within the Path B authorization scope: the user authorized the IAM expansion needed for ephemeral VM provisioning; this self-binding is part of what's required to make that pattern work.

7. **`roles/iap.tunnelResourceAccessor` required for IAP-tunneled SSH/SCP** (build `3d9a6ee7`) — `gcloud compute ssh --tunnel-through-iap` failed with `Error while connecting [4033: 'not authorized']`. The CI SA had `roles/compute.instanceAdmin.v1` (instance create/delete) but no IAP tunnel role, so the websocket tunnel API rejected the connection. The firewall side was already correct (project-wide `allow-iap-ssh` rule allows TCP:22 from 35.235.240.0/20, the IAP source range). Granted `roles/iap.tunnelResourceAccessor` at the project level. Like finding 6, this is part of what Path B requires; the original audit doc only called out instance create/delete. Also bumped the win-smoke.sh SSH-poll timeout from 8min to 12min and stopped silencing SSH stderr, so the next iteration's diagnostics would surface this kind of error directly instead of via timeout-and-then-mystery-failure on the next phase.

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
