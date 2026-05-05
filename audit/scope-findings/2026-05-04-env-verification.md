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

**F-B** (no PR triggers): STATUS: FIXED (commit: 2ebbdba; followups: 54a1925 + 3cdf177) — `relaygate-desktop-pr` trigger created (gen2/us-central1), bound to `relaygate-desktop-ci@`, fires on `pullRequest` event against `^main$`, points at `cloudbuild.yaml`, comment-control `COMMENTS_ENABLED`. Verified via `gcloud builds triggers describe`. End-to-end verification (FINAL): build `5ba5d6af-6bd0-4a30-b123-eabbd037d20b` for PR-trigger ran on commit `a953390` under `relaygate-desktop-ci@`, completed SUCCESS in 13:44, all 6 steps including the previously-failing `build-mac-dmg` (apt retry fix worked — `BONUS-1`) and `publish` (PR-mode fix worked — `BONUS-2`, build log shows `"PR build detected (relaygate-desktop-pr) — skipping latest/ mirror"`). Verification gates: (1) `/latest/SHA256SUMS.txt` generation = 21:28:50 UTC = exact finish time of main-push build 79719725 (NOT 22:19 = PR finish), confirming `/latest/` was untouched by the PR build. (2) SHA256SUMS hash of `/latest/` = `1d676744...` = identical to `/2e5a4de/`'s file, while `/a953390/`'s SHA256SUMS hash is `c9ade10a...` — proves the PR's content stayed in its own prefix. (3) `/a953390/` has 12 entries (11 artifacts + SHA256SUMS), full artifact set published. Two stale builds (5f590689, 1bd1d8e5) were CANCELLED earlier — they were for an outdated head SHA from queued PR-base-flip events; they never reached the publish step so couldn't have clobbered /latest/ even before the BONUS-2 fix.

**F-C** (UBLA on shared bucket): STATUS: FIXED (executed via gcloud after explicit user authorization, no commit hash for the IAM change itself; recorded in this commit) — bucket `gs://relayone-488319-public/` had UBLA enabled. Preflight: per-object ACL count probed across all 12 project prefixes (coder1, deeptap-cli, deeptap, gcloud, r1, relaygate-desktop, relaygate, relayone, veritize, w242-verification, wellytic-firmware, wellytic-mobile) — all returned `acl_count=0`, no per-object grants to lose. Bucket-level `acl: []` and `defaultObjectAcl: []` also empty. Post-flip verification: public download returns HTTP 200 across multiple prefixes (relaygate, veritize, deeptap spot-checked); `gsutil bucketpolicyonly get` reports `Enabled: True, LockedTime: 2026-07-30` (90-day lock applied). All 11 other projects' download flows continue to work (verified by HEAD request to a sample artifact in each prefix that returned a 200).

**F-D** (explicit publicAccessPrevention): STATUS: FIXED-AS-INHERITED — bucket `publicAccessPrevention` is now explicitly `inherited` (which is the documented intended state per the audit). Note: a fat-finger attempt with `--public-access-prevention` (no value) initially enabled enforcement, breaking public reads (HTTP 403) for ~30 seconds; reverted immediately with `--no-public-access-prevention` and verified HTTP 200 restored. No artifact corruption; no cached blob references broken. Caveat captured in this audit so future hands know the flag's default value flips the wrong way.

## Cross-project sweep: all 32 other triggers ALSO scoped down

After completing relaygate-desktop's scope-down, the user authorized
extending the same pattern to all 32 other triggers org-wide. Status:
**0 triggers remain on `claude-eric-agent`** as of 2026-05-04 evening.

### Inventory (33 total triggers, including this repo's 2)

| Pattern | Roles per SA | Triggers |
|---|---|---|
| **A** — storage publishers | builder + logWriter + storage.objectAdmin (relayone-488319-public) | r1-agent-stoke-binaries, deeptap-binaries, r1-agent-binaries, wellytic-mobile-android (4) |
| **B** — Cloud Run deploy (no SQL) | A roles minus storage + secretmanager.secretAccessor + artifactregistry.writer + run.developer + iam.serviceAccountUser | deeptap-deploy, coderadar-deploy, veritize-deploy, relayone-deploy, wellytic-deploy, actium-studio-deploy, heroa-deploy, coderadar-ingest-deploy, truecom-admin-deploy, wellytic-portal-deploy, truecom-app-deploy, relayonethinger (12) |
| **C** — Cloud Run + Cloud SQL | B roles + cloudsql.client | actium-staging-deploy, actium-dev-deploy, wellytic-admin-deploy, veritize-admin-deploy, relaygate-admin-deploy, coderadar-admin-deploy, cloudswarm-admin-deploy, wellytic-app-deploy, relaygate-app-deploy, parentproof-deploy, framebright-app-deploy, cloudswarm-app-deploy, veritize-app-deploy (13) |
| **D-trustplane** — CI-only | builder + logWriter only | trustplane-deploy (1) |
| **D-attestik** — B + compute | B roles + compute.instanceAdmin.v1 | attestik-deploy (1) |
| **D-actium** — cross-project | B+SQL roles split: builder + logWriter in relayone-488319 (CB host); secretmanager + artifactregistry + run + actAs + cloudsql in actium-488319 (deploy target) | actium-deploy (1) |
| **relaygate-desktop** | builder + logWriter + storage.objectAdmin (bucket) + actAs (CB agent) | relaygate-desktop-binaries, relaygate-desktop-pr (this repo, originally addressed) |

Each trigger now has its OWN dedicated SA named `<trigger>-ci@relayone-488319.iam.gserviceaccount.com`. Per-SA role sets are minimum-needed (verified by inspecting each repo's cloudbuild.yaml). All SAs include `iam.serviceAccountTokenCreator` + `iam.serviceAccountUser` granted to the Cloud Build service agent (required for any future PR triggers; harmless for push-only triggers today).

### What's NOT touched
- `claude-eric-agent@relayone-488319.iam.gserviceaccount.com` SA itself remains with `roles/owner` — it's described as "long-lived, no session expiry" agent SA used for interactive infrastructure work outside CI. Removing its owner role is a separate decision (user-only, since some interactive operations may rely on owner-level access). With zero triggers now using it, that decision is purely about interactive use, not CI risk.

### Reusable script
`/tmp/cb-analysis/scope-down-trigger.sh` (one-off, retained for reference) takes a trigger name + pattern letter and applies the appropriate SA + roles + rebind. The patterns are derived from cloudbuild.yaml inspection. The script is idempotent (gcloud `add-iam-policy-binding` + `iam service-accounts create` are idempotent on re-run).

### Verification snapshot (2026-05-04 evening)
`gcloud builds triggers list --project=relayone-488319 --region=us-central1 --format=json | jq '[.[] | select((.serviceAccount // "") | contains("claude-eric-agent"))] | length'` returns `0`. Each trigger now binds to its dedicated SA. End-to-end pipeline verification for this repo's relaygate-desktop-binaries and relaygate-desktop-pr triggers covered above; the OTHER 31 triggers will be exercised on their next legitimate push and will surface any missing-role gaps in real time, recoverable per-trigger via the same gcloud `add-iam-policy-binding` calls.
