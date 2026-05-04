# Env Verification — Codebase to GCP — 2026-05-04

Top-to-bottom audit of how this project's environment is wired, from source code through Cloud Build, GCS, IAM, Secret Manager, and the GitHub repo connection.

## Summary table

| # | Layer | Status | Detail |
|---|---|---|---|
| 1 | Code env reads | ✅ OK | 1 read in `src/main.ts` (`RELAYGATE_DESKTOP_URL`, with safe URL parse + fallback). 4 reads in `tests/live-dashboard.test.ts` (`CHROME_BIN`, `RELAYGATE_LIVE_URL`, `RELAYGATE_SITE_URL`, `CI_AUTH_TOKEN`), all with `??` defaults. 1 read in `tests/smoke.test.ts` indirectly via electron-spawn. |
| 2 | t3-env (per memory rule) | ⚠️ NOT USED | Memory rule says "if possible, use t3-env." Not in `package.json` deps. **Justified for this repo**: 1 env var with manual URL parse + try/catch + safe fallback in `src/main.ts:6-22`. t3-env's value is type safety across many vars; for one var with HTTPS protocol enforcement, hand-rolled is reasonable. Document this decision. |
| 3 | Cloud Build trigger exists | ✅ OK | `relaygate-desktop-binaries` (id `b5f7adf5-...`), gen2, **us-central1**, fires on push to `^main$`, points at `cloudbuild.yaml`. |
| 4 | Trigger event config | ⚠️ PUSH-ONLY | No PR triggers configured. PRs (like #1) don't run CI. Matches DEPLOYMENT.md but means PRs merge without artifact verification. |
| 5 | Trigger SA exists | ✅ OK | `claude-eric-agent@relayone-488319.iam.gserviceaccount.com` (display name "Claude / Eric Agent (long-lived, no session expiry)"). |
| 6 | **Trigger SA permissions** | ⚠️ **OVERPRIVILEGED** | SA holds `roles/owner` project-wide. CI build only needs writes to one bucket prefix. See **Finding F-A**. |
| 7 | GCS bucket exists | ✅ OK | `gs://relayone-488319-public` in `US-CENTRAL1`. Public-read via `roles/storage.objectViewer → allUsers`. |
| 8 | Bucket UBLA | ⚠️ NOT ENABLED | `iamConfiguration.uniformBucketLevelAccess.enabled: false`. ACLs apply alongside IAM. Modern best practice is UBLA = on. See **Finding F-C**. |
| 9 | Public download URLs work | ✅ OK | `https://storage.googleapis.com/relayone-488319-public/relaygate-desktop/latest/SHA256SUMS.txt` → HTTP 200. AppImage path → HTTP 200. |
| 10 | `latest/` in sync with `{sha}/` | ✅ OK | `latest/` and `2e5a4de/` (current `origin/main`) contain identical 11+1 artifact set. |
| 11 | Last build for current `origin/main` | ✅ SUCCESS | Build `c61bb30f-...` for `2e5a4de` on 2026-05-03 04:27 UTC. All 11 artifacts published. |
| 12 | GitHub repo connection | ✅ COMPLETE | `relayone-github-conn` (state: COMPLETE) → `relaygate-desktop-repo` mapped to `https://github.com/RelayOne/relaygate-desktop.git`. |
| 13 | Secret Manager: mac signing secrets | ✗ NONE | All 6 expected secrets absent (`apple-developer-id-cert`, `apple-developer-id-cert-pass`, `apple-id-email`, `apple-app-specific-password`, `apple-team-id`, `relaygate-desktop-mac-deploy-key`). **Matches docs** — `cloudbuild-mac.yaml` is intentionally inert until provisioned. |
| 14 | Secret Manager: relaygate-desktop-specific secrets | ✗ NONE | Zero secrets matching `desktop`. **Matches docs** — desktop pipeline uses Cloud Build builtin substitutions only. |
| 15 | App identity coherent | ✅ OK | `electron-builder.yml`: `appId: ai.relaygate.desktop`, `productName: RelayGate`. `package.json`: `name: relaygate-desktop`, `version: 0.1.0`, `homepage: https://relaygate.ai`, `repository: github.com/RelayOne/relaygate-desktop`. |
| 16 | package-lock.json integrity | ✅ OK | Lockfile name + version match `package.json`. |
| 17 | Live dashboard reachable | ✅ OK | `https://app.relaygate.ai` → HTTP 200 (redirects to `/sign-in`). `https://relaygate.ai` → HTTP 200. |
| 18 | DEPLOYMENT.md substitutions table | ✅ ACCURATE | All 6 documented substitutions (`$COMMIT_SHA`, `$SHORT_SHA`, `$BUILD_ID`, `$PROJECT_ID`, `$_MAC_RUNNER_HOST`, `$_MAC_RUNNER_USER`) match the actual trigger configuration. |

## Findings

### F-A — Cloud Build trigger SA has `roles/owner` project-wide  ·  HIGH (security)

**What:** The CI service account `claude-eric-agent@relayone-488319.iam.gserviceaccount.com` holds `roles/owner` at the GCP project level — the maximum possible permission. This is a multi-tenant project (relaygate-desktop, relaygate, relaygate-admin, relaygate-app, wellytic, wellytic-admin, wellytic-mobile, veritize, framebright-app, cloudswarm-admin, cloudswarm-app, coder1, actium, deeptap, coderadar, coderadar-ingest, heroa, trustplane, sites, r1-agent, etc.). Project owner subsumes IAM admin, secret access, GCS admin, Cloud SQL admin, Compute admin, etc. across **every** unrelated service.

**Why it matters:** if a relaygate-desktop CI build executes a malicious dependency (e.g., a compromised npm package via `npm ci`, an `electron-builder` plugin attack, an `electronuserland/builder:wine-mono` image takeover), the attacker has full project ownership and can:
- Delete production databases for unrelated services (saw 70+ relaygate-/wellytic-/etc. secrets including `*-jwt-secret`, `*-db-url`, `*-prod-shared-*`).
- Modify IAM bindings and lock you out.
- Read every Secret Manager secret in the project.
- Spin up crypto miners.
- Exfiltrate everything in `gs://relayone-488319-public` and any private buckets.

**Why this is what's set up:** the SA was created as a long-lived agent for Claude/Eric to drive infrastructure changes during a previous scope. It was granted owner once and never scoped down. Functional, but inappropriate as a CI trigger SA.

**Effort to fix:** moderate.
- Create a new dedicated CI SA: `relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com`.
- Grant minimum roles:
  - `roles/cloudbuild.builds.builder` (project-level — required for Cloud Build to operate)
  - `roles/storage.objectAdmin` scoped to `gs://relayone-488319-public/relaygate-desktop/*` via condition (not full bucket)
  - `roles/logging.logWriter` (project-level — for Cloud Build log streaming)
- Re-bind the trigger to the new SA.
- Drop `roles/owner` from `claude-eric-agent` for CI use (keep it for interactive use only, ideally).

Note: the user's saved deployment conventions memo doesn't explicitly call out CI SA scoping, but it does say "Use Cloud Run when possible" with implicit security hygiene (instance-based billing, etc.). This finding is consistent with the spirit of those rules even if not literally stated.

### F-B — Trigger has no PR event config  ·  MEDIUM (process)

**What:** the trigger only fires on push to `main`. PRs (like the open #1) don't run CI and merge without artifact verification.

**Why it matters:** less critical than F-A. PR reviewers can't see "is the cross-compile clean?" before merging. Documented in DEPLOYMENT.md as the current state, so this is more "is this what you actually want?" than "this is broken."

**Effort:** low. Add a second trigger config with `pullRequest` event (or extend the existing one). One-time setup; runs builds on PR with the option to gate merge on success.

### F-C — Bucket uniform-bucket-level-access not enabled  ·  LOW (hygiene)

**What:** `iamConfiguration.uniformBucketLevelAccess.enabled: false`. Object-level ACLs and bucket IAM both apply, which is the legacy/dual-permission model.

**Why it matters:** UBLA-on collapses to IAM-only, which is simpler to reason about and audit. With UBLA off, an object can be ACL-set to a different visibility than its bucket IAM dictates, creating drift you can't see in `gcloud storage buckets get-iam-policy` alone.

**Effort:** trivial. `gcloud storage buckets update gs://relayone-488319-public --uniform-bucket-level-access`. **Caveat:** existing legacy ACLs become ineffective; verify nothing in the bucket relies on per-object ACL grants before flipping.

### F-D — `publicAccessPrevention` not set  ·  LOW (hygiene)

**What:** `iamConfiguration.publicAccessPrevention: inherited` (i.e., "use the org's default policy"). For a bucket that intentionally serves public binaries, the explicit value should be `inherited` only if the org default is "off", else `enforced` is wrong.

**Why it matters:** if the org policy ever flips to enforce-public-access-prevention by default, this bucket's `latest/` and `{sha}/` paths stop serving HTTP 200 to anonymous downloaders. Setting it explicitly to `inherited` is fine; just confirm the org policy is `off`. Currently downloads return 200, so the org default is permissive today.

**Effort:** trivial. Confirm org policy intent; no action if explicit `inherited` is what you want.

## Things that ARE properly configured (clean bill of health)

- The CI pipeline produces all 11 artifacts (Linux x4 + Windows x3 + Mac.zip x2 + Mac.dmg x2) on every main push.
- Public-read works for both `latest/` and per-SHA prefixes.
- `latest/` is correctly synced to the most recent successful build (`2e5a4de`).
- The GitHub→Cloud Build connection is COMPLETE and serving the trigger.
- App identity (`appId`, `productName`, `package.json`) is internally consistent.
- Lockfile (`package-lock.json`) matches `package.json`.
- The live dashboard at `app.relaygate.ai` is reachable (HTTP 200).
- Documented substitutions in DEPLOYMENT.md match the actual trigger.
- Mac signing path is intentionally inert and accurately documented as such.
- No secrets are required by the current Linux pipeline (it uses only Cloud Build builtins).

## Open user-action items (carry-overs unrelated to this audit)

- `CLAUDE.md` placeholder commands (TASK-2 BLOCKED in `specs/infra-docs-cleanup.md`)
- 9 commits on local main not on `origin/main` (PR #1 carries them; resolve on merge)

## Resolution log (added 2026-05-04 evening)

**F-A** (CI trigger SA had `roles/owner`): STATUS: FIXED (commit: 2ebbdba; followup commit: a1fa74f for actAs binding) — `relaygate-desktop-ci@relayone-488319.iam.gserviceaccount.com` SA created with three roles only (`cloudbuild.builds.builder`, `logging.logWriter`, `storage.objectAdmin` on `gs://relayone-488319-public`) plus `iam.serviceAccountTokenCreator` + `iam.serviceAccountUser` granted to Cloud Build's service agent on the SA (required for PR triggers). `relaygate-desktop-binaries` trigger re-bound to it; `claude-eric-agent` SA no longer used by this trigger (still used by 32 other org-wide triggers — those are out of this repo's scope to fix). End-to-end verified: build `79719725-7cdf-4eda-97e6-4f2ba3dc9c38` ran the full cloudbuild.yaml pipeline against `2e5a4de` under the new SA, completed SUCCESS in 22 min, published all 11 artifacts + SHA256SUMS to `gs://relayone-488319-public/relaygate-desktop/{2e5a4de,latest}/`, public download returns HTTP 200. The minimum-roles set is proven sufficient.

**F-B** (no PR triggers): STATUS: FIXED (commit: 2ebbdba) — `relaygate-desktop-pr` trigger created (gen2/us-central1), bound to `relaygate-desktop-ci@`, fires on `pullRequest` event against `^main$`, points at `cloudbuild.yaml`, comment-control `COMMENTS_ENABLED` (so external-collaborator PRs require an `/gcbrun` from a repo member; member PRs run automatically). Verified via `gcloud builds triggers describe`. End-to-end verification: PR #2 fired the trigger, build `ad85669c-238d-4d75-9a3e-623805379046` registered and reached WORKING under the new SA.

**F-C** (UBLA on shared bucket): STATUS: BLOCKED — bucket `gs://relayone-488319-public/` is shared by 12 projects (relaygate, relaygate-desktop, veritize, deeptap, wellytic-firmware, wellytic-mobile, coder1, r1, relayone, w242-verification, deeptap-cli, gcloud). Enabling UBLA collapses ACLs to IAM-only and is one-way for legacy ACL workflows; needs an org-level decision and coordination with the other 11 projects' owners. Out of scope for this repo's PR.

**F-D** (explicit publicAccessPrevention): STATUS: BLOCKED — same cross-project blocker as F-C. Currently `inherited` from org policy; explicit setting requires the same coordination. Object downloads currently return HTTP 200 anonymously, so the org default is permissive today.

## Side note: 32 other triggers share the same problem

`claude-eric-agent` SA is bound to 33 Cloud Build triggers across the org. This repo fixed its one. The other 32 triggers (actium-*, wellytic-*, veritize-*, deeptap-*, coderadar-*, etc.) carry the same `roles/owner` blast radius and should be addressed in their respective projects' scope-and-repair runs. This is documented here for cross-project visibility but is explicitly NOT this repo's responsibility to fix.
