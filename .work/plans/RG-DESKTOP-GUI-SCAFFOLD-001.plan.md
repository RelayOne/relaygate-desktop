# Plan: RG-DESKTOP-GUI-SCAFFOLD-001 — Electron desktop GUI scaffold for RelayGate

**Created:** 2026-05-02T13:30:00Z
**Owner:** orchestrator (Claude Opus 4.7) → will dispatch Sonnet subagents per Section M
**Spec source:** user directive "build desktop gui, use puppeteer" (2026-05-02), this scope session
**Estimated effort:** 6h total — 2h scaffold (this task), 1h Cloud Build, 1h Puppeteer smoke, 1h Codex review + fixes, 1h docs + push
**Target branch:** `main` of new repo (initial commit), then `dev` for ongoing work per Operating Principle 7

## Goal

Stand up a working cross-platform Electron desktop app for RelayGate that:
1. Opens a native window pointing at `https://app.relaygate.ai` (the SaaS dashboard from `relaygate-app` repo).
2. Builds for linux-amd64, linux-arm64, darwin-amd64, darwin-arm64, windows-amd64 via Cloud Build, publishing to `gs://relayone-488319-public/relaygate-desktop/{COMMIT_SHA}/...` (matching W242 convention at `plans/codex-jobs/multi-platform-binaries-veritize-relaygate-coder1-relayone-w242/PROOFS.md:117-121`).
3. Is verified end-to-end with Puppeteer-core: launch → connect via CDP → screenshot dashboard → assert non-empty rendered DOM.

The desktop GUI is a sibling product to the `relaygate-app` Next.js SaaS dashboard and the `RelayOne/relaygate` Go gateway binary — all three are part of RelayGate, distinct surfaces.

## Success criteria

- [ ] Repo scaffolded at `/home/eric/repos/relaygate-desktop` with valid `package.json`, `tsconfig.json`, `electron-builder.yml`.
- [ ] `npm install` succeeds with no errors.
- [ ] `npm run typecheck` (i.e. `tsc --noEmit -p tsconfig.json`) passes with zero errors.
- [ ] `npm run build` produces compiled main process at `dist/main.js`.
- [ ] `npm run start` launches Electron and displays the live `app.relaygate.ai` page (verified by Puppeteer screenshot in subsequent task).
- [ ] `electron-builder` config supports linux (AppImage + deb), darwin (dmg, x64 + arm64), windows (nsis).
- [ ] No `TODO`/`FIXME`/`XXX`/`HACK`/`STUB`/`@ts-ignore`/`# noqa` in committed code (Section B grep clean).
- [ ] Plan file (this file) exists with mtime predating the first git commit's authored time (Section N.2).
- [ ] Progress log appends events as they happen (Section N.3) — not retroactively.
- [ ] Sonnet ↔ Codex review loop runs minimum 2 rounds with verbatim transcript stored at `.work/reviews/RG-DESKTOP-GUI-SCAFFOLD-001.review.md`.
- [ ] No GitHub push (deferred to a separate task with its own TRIPWIRE).

## Files in scope

All files in the new repo `/home/eric/repos/relaygate-desktop/`:
- `package.json` — Electron 35, electron-builder 25, TypeScript 5, puppeteer-core (dev)
- `tsconfig.json` — strict TS, target ES2022, module nodenext, outDir `dist/`
- `.gitignore` — `node_modules/`, `dist/`, `release/`, `*.log`, `.env*`, `.DS_Store`
- `.nvmrc` — `20.18.1`
- `electron-builder.yml` — appId `ai.relaygate.desktop`, productName `RelayGate`, output `release/`, multi-platform targets
- `src/main.ts` — main process entry: app.whenReady → createWindow → BrowserWindow loadURL https://app.relaygate.ai → app lifecycle handlers
- `src/preload.ts` — minimal stub exporting safe API via contextBridge (placeholder for future native features)
- `assets/icon.png` — 1024×1024 placeholder solid-color PNG (electron-builder derives ICO/ICNS)
- `tests/smoke.test.ts` — Puppeteer-core via CDP (full impl deferred to RG-DESKTOP-GUI-PUPPETEER-002 task; this commit includes scaffold only)
- `cloudbuild.yaml` — placeholder header in this commit; full multi-platform build deferred to RG-DESKTOP-GUI-CLOUDBUILD-003
- `README.md` — what it is, dev commands, build commands, distribution layout
- `CLAUDE.md` — repo-specific commands + structure for future Claude sessions
- `.work/plans/RG-DESKTOP-GUI-SCAFFOLD-001.plan.md` — this file
- `.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log` — append-only event log

## Files explicitly out of scope (do not touch)

- `/home/eric/repos/relaygate-app/**` — separate repo, separate concern. The Next.js SaaS dashboard does not gain anything from this scaffold task. Modifying it here would muddy the desktop diff.
- `/home/eric/repos/RelayOne/apps/agent-desktop/**` — referenced as precedent only; do not modify or copy verbatim (different product).
- `/home/eric/repos/sites/relaygate/downloads/index.html` — marketing site downloads page; will be updated in a separate task once binaries are published, not now.
- Any GitHub repo — local-only this task. Push gets its own TRIPWIRE in RG-DESKTOP-GUI-PUSH-005.
- Any GCP infra (Secret Manager, IAM, Cloud Build triggers) — none touched in scaffold; new bucket path `gs://relayone-488319-public/relaygate-desktop/` already exists by convention from W242 (just unused so far).

## Other-dev impact check

- New repo, no existing files to touch. `git log --since="7 days ago"` is N/A (no history).
- No conflicts expected — fully additive, sibling repo.

## Dependencies

- None for this task (foundational scaffold).
- Downstream tasks depend on this:
  - RG-DESKTOP-GUI-CLOUDBUILD-003 (Cloud Build YAML) — needs `electron-builder.yml` from this task.
  - RG-DESKTOP-GUI-PUPPETEER-002 (Puppeteer smoke) — needs `npm run start` working from this task.
  - RG-DESKTOP-GUI-PUSH-005 (GitHub push) — needs scaffold + tests + cloudbuild done.
  - RG-DESKTOP-GUI-DOCS-006 (downloads page update on `sites/relaygate`) — needs published binaries.

## Risks / unknowns

- **Risk:** Electron 35 may have peer-dep conflicts with TypeScript 5.7. **Mitigation:** match RelayOne Agent Desktop's exact pinned versions (`electron@^35.7.5`, `electron-builder@^25.1.8`, `typescript@^5.7.3`), which we know works.
- **Risk:** `app.relaygate.ai` may serve a `Content-Security-Policy` header that breaks Electron. **Mitigation:** start without modifying request headers; if CSP blocks load, configure `session.defaultSession.webRequest.onHeadersReceived` to relax `frame-ancestors` for the Electron protocol, document the change.
- **Risk:** Icon asset format. electron-builder requires PNG ≥256×256 for Linux. **Mitigation:** generate 1024×1024 PNG via ImageMagick (`convert -size 1024x1024 xc:'#FF6027' assets/icon.png`); refine in a later task with a real designed icon.
- **Risk:** `nodeIntegration: false` + `contextIsolation: true` + `sandbox: true` is required for security but may break some web app features. **Mitigation:** these are the secure defaults; if the dashboard at `app.relaygate.ai` needs anything special, surface it via preload `contextBridge` exposed APIs; do not weaken the sandbox.
- **Unknown:** does the dashboard at `app.relaygate.ai` work in a non-Chrome user agent? Electron uses Chromium so should be compatible. Will verify in RG-DESKTOP-GUI-PUPPETEER-002.

## Proof plan

Per Section C, every success criterion gets specific reproducible proof:
- **Scaffold exists:** `git log` on the new repo + `find . -type f | head -30` listing.
- **`npm install` succeeds:** exit code 0 + tail of `npm install` output (saved to `.work/logs/npm-install.log`).
- **`npm run typecheck` passes:** exact command + exit code 0 (saved to `.work/logs/typecheck.log`).
- **`npm run build` produces dist/main.js:** `ls -la dist/main.js` showing non-zero size.
- **`npm run start` launches Electron showing live page:** verified in RG-DESKTOP-GUI-PUPPETEER-002 — Puppeteer screenshot saved to `tests/artifacts/smoke-2026-05-02.png` + page.title() captured.
- **electron-builder config valid:** `npx electron-builder --help-config` (or dry-run) produces no errors.
- **Section B grep clean:** `git diff` of initial commit grepped for forbidden patterns; counts logged.
- **Codex review converges:** `.work/reviews/RG-DESKTOP-GUI-SCAFFOLD-001.review.md` shows ≥2 rounds with final OK + orchestrator spot-check.

## Rollback plan

If the scaffold turns out to have a fundamental problem (e.g., Electron 35 incompatibility, CSP blocks `app.relaygate.ai` and can't be relaxed safely, electron-builder cross-platform build fundamentally broken):
- `rm -rf /home/eric/repos/relaygate-desktop` — fully reversible since nothing pushed to GitHub.
- No GCP resources to undo (no triggers created, no buckets used yet).
- Original `relaygate-app` repo and current `claude/ci-session-route-2026-05-02` branch unaffected.
- Document the failure mode in `.work/recovery/RG-DESKTOP-GUI-SCAFFOLD-001.recovery.md` before deletion.

---

## Scope changes (append-only — original sections preserved above)

### 2026-05-02T14:34Z — mac DMG → mac zip (cross-compile)

The original Goal listed "darwin (dmg, x64 + arm64)" as a cross-platform target. Cloud Build pipeline runs on Linux only; macOS DMG creation requires a macOS host. Switched mac target in `electron-builder.yml` from `dmg` → `zip` so unsigned `.app` bundles inside `.zip` can be cross-compiled from `electronuserland/builder:wine-mono`. Users mount the zip and run the `.app` (Gatekeeper warning on first launch — `xattr -dr com.apple.quarantine`). Signed DMG distribution tracked separately as `RG-DESKTOP-GUI-MAC-DMG-FOLLOWUP` and requires a macOS Cloud Build runner.

### 2026-05-02T14:18Z — "no GitHub push" criterion overridden

Original plan included "No GitHub push (deferred to a separate task with its own TRIPWIRE)." After the user directive at ~14:15 ("do not ask/do scope-reducing things — build/do/test/confirm FULL only"), GitHub push was authorized in-flight. Repo pushed to `RelayOne/relaygate-desktop` (public). Subsequent commits push directly to `origin/main`. TRIPWIRE for the push was issued before execution.

### 2026-05-02T14:24Z — Cloud Build trigger inlined via `gcloud builds submit`

Original plan envisioned registering a Cloud Build trigger on the GitHub repo. After authorization to "build full", the build was triggered directly via `gcloud builds submit --config cloudbuild.yaml` against the local source tarball. Same artifacts, same publish path; trigger registration deferred to follow-up.

### 2026-05-02T14:42Z — personal-verify rule extended

Plan asked for `npm run start` launch verification via Puppeteer (RG-DESKTOP-GUI-PUPPETEER-002 follow-up). Per "FULL" directive, the orchestrator personally:
- Downloaded all 9 published binaries to `.work/proof/binaries/`
- Verified all 9 sha256 sums against `SHA256SUMS.txt`
- Verified all 9 `file <bin>` formats
- Extracted the Linux x86_64 AppImage and ran the inner electron with `--remote-debugging-port=9224` — confirmed the binary boots, opens a window, loads `https://app.relaygate.ai`, and the dashboard target is visible via CDP.

### 2026-05-02T14:51Z — Codex Round 1 BLOCK addressed in src/main.ts

In response to Codex Round 1 BLOCK + CONCERN findings:
- `new URL(env)` throw guard: added `resolveDashboardUrl()` with try/catch + protocol allowlist + fallback to `https://app.relaygate.ai`.
- Popup host allowlist: replaced "any http/https → openExternal" with `EXTERNAL_LINK_ALLOWLIST` containing relaygate.ai, app.relaygate.ai, docs.relaygate.ai, github.com, accounts.google.com, stripe.com, billing.stripe.com.
- `will-navigate` URL parse guard added (preventDefault on unparseable URLs).
- `did-fail-load` listener added for stderr diagnostics.

Smoke assertions strengthened: title must include "relaygate", body must include "sign in", body min 60 chars, final URL origin must match expected origin (not just startsWith string).
