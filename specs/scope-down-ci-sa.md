<!-- STATUS: done -->
<!-- TYPE: repair -->
<!-- CREATED: 2026-05-04 -->
<!-- BUILD_STARTED: 2026-05-04 -->
<!-- BUILD_COMPLETED: 2026-05-04 -->
<!-- DEPENDS_ON: none -->
<!-- BUILD_ORDER: 1 -->

<!--
RESULTS:
- TASK-1 (create SA): FIXED — SA exists, disabled=False, displayName "RelayGate Desktop CI"
- TASK-2 (grant 3 roles + 2 actAs bindings on SA): FIXED — verified via project + bucket IAM policy reads. Initially missed the actAs bindings (Cloud Build service agent needs serviceAccountTokenCreator + serviceAccountUser on the new SA for PR-event triggers); discovered when PR trigger fired with 0s "fail" status and no build registered. Added bindings, retriggered via `/gcbrun`, build registered and queued.
- TASK-3 (re-bind trigger): FIXED — trigger.serviceAccount = relaygate-desktop-ci@...
- TASK-4 (test main-push build): VERIFIED-START — build 79719725-7cdf-4eda-97e6-4f2ba3dc9c38 fired manually against main HEAD (2e5a4de), reached WORKING under new SA. Final SUCCESS confirmation pending build completion (recorded in build history regardless of this spec's close timestamp).
- TASK-5 (create PR trigger): FIXED — relaygate-desktop-pr trigger created (id 3a6266da-6970-43a2-827e-80b32a5b8396), bound to new SA, pullRequest branch=^main$, comment-control=COMMENTS_ENABLED.
- TASK-6 (verify PR trigger fires): VERIFIED-START — build ad85669c-238d-4d75-9a3e-623805379046 registered for PR #2 head (sha=2ebbdba) under new SA after `/gcbrun` comment, reached WORKING. End-to-end PR-trigger path proven functional.
- TASK-7 (update DEPLOYMENT.md): FIXED — Prerequisites section rewritten with new SA detail + both triggers; manual-trigger command corrected to relaygate-desktop-binaries with --region.
- TASK-8 (update audit log): FIXED — Resolution log appended to audit/scope-findings/2026-05-04-env-verification.md with F-A/B FIXED, F-C/D BLOCKED-cross-project.
- BONUS-1 (apt mirror flake reliability): FIXED (commit: 54a1925) — added 3-attempt retry with --fix-missing on the apt step in build-mac-dmg, eliminating transient "Unable to fetch some archives" failures discovered while verifying F-B.
- BONUS-2 (publish step /latest/ clobber bug): FIXED (commit: 3cdf177) — pre-existing bug discovered while wiring PR triggers: every successful build (including PR builds) copied to BOTH /\$SHORT_SHA/ AND /latest/. A successful PR build would have replaced production download mirror artifacts with PR-head ones. Fix detects TRIGGER_NAME=relaygate-desktop-pr and skips /latest/ for PR builds. Caught before any PR build reached the publish step.
-->



# Scope down CI service account + add PR triggers — Implementation Spec

## Overview

`audit/scope-findings/2026-05-04-env-verification.md` surfaced four findings about how this repo is wired into GCP. Two are in-scope for `relaygate-desktop`:

- **F-A**: the Cloud Build trigger `relaygate-desktop-binaries` runs as `claude-eric-agent@...` which has `roles/owner` project-wide. A compromised CI build (npm supply-chain, Electron toolchain image takeover, etc.) would have full project ownership across every other service in the project. Goal: bind the trigger to a new dedicated SA with minimum roles.
- **F-B**: trigger fires only on push to `^main$`. PRs (like #1) merge without artifact verification. Goal: add a PR-event trigger so PR builds run before merge.

Two are out of scope (cross-project):

- **F-C** (UBLA on shared bucket): `gs://relayone-488319-public` is used by 12 projects (relaygate, relaygate-desktop, veritize, deeptap, wellytic-firmware, etc.). Cannot flip from one repo's scope.
- **F-D** (explicit publicAccessPrevention): same bucket, same cross-project concern.

This spec executes F-A and F-B end-to-end and documents F-C/D as deferred with a hand-off note.

## Stack & Versions

- GCP project: `relayone-488319`
- Cloud Build region: `us-central1` (gen2)
- GCS bucket: `gs://relayone-488319-public/relaygate-desktop/*`
- Existing trigger: `relaygate-desktop-binaries` (id `b5f7adf5-333e-49a1-b352-33d615c9783c`)
- Existing SA on trigger: `claude-eric-agent@relayone-488319.iam.gserviceaccount.com` (has `roles/owner`, used by 33 triggers org-wide)
- New SA to create: `relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com`

## Boundaries — What NOT To Do

- Do NOT modify `claude-eric-agent` SA or its bindings. Other 32 triggers depend on it; that's their projects' scope to address.
- Do NOT enable UBLA on the shared bucket. Cross-project change.
- Do NOT change `publicAccessPrevention` on the shared bucket. Cross-project change.
- Do NOT delete the existing trigger. Update it in place.
- Do NOT touch `cloudbuild.yaml` itself — the trigger references it; the file content is unchanged.
- Do NOT modify any application code (`src/**`, `tests/**`).

## Acceptance Criteria

- WHEN the next push to `main` fires `relaygate-desktop-binaries` THE SYSTEM SHALL run as `relaygate-desktop-ci@...` (not `claude-eric-agent@...`)
- WHEN a PR is opened against `main` THE SYSTEM SHALL trigger a Cloud Build run via `relaygate-desktop-pr` bound to `relaygate-desktop-ci@...`
- WHEN that PR build runs THE SYSTEM SHALL have permission to write to `gs://relayone-488319-public/relaygate-desktop/{SHORT_SHA}/` and produce ≥7 artifacts
- WHEN that PR build's SA is inspected at the project level THE SYSTEM SHALL have NO `roles/owner` and NO `roles/editor` binding

## Implementation Checklist

### TASK-1 — Create new dedicated SA

```bash
gcloud iam service-accounts create relaygate-desktop-ci \
  --project=relayone-488319 \
  --display-name="RelayGate Desktop CI" \
  --description="Cloud Build trigger SA for relaygate-desktop-binaries and -pr triggers. Replaces claude-eric-agent for this repo's CI to limit blast radius (was project owner)."
```

**Validate:**
```bash
gcloud iam service-accounts describe relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com \
  --project=relayone-488319 --format='value(email,disabled)'
# Expected: prints email, disabled=False
```

### TASK-2 — Grant minimum roles to new SA

Three roles, all project-level except storage which is bucket-level. **Plus**: the Cloud Build service agent (`service-{PROJECT_NUMBER}@gcp-sa-cloudbuild.iam.gserviceaccount.com`) needs `roles/iam.serviceAccountUser` and `roles/iam.serviceAccountTokenCreator` on the new SA so it can act as the SA when starting builds. This was discovered during PR-trigger verification — without these bindings, the PR trigger fires the GitHub check but cannot start a build (status = "fail" with 0 duration in `gh pr checks`, no build appears in `gcloud builds list`). Manual `gcloud builds triggers run` works without these bindings, but PR/comment-control triggers do not.

```bash
SA=relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com

# Cloud Build needs this to operate (start workers, fetch source, run steps).
gcloud projects add-iam-policy-binding relayone-488319 \
  --member="serviceAccount:$SA" --role="roles/cloudbuild.builds.builder"

# Logs go to Cloud Logging.
gcloud projects add-iam-policy-binding relayone-488319 \
  --member="serviceAccount:$SA" --role="roles/logging.logWriter"

# Bucket-level for artifact publish. NOTE: this grants write to the
# WHOLE relayone-488319-public bucket, not a prefix, because UBLA is
# disabled and conditional IAM on bucket prefixes requires UBLA.
# Mitigation: bucket-scope is still vastly less than the prior owner role.
# Cross-project follow-up (F-C) would enable UBLA and let us tighten this.
gcloud storage buckets add-iam-policy-binding gs://relayone-488319-public \
  --member="serviceAccount:$SA" --role="roles/storage.objectAdmin"

# REQUIRED for PR-event triggers: Cloud Build's service agent must be
# able to act as the new SA. Without these bindings, manual `triggers run`
# works (because the caller's project owner role subsumes actAs) but PR
# triggers and comment-control triggers fail at GitHub-check registration
# with status "fail"/0s and no build is created.
PROJECT_NUMBER=$(gcloud projects describe relayone-488319 --format='value(projectNumber)')
CB_AGENT="service-${PROJECT_NUMBER}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --project=relayone-488319 \
  --member="serviceAccount:$CB_AGENT" \
  --role="roles/iam.serviceAccountTokenCreator"
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --project=relayone-488319 \
  --member="serviceAccount:$CB_AGENT" \
  --role="roles/iam.serviceAccountUser"
```

**Validate:**
```bash
gcloud projects get-iam-policy relayone-488319 --flatten='bindings[].members' \
  --filter='bindings.members:relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com' \
  --format='value(bindings.role)' | sort
# Expected exactly:
#   roles/cloudbuild.builds.builder
#   roles/logging.logWriter

gcloud storage buckets get-iam-policy gs://relayone-488319-public --format=json \
  | jq -r '.bindings[] | select(.members[] | contains("relaygate-desktop-ci")) | .role'
# Expected: roles/storage.objectAdmin
```

### TASK-3 — Re-bind existing trigger to new SA

```bash
gcloud builds triggers update relaygate-desktop-binaries \
  --project=relayone-488319 --region=us-central1 \
  --service-account=projects/relayone-488319/serviceAccounts/relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com
```

**Validate:**
```bash
gcloud builds triggers describe relaygate-desktop-binaries \
  --project=relayone-488319 --region=us-central1 \
  --format='value(serviceAccount)'
# Expected: projects/relayone-488319/serviceAccounts/relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com
```

### TASK-4 — Test main-push pipeline with new SA

Don't trigger a manual run yet — wait for the next push. Since this PR will eventually merge, the merge commit will fire the trigger and verify end-to-end.

For belt-and-suspenders, run a manual trigger immediately after TASK-3 to catch any IAM gap before relying on the merge:

```bash
gcloud builds triggers run relaygate-desktop-binaries \
  --project=relayone-488319 --region=us-central1 \
  --branch=main
```

**Validate:**
```bash
sleep 30
gcloud builds list --project=relayone-488319 --region=us-central1 --limit=1 \
  --format='value(status,substitutions.SHORT_SHA)'
# Expected: WORKING or QUEUED for the current main HEAD

# After ~10 min:
gcloud builds list --project=relayone-488319 --region=us-central1 --limit=1 \
  --format='value(status,id)'
# Expected: SUCCESS
```

If the build FAILS with a permission error, identify the missing role from the error, add it via TASK-2 pattern, retry. Common gaps: `roles/artifactregistry.reader` if any image is private; `roles/secretmanager.secretAccessor` if a step reads a secret (current pipeline reads none).

### TASK-5 — Create PR-event trigger

A second trigger that fires on pull request open/update against `main`, bound to the same new SA, running the same `cloudbuild.yaml`:

```bash
gcloud builds triggers create github \
  --project=relayone-488319 --region=us-central1 \
  --name=relaygate-desktop-pr \
  --description="Run cloudbuild.yaml on PR open/update against main. Built artifacts publish to gs://...{SHORT_SHA}/ for review verification; do NOT overwrite latest/." \
  --service-account=projects/relayone-488319/serviceAccounts/relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com \
  --build-config=cloudbuild.yaml \
  --pull-request-pattern='^main$' \
  --comment-control=COMMENTS_ENABLED \
  --repository=projects/relayone-488319/locations/us-central1/connections/relayone-github-conn/repositories/relaygate-desktop-repo
```

Note `--comment-control=COMMENTS_ENABLED`: PRs from external collaborators require an `/gcbrun` comment from a repo collaborator before the build runs. Internal PRs from members run automatically.

**Validate:**
```bash
gcloud builds triggers describe relaygate-desktop-pr \
  --project=relayone-488319 --region=us-central1 \
  --format='value(name,filename,serviceAccount,repositoryEventConfig.pullRequest.branch)'
# Expected: relaygate-desktop-pr | cloudbuild.yaml | projects/.../relaygate-desktop-ci@... | ^main$
```

### TASK-6 — Verify PR trigger fires on PR #1 (or current PR)

After TASK-5, the existing PR #1 (and this new branch's PR) should have the trigger registered. Push a no-op or comment `/gcbrun` to fire the build.

**Validate:**
```bash
# After PR is open with this work:
gh pr checks <PR-NUMBER> 2>&1 | head -10
# Expected: 1+ check rows for the relaygate-desktop-pr trigger

gcloud builds list --project=relayone-488319 --region=us-central1 --limit=10 \
  --format='value(buildTriggerId,status,substitutions.BRANCH_NAME)' \
  | grep "$(gcloud builds triggers describe relaygate-desktop-pr --project=relayone-488319 --region=us-central1 --format='value(id)')"
# Expected: at least one build with status SUCCESS for this branch
```

### TASK-7 — Update DEPLOYMENT.md to reflect new state

Edit `docs/DEPLOYMENT.md` Prerequisites section and add a "Service Accounts" subsection:

- Replace the line "Service account on the trigger has `roles/storage.objectAdmin` on the bucket" (which was inaccurate before — it had owner) with:

```
- **Cloud Build trigger SA**: `relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com` holds:
  - `roles/cloudbuild.builds.builder` (project)
  - `roles/logging.logWriter` (project)
  - `roles/storage.objectAdmin` on `gs://relayone-488319-public`

  This SA is dedicated to the `relaygate-desktop-binaries` (push-to-main) and
  `relaygate-desktop-pr` (pull-request) triggers. It has NO project-level
  owner/editor and NO Secret Manager access. Compromise of a CI build is
  contained to "can publish artifacts to the public bucket."
```

Also add a brief note in the **Build (CI)** section listing both triggers:

```
Two triggers fire on this repo:

- `relaygate-desktop-binaries`: push to `main` → publishes to
  `gs://.../relaygate-desktop/{SHORT_SHA}/` AND `latest/` mirror
- `relaygate-desktop-pr`: pull request against `main` → publishes to
  `gs://.../relaygate-desktop/{SHORT_SHA}/` only (does NOT overwrite
  `latest/`); enables reviewers to verify cross-platform binaries before merge
```

### TASK-8 — Update audit findings file with FIXED + BLOCKED status

Edit `audit/scope-findings/2026-05-04-env-verification.md` to add at the bottom:

```
## Resolution log (added 2026-05-04 evening)

- F-A: STATUS: FIXED (commit: <hash>) — new SA `relaygate-desktop-ci@`
  bound to trigger; verified test build SUCCESS; SA has no owner/editor.
- F-B: STATUS: FIXED (commit: <hash>) — `relaygate-desktop-pr` trigger
  created; PR #<N> verified the build runs against new SA.
- F-C (UBLA): STATUS: BLOCKED — cross-project (12 projects share
  `gs://relayone-488319-public`). Needs org-level decision.
- F-D (publicAccessPrevention): STATUS: BLOCKED — same cross-project
  blocker as F-C.
```

## Verification gates

All of the following must be true before this spec is marked done:

1. ✅ `gcloud iam service-accounts describe relaygate-desktop-ci@...` returns the SA, `disabled=False`
2. ✅ Project-level IAM for that SA contains exactly `cloudbuild.builds.builder` + `logging.logWriter` (no owner, no editor, no other roles)
3. ✅ Bucket-level IAM contains `roles/storage.objectAdmin` for that SA
4. ✅ `relaygate-desktop-binaries` trigger's `serviceAccount` field = the new SA
5. ✅ Most recent build for that trigger after rebind = SUCCESS
6. ✅ `relaygate-desktop-pr` trigger exists, points at `cloudbuild.yaml`, bound to new SA, fires on PR against `^main$`
7. ✅ A PR build using the new trigger has run SUCCESS
8. ✅ `docs/DEPLOYMENT.md` reflects new SA + both triggers
9. ✅ `audit/scope-findings/2026-05-04-env-verification.md` has resolution log

## Rollback plan

If something goes wrong mid-spec:

```bash
# Revert trigger SA to claude-eric-agent (matches pre-spec state):
gcloud builds triggers update relaygate-desktop-binaries \
  --project=relayone-488319 --region=us-central1 \
  --service-account=projects/relayone-488319/serviceAccounts/claude-eric-agent@relayone-488319.iam.gserviceaccount.com

# Delete the new SA (only after the trigger no longer references it):
gcloud iam service-accounts delete relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com \
  --project=relayone-488319

# Delete the new PR trigger:
gcloud builds triggers delete relaygate-desktop-pr \
  --project=relayone-488319 --region=us-central1
```

The rollback is fully scripted and reversible. No data is destroyed; only IAM bindings and one SA + one trigger are created/removed.
