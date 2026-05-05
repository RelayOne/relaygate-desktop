<!-- STATUS: in-progress -->
<!-- TYPE: feature -->
<!-- CREATED: 2026-05-05 -->
<!-- BUILD_STARTED: 2026-05-05 -->
<!-- DEPENDS_ON: cloudbuild-env-paths -->
<!-- BUILD_ORDER: 3 -->

# Cloud Build triggers for `dev` and `staging` — Implementation Spec

## Overview

After the `dev` and `staging` long-lived branches were created (PR #7/#8/#9 promotion chain), pushes and PRs targeting those branches do not run CI — only `^main$` triggers exist. This spec adds 4 new triggers so the deployment-conventions feature → dev → staging → main flow has actual CI gates between each stage. All 4 triggers reuse the existing `relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com` SA (already minimum-scoped from prior audit work) so no new IAM is needed. Each push-trigger sets a `_ENV` substitution so the env-aware `cloudbuild.yaml` (build-order 2) routes artifacts correctly.

## Stack & Versions

- Cloud Build gen2 GitHub triggers via connection `relayone-github-conn`, repo `relaygate-desktop-repo`
- Region: `us-central1`
- Project: `relayone-488319`
- Trigger creation method: **JSON export-modify-import only** (lesson from substitutions-wipe incident — see `audit/scope-findings/2026-05-04-post-rebind-recovery.md`). The `gcloud builds triggers create github` CLI works for create, but for any future modification we must use export → jq → import.

## Triggers to create

| Name | Type | Branch regex | `_ENV` |
|---|---|---|---|
| `relaygate-desktop-binaries-dev` | push | `^dev$` | `dev` |
| `relaygate-desktop-pr-dev` | pull_request | base `^dev$` | `dev` |
| `relaygate-desktop-binaries-staging` | push | `^staging$` | `staging` |
| `relaygate-desktop-pr-staging` | pull_request | base `^staging$` | `staging` |

Existing prod triggers are NOT modified by this spec. All trigger SAs are the existing `relaygate-desktop-ci@`.

## Stack-relevant prior art

`audit/scope-findings/2026-05-04-post-rebind-recovery.md:24-26`: any change to a gen2 trigger MUST go via JSON export-modify-import. The `gcloud builds triggers update github --service-account=...` form silently wipes substitutions. We don't run `update` in this spec, but if a created trigger needs adjustment later, the lesson stands.

`audit/scope-findings/2026-05-04-env-verification.md` Pattern A (storage publishers): the same pattern used to scope-down the existing `relaygate-desktop-binaries` and `relaygate-desktop-pr` SAs applies — these are storage-publish triggers, role set is `roles/storage.objectAdmin` on the public bucket (already granted to `relaygate-desktop-ci@`).

## Checklist

- [ ] **TASK-1**: Verify `cloudbuild-env-paths` spec is BUILT first (commit on dev branch). Reading `cloudbuild.yaml` HEAD should show `substitutions:` block declaring `_ENV: 'prod'`. If not present, BLOCK and chain that spec first.
  - VERIFY: `grep -A2 '^substitutions:' cloudbuild.yaml` shows the block.

- [ ] **TASK-2**: Create `relaygate-desktop-binaries-dev` trigger.
  - Method: `gcloud builds triggers create github --region=us-central1 --project=relayone-488319 --name=relaygate-desktop-binaries-dev --description="Push to dev → build all platforms → publish to dev/${SHORT_SHA}/ and dev/latest/" --repository=projects/relayone-488319/locations/us-central1/connections/relayone-github-conn/repositories/relaygate-desktop-repo --branch-pattern=^dev$ --build-config=cloudbuild.yaml --service-account=projects/relayone-488319/serviceAccounts/relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com --substitutions=_ENV=dev`
  - VERIFY: `gcloud builds triggers describe relaygate-desktop-binaries-dev --region=us-central1 --format=json | jq -e '.substitutions._ENV == "dev" and .repositoryEventConfig.push.branch == "^dev$" and (.serviceAccount | endswith("relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com"))'` returns `true`.

- [ ] **TASK-3**: Create `relaygate-desktop-pr-dev` trigger.
  - Method: `gcloud builds triggers create github --region=us-central1 --project=relayone-488319 --name=relaygate-desktop-pr-dev --description="PRs targeting dev → run cloudbuild.yaml; publish to dev/${SHORT_SHA}/ for review (no latest/ mirror)" --repository=projects/relayone-488319/locations/us-central1/connections/relayone-github-conn/repositories/relaygate-desktop-repo --pull-request-pattern=^dev$ --comment-control=COMMENTS_ENABLED --build-config=cloudbuild.yaml --service-account=projects/relayone-488319/serviceAccounts/relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com --substitutions=_ENV=dev`
  - The PR-mode `latest/` skip in `cloudbuild.yaml:publish` looks at `$TRIGGER_NAME` and matches `relaygate-desktop-pr` exactly. We must update that check to use a glob/prefix match so `relaygate-desktop-pr-dev` and `relaygate-desktop-pr-staging` are also recognized as PR builds. Inline sub-task in this TASK:
    - Update the `publish` step's check from `if [ "$TRIGGER_NAME" = "relaygate-desktop-pr" ]; then` to `if [[ "$TRIGGER_NAME" == relaygate-desktop-pr* ]]; then` — bash `[[` glob match.
    - Re-test: this comes back during TASK-9.
  - VERIFY: trigger created, jq check on subs/branch matches.

- [ ] **TASK-4**: Create `relaygate-desktop-binaries-staging` trigger. Same shape as TASK-2 but `--branch-pattern=^staging$ --substitutions=_ENV=staging`.
  - VERIFY: jq check.

- [ ] **TASK-5**: Create `relaygate-desktop-pr-staging` trigger. Same shape as TASK-3 but `--pull-request-pattern=^staging$ --substitutions=_ENV=staging`.
  - VERIFY: jq check.

- [ ] **TASK-6**: Verify Cloud Build SA token-creator + SA-user permissions on the `relaygate-desktop-ci@` SA for the Cloud Build service agent. (This was the F-B fix in `audit/scope-findings/2026-05-04-env-verification.md` for the existing prod PR trigger; the same SA bindings apply to the new triggers since they share the SA. Should already be in place — this task is just to verify, not re-grant.)
  - Run: `gcloud iam service-accounts get-iam-policy relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com --project=relayone-488319 --format=json | jq -e '[.bindings[] | select(.role == "roles/iam.serviceAccountTokenCreator" or .role == "roles/iam.serviceAccountUser") | .members[]] | length >= 2'` — if `false`, BLOCK and ask user; if `true`, mark FIXED.
  - VERIFY: jq returns `true`.

- [ ] **TASK-7**: Smoke-fire each new trigger. Push a no-op commit to `dev` (e.g., a whitespace change to a doc) and verify `relaygate-desktop-binaries-dev` fires. Repeat for `staging`. For PR triggers, the next time someone opens a PR targeting dev/staging the trigger will fire — manual `/gcbrun` is acceptable on a synthetic PR if user wants live verification.
  - SAFER alternative: use `gcloud builds triggers run relaygate-desktop-binaries-dev --branch=dev --region=us-central1` to fire the trigger without pushing. This is the preferred method.
  - Run for all 4 triggers (PR triggers can be fired with `--sha=<some-pr-head-sha>` once one exists).
  - VERIFY: each `gcloud builds triggers run` returns a build ID; that build status reaches WORKING within 60s.

- [ ] **TASK-8**: Wait for the dev push-trigger smoke build (from TASK-7) to complete. Confirm artifacts land at `gs://relayone-488319-public/relaygate-desktop/dev/<sha>/` and `gs://relayone-488319-public/relaygate-desktop/dev/latest/`, AND that `gs://relayone-488319-public/relaygate-desktop/latest/` is **untouched** (still pointing at the prior prod build). This validates BOTH this spec and the env-paths spec end-to-end.
  - Polling: `until [ $(gcloud builds describe <ID> --region=us-central1 --format='value(status)') = "SUCCESS" ] || [ $(gcloud builds describe <ID> --region=us-central1 --format='value(status)') = "FAILURE" ]; do sleep 30; done`
  - GCS check: `gcloud storage ls gs://relayone-488319-public/relaygate-desktop/dev/latest/ | wc -l` returns ≥ 12 (12 artifacts: 4 linux + 1 win + 4 mac.zip + 2 mac.dmg + SHA256SUMS).
  - Backward-compat check: `gcloud storage cat gs://relayone-488319-public/relaygate-desktop/latest/SHA256SUMS.txt | md5sum` matches `gcloud storage cat gs://relayone-488319-public/relaygate-desktop/prod/latest/SHA256SUMS.txt | md5sum` (last prod build mirrored to both).
  - VERIFY: build SUCCESS, dev/ paths have 12+ artifacts, prod legacy mirror unchanged.

- [ ] **TASK-9**: Same as TASK-8 but for the staging push-trigger smoke build. (Note: requires that the timeout-fix + the env-paths change have been promoted dev→staging via the standard PR flow before this trigger fires usefully. If staging branch is at the older HEAD when this trigger first fires, the build would use the older yaml. Acceptable as long as we promote dev → staging immediately after dev validation in TASK-8.)
  - Sub-task: open PR `dev → staging` with the env-paths and trigger-creation commits, merge it, then run TASK-9.
  - VERIFY: staging build SUCCESS, staging/ paths populated, dev/ and prod/ mirrors untouched.

- [ ] **TASK-10**: Document the 4 new triggers in `docs/DEPLOYMENT.md`. Add a "CI triggers" subsection with a table: trigger name, branch, type (push/PR), `_ENV` value, what it produces. Verbose context paragraph above explaining the dev → staging → main promotion flow and how each branch is gated.
  - VERIFY: doc has the trigger table + flow diagram (text-form).

## Rollback

Per-trigger: `gcloud builds triggers delete <name> --region=us-central1`. Independent. The `cloudbuild.yaml` PR-mode glob update (TASK-3 sub-task) is a 1-line revert if needed; the prod PR trigger still matches `relaygate-desktop-pr*`.

## Validation

After all tasks pass:
- `gcloud builds triggers list --region=us-central1 --filter='name~relaygate-desktop'` shows 6 triggers (2 prod existing + 4 new).
- All 4 new triggers' SA is `relaygate-desktop-ci@`.
- Each push-trigger has `_ENV` substitution set to its env name.
- Test builds for dev and staging both completed SUCCESS, artifacts landed in correct env-prefixed paths, no clobber of prod legacy mirror.
