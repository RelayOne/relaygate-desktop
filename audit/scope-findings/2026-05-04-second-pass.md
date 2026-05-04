# Scope Findings — 2026-05-04 (second pass)

## Repo state

- Branch: `main`, 8 commits ahead of `origin/main` (the doc-cleanup work just merged is unpushed)
- Working tree: only `CLAUDE.md` untracked
- Build, typecheck: pass
- All 6 docs in `docs/` populated with verbose real content (913 lines total)
- `.gitignore` covers `*.dmg` under `.work/proof/binaries/`

## Carry-overs from previous scope (still relevant, status unchanged)

- **TASK-2 (CLAUDE.md placeholder commands)** — STATUS: BLOCKED. Harness `.claude/settings.json` denies `Edit/Write/MultiEdit` on `CLAUDE.md` and `guard-bash-writes.sh` blocks bash writes. User-action only.
- **`CLAUDE.md` untracked** — fresh scaffold from setup. Not in git. Whether to track it depends on TASK-2 decision.
- **8 commits unpushed** — user's call when to `git push`.

## Filter sweep — what would qualify under the impact-effort rule

### AUTOMATIC FIX (security / data loss / breaking bugs / UX blockers / broken contracts / missing error handling / a11y)

**Nothing.** Reviewed `src/main.ts`, `src/preload.ts`, both test files, and CI configs. No vulnerabilities, no missing error handling on user-facing paths, no broken contracts, no a11y gaps. The Electron security model is correctly hardened (`contextIsolation`, `sandbox`, `nodeIntegration: false`, origin allowlist with HTTPS-only enforcement, `will-attach-webview` blocked). The URL guard handles unparseable URLs with `try/catch` and a safe fallback to the default origin. No empty `catch` blocks. No `any` types in actual code (`src/`). External link routing is fail-closed.

### FIX IF EFFORT IS REASONABLE

- **CI-integrated smoke test** (already flagged Horizon in FEATURE-MAP, line under `Testing`). Real value: catches Electron-upgrade rendering regressions before artifacts publish. Today, smoke runs locally only, which means a broken `electron@36` upgrade could ship to GCS. Effort: moderate — needs `xvfb-run` in the `dist-all-platforms` step or a separate ubuntu step + display server, and a tolerance for one external dependency (`app.relaygate.ai`) in the CI critical path. The existing smoke test (`tests/smoke.test.ts`) is already written and works locally.
- **Push to origin** — the 8 unpushed commits include the docs work. Trivial, but a user decision.

### AUTOMATICALLY DROP (do not surface)

All Horizon items in FEATURE-MAP — code signing (Apple+EV cert spend decisions), auto-update, native gateway control panel, system tray, OS notifications, cross-platform CI smoke. Each is feature work the team has consciously deferred; none is a current user-impacting problem.

Refactors, lint setup, CONTRIBUTING.md, library swaps, test framework migrations — style preferences, not user-facing.

## Verified during this pass (was a candidate finding, ruled out)

**Cloud Build trigger for relaygate-desktop is real and working.** Initial scan against `gcloud builds triggers list` (global scope) showed no trigger. False alarm — the trigger is `relaygate-desktop-binaries` (id `b5f7adf5-...`), gen2/regional in `us-central1`, configured for push to `^main$`, and last fired SUCCESS for commit `2e5a4de` on 2026-05-03. Filtered for region with `--region=us-central1`. CI is healthy. PR #1 will trigger a new build on merge.

## Smoke-test-in-CI — architectural question (not auto-fixable)

`tests/smoke.test.ts` is the obvious "lower the threshold" candidate: wire it into `cloudbuild.yaml` between `build-main` and `dist-all-platforms` so a broken Electron upgrade can't ship to GCS. But the test is hard-coded to assert against the live `https://app.relaygate.ai` dashboard:

- Line 162: `const expectedOrigin = "https://app.relaygate.ai"`
- Line 171-176: asserts title contains "relaygate", body contains "sign in", body ≥ 60 chars

This couples CI reliability to the live dashboard's uptime and HTML stability. Two design paths:

1. **Keep coupled** — accept that CI fails when `app.relaygate.ai` is briefly down or ships HTML changes. Catches both Electron-upgrade regressions AND dashboard-shipping-broken-JS regressions, but creates flake.
2. **Decouple** — point smoke at a static `file://` fixture or local HTML harness. Catches Electron-upgrade regressions only. Stable, but doesn't catch dashboard-side regressions.

Either way, CI also needs `xvfb-run` and Chromium runtime libs (`libnss3`, `libgtk-3-0`, `libasound2`, etc.). The current `electronuserland/builder:wine-mono` image probably has them; needs verification.

This is a feature spec, not a fix. Holding for user direction.

## Honest assessment

**Scan complete. No high-impact issues found. The codebase is solid for its current stage.**

The previous /scope already swept this repo and identified a docs+infra gap; that gap is now closed (5 commits, 913 lines of new docs, gitignore patched). Since then, the only meaningful candidate is the CI smoke test wiring — and it's a reliability nice-to-have, not a fix.

I can lower the filter threshold to explore optimization opportunities (e.g., wire smoke into CI; track ICO/ICNS deriviation; investigate the 8% silent-failure rate of CDP attach in live-dashboard.test.ts; add a CONTRIBUTING.md) — but the code works as-is.
