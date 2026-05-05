# Post-Rebind Recovery — 2026-05-04 (later that evening)

After the 33-trigger SA scope-down landed (PR #2, PR #3), running a verification sweep surfaced a **regression introduced by my own rebind operation** plus completed two genuinely-deferred infra items.

## Incident: substitutions wipe across all 33 rebound triggers

**What happened.** When `gcloud builds triggers update github <name> --service-account=...` ran for each trigger, it silently **wiped the trigger's user-defined substitutions** (`_DB_SECRET`, `_ENV`, `_JWT_SECRET`, `_SERVICE_NAME`, `_SQL_INSTANCE`, `_AR_REPO`, etc.). The command's man page documents `--update-substitutions` and `--clear-substitutions` flags, but offers no warning that omitting them on `update` resets the field to empty.

**How it surfaced.** Verification sweep listed the most recent build per trigger after the rebind:
- `truecom-app-deploy`: FAILURE (Dockerfile bug — pre-existing, unrelated to my rebind)
- `veritize-admin-deploy`: FAILURE — `gcloud run deploy: error parsing [service]` because `$_SERVICE_NAME` was empty post-wipe

Comparing substitutions between the last `claude-eric-agent` SUCCESS and the post-rebind FAILURE for veritize-admin showed 5 custom subs gone:
```
_DB_SECRET=veritize-db-url
_ENV=prod
_JWT_SECRET=veritize-admin-jwt-secret
_SERVICE_NAME=veritize-admin
_SQL_INSTANCE=relayone-dev
```

**Blast radius.** All 33 rebound triggers had their custom substitutions wiped. 20 of them depended on substitutions for any successful build; the other 13 had always run with zero custom subs (verified by inspecting their last-SUCCESS build history). veritize-admin-deploy was the only one whose next-after-rebind build had fired and failed within ~30 min of the rebind. The other 19 affected triggers would have failed on their next push to main, with the same class of error — would've degraded their respective production deploys silently.

**Fix.** STATUS: FIXED (commit: 00af9a3 — audit trail squash-merge; the underlying recovery is a gcloud-side trigger re-import, not a git change) — extracted the original substitution set from each trigger's last `claude-eric-agent` SUCCESS build (built `/tmp/cb-recovery/restore.tsv` with 20 rows), then for each: exported the trigger config to JSON, merged the substitutions in via `jq`, re-imported via `gcloud builds triggers import --source=...`. The `--update-substitutions` flag on `update github` is rejected with `INVALID_ARGUMENT` on gen2 triggers — JSON import is the only working path. Verified post-restore by triggering a manual build of `veritize-admin-deploy`: SUCCESS in <2 minutes (build `d4a1bcd7-d186-4b3b-85d1-fb03397d97ff`).

**Lesson.** Future SA rebinds in this org **must** use the JSON export-modify-import path, never `gcloud builds triggers update github --service-account` directly. The `/tmp/cb-recovery/scope-down-trigger.sh` reference script in the prior audit needs that update before reuse — adding a note here so the next person doesn't repeat the mistake.

## Owner role removed from `claude-eric-agent` SA

STATUS: FIXED (commit: 00af9a3 — audit trail squash-merge; the underlying IAM change is a gcloud `remove-iam-policy-binding`, not a git change) — `roles/owner` removed from `claude-eric-agent@relayone-488319.iam.gserviceaccount.com`. Pre-flight: confirmed `eric@goodventures.ca` holds `roles/owner` directly at both project (`relayone-488319`) and org (`823158852610`) level — Eric's interactive gcloud sessions use the user identity directly, not via SA impersonation, so dropping owner from the SA does not affect Eric's working access. Post-removal: SA's only residual project bindings are `roles/iam.serviceAccountUser` and `roles/run.admin` (legacy bindings worth a follow-up cleanup but with vastly less blast radius than `owner`).

## Smoke test wired into CI

STATUS: FIXED (commit: 37ae52c — squash-merge of PR #5 into main) — `cloudbuild.yaml` gets a new `smoke-test` step between `build-main` and `dist-all-platforms`. Uses `node:20` + apt installs `xvfb` + Chromium runtime libs + runs `xvfb-run npm run test:smoke` with 3-attempt retry and 15s backoff. Step is blocking (broken builds never publish). Tradeoff: couples CI reliability to `app.relaygate.ai` uptime — three-attempt retry handles transient flakes, sustained outages will block builds (correct fail-closed behavior). FEATURE-MAP "CI-integrated test run" Horizon → Done. Test artifacts (PNG screenshots, JSON results, log) now collected to `gs://...build-{BUILD_ID}/` for post-mortem.

## Final state

- All 33 Cloud Build triggers run as dedicated `<trigger>-ci@` SAs with minimum-needed roles
- All 33 triggers have their original substitutions restored
- `claude-eric-agent` SA: no longer owner; minimal residual bindings; **0 triggers** depend on it
- Bucket `gs://relayone-488319-public`: UBLA enabled (lock until 2026-07-30), publicAccessPrevention=inherited
- `cloudbuild.yaml` (this repo's): apt retry on flake, PR-mode publish (no /latest/ clobber), smoke-test wired in (PR #5)
- All docs in `docs/` populated and current
- `CLAUDE.md` placeholder commands replaced (PR #4 merged)
