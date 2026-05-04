<!-- STATUS: in-progress -->
<!-- TYPE: repair -->
<!-- CREATED: 2026-05-04 -->
<!-- BUILD_STARTED: 2026-05-04 -->
<!-- DEPENDS_ON: none -->
<!-- BUILD_ORDER: 1 -->

# Infra + Docs Cleanup — Implementation Spec

## Overview

Three small, related cleanups closing out the post-DMG-shipping phase: (1) `.gitignore` is missing `*.dmg` under `.work/proof/binaries/` so a careless `git add .work/` would commit ~200MB of unsigned DMG; (2) `docs/{README,ARCHITECTURE,HOW-IT-WORKS,FEATURE-MAP,DEPLOYMENT,BUSINESS-VALUE}.md` are still template scaffolds with no project content despite a fully-shipping 3-platform CI; (3) repo-level `CLAUDE.md` lists `npm test` and `npm run lint` commands that don't exist in `package.json`. All three are infra/docs polish — no application code changes. Builds in one logical phase, one commit per finding.

## Stack & Versions

- Project: relaygate-desktop, Electron 35.x desktop GUI wrapping `https://app.relaygate.ai`
- Node: 20.18.1 (per `.nvmrc`)
- TypeScript: 5.7.3
- electron-builder: 25.1.8
- CI: Google Cloud Build (`cloudbuild.yaml` for Linux/Win cross-compile + DMG via libdmg-hfsplus userspace; `cloudbuild-mac.yaml` for future macOS host runners)
- Artifact hosting: `gs://relayone-488319-public/relaygate-desktop/{COMMIT_SHA}/` and `/latest/`

## Existing Patterns to Follow

- Root `README.md` — already filled, accurate, this is the reference doc style
- `docs/MAC_BUILD.md` — already filled (4KB), reference for what a "real" doc looks like in this repo
- `specs/QUICKSTART.md` and `specs/TEMPLATE.md` — scope spec patterns
- Origin allowlist: `src/main.ts:27-69` — exact origins + suffix matching

## Library Preferences

- N/A (no code changes; doc + config only)

## Boundaries — What NOT To Do

- Do NOT modify any `src/**/*.ts`, `tests/**/*.ts`, `electron-builder*.yml`, `cloudbuild*.yaml`, or `package.json`
- Do NOT touch `docs/MAC_BUILD.md` (already real content)
- Do NOT touch root `README.md` (already real content) — but DO `cp README.md docs/README.md` per the project doc rule that root is canonical and `docs/README.md` mirrors it
- Do NOT introduce a CONTRIBUTING.md, CODE_OF_CONDUCT.md, ISSUE_TEMPLATE, or similar — out of scope
- Do NOT add new dependencies, lint configs, or test framework migrations
- Do NOT propose or implement code signing, notarization, auto-update, or native gateway control panel features — those are explicitly deferred per scope decision
- Do NOT change anything under `.work/`, `release/`, `dist/`, `node_modules/`

## Acceptance Criteria

- WHEN a developer runs `git status` after a fresh `npm run dist:mac` THE SYSTEM SHALL not show `.work/proof/binaries/*.dmg` as untracked
- WHEN a developer or AI agent reads `docs/README.md` THE SYSTEM SHALL learn what RelayGate Desktop is, how to build it, and where artifacts ship — without reading source code
- WHEN a developer reads `docs/ARCHITECTURE.md` THE SYSTEM SHALL describe the actual architecture (Electron main process, preload bridge, origin allowlist, build pipeline, no renderer code) — not a generic template
- WHEN a developer reads `docs/HOW-IT-WORKS.md` THE SYSTEM SHALL walk through what a user does (download → install → launch → see dashboard) AND what happens technically at each step (electron-builder artifact → OS install → main.ts createMainWindow → loadURL → will-navigate filter)
- WHEN a developer reads `docs/FEATURE-MAP.md` THE SYSTEM SHALL list every shipping feature with its benefit and status (Done / In Progress / Scoped / Scoping / Horizon), and call out the deliberately-deferred items (signing, auto-update, native gateway control panel)
- WHEN a developer reads `docs/DEPLOYMENT.md` THE SYSTEM SHALL describe the Cloud Build pipeline (both `cloudbuild.yaml` and `cloudbuild-mac.yaml`), the GCS artifact paths, the SHA256SUMS verification flow, and how to release a new version
- WHEN a non-technical reader reads `docs/BUSINESS-VALUE.md` THE SYSTEM SHALL pitch RelayGate Desktop in marketing language with zero jargon — who it's for, what it does, how it differs from "just open a browser tab"
- WHEN Claude harness runs in this repo and reads `CLAUDE.md` THE SYSTEM SHALL find only commands that actually exist in `package.json`

## Implementation Checklist

Each item is independently committable. One commit per item. Use the exact commit message under each.

### 1. [ ] F1 — Add `*.dmg` to `.work/proof/binaries/` ignore list

**File:** `/home/eric/repos/relaygate-desktop/.gitignore`

**Current state (lines 14-22):**
```
tests/artifacts/
.work/recovery/
.work/proof/binaries/*.AppImage
.work/proof/binaries/*.deb
.work/proof/binaries/*.zip
.work/proof/binaries/*.exe
!.work/proof/binaries/SHA256SUMS.txt
.claude/
.claude-config/
```

**Change:** Insert `.work/proof/binaries/*.dmg` immediately after `.work/proof/binaries/*.exe` and before `!.work/proof/binaries/SHA256SUMS.txt`. Keep the negation rule for SHA256SUMS as the last entry in that block.

**Validate:**
```bash
# Should produce no output (DMGs were just deleted; this confirms a future
# DMG would also be ignored):
touch .work/proof/binaries/probe.dmg
git status --porcelain | grep -F 'probe.dmg' && echo FAIL || echo PASS
rm .work/proof/binaries/probe.dmg
```

**Commit message:**
```
chore(gitignore): exclude .work/proof/binaries/*.dmg

Pattern list ignored AppImage/deb/zip/exe but missed dmg. DMG support
landed in commit de082d2 (mac CI) without a matching gitignore update,
so a careless `git add .work/` could commit ~200MB of unsigned DMG.
```

**STATUS line to write:** `STATUS: FIXED (commit: <sha>)`

---

### 2. [ ] F3 — Replace placeholder commands in repo `CLAUDE.md`

**File:** `/home/eric/repos/relaygate-desktop/CLAUDE.md`

**Current `## Commands` section:**
```bash
# EDIT THESE:
# build:     npm run build
# test:      npm test
# lint:      npm run lint
# typecheck: npx tsc --noEmit
```

**Replace with the actual commands from `package.json`:**
```bash
# build:        npm run build              # tsc -p tsconfig.json -> dist/
# typecheck:    npm run typecheck          # tsc --noEmit
# start (dev):  npm run start              # electron .
# watch:        npm run dev                # tsc -w
# smoke test:   npm run test:smoke         # builds + Puppeteer-CDP smoke
# pack (no installer): npm run pack
# dist (all):   npm run dist
# dist:linux | dist:mac | dist:win
```

**Also update `## Structure` section** — current text says "Monorepo. Per-package CLAUDE.md..." which is wrong for this single-package repo. Replace with:

```
- Single-package Electron app. Entry point `src/main.ts` (main process), `src/preload.ts` (contextBridge).
- Build output: TypeScript -> `dist/` -> electron-builder packs into `release/`.
- CI cross-compiles linux+win+mac.zip from Linux; DMG via libdmg-hfsplus userspace in same Linux pipeline.
- No renderer code in this repo — Electron loads the live dashboard at `https://app.relaygate.ai`.
```

**Leave the `## Docs`, `## Compaction`, `## Rules` sections unchanged** — they're correct.

**Validate:**
```bash
# Every command listed must exist in package.json scripts:
grep -E '^# [a-z]' CLAUDE.md | sed -E 's/^# [a-z][a-z:]*[a-z]: +npm run ([a-z:]+).*/\1/' | while read cmd; do
  jq -e ".scripts[\"$cmd\"]" package.json > /dev/null || echo "MISSING: $cmd"
done
# Expected output: no MISSING lines
```

**Commit message:**
```
chore(claude-md): replace placeholder commands with real package.json scripts

CLAUDE.md was scaffolded with `npm test` and `npm run lint` which don't
exist in package.json. Replaced with actual scripts (build, typecheck,
start, dev, test:smoke, pack, dist, dist:linux|mac|win) and corrected
"Monorepo" wording to reflect single-package layout.
```

**STATUS line to write:** `STATUS: FIXED (commit: <sha>)`

---

### 3. [ ] F2a — Rewrite `docs/README.md`

**File:** `/home/eric/repos/relaygate-desktop/docs/README.md`

**Source of truth:** root `README.md` is canonical. Per CLAUDE.md "ROOT README.md IS THE PRIMARY DOCUMENT". This file should be a copy of root `README.md` with no edits.

**Action:**
```bash
cp README.md docs/README.md
```

**Verify:**
```bash
diff -u README.md docs/README.md
# Expected: no diff
```

**Do NOT** add a separate "documentation index" section here — the root README already lists docs further down via implicit linking. If we later want a docs hub page, that's a separate decision.

**This step does not require its own commit.** Bundle with step 4 (FEATURE-MAP) since FEATURE-MAP is the related "front-page" doc.

---

### 4. [ ] F2b — Rewrite `docs/FEATURE-MAP.md`

**File:** `/home/eric/repos/relaygate-desktop/docs/FEATURE-MAP.md`

**Required content:** verbose feature inventory grouped by domain. Each row: feature, benefit (lead with user outcome, not tech), status, link to spec or "—".

**Status taxonomy (use exactly these strings):**
- **Done** — shipping
- **In Progress** — actively being built
- **Scoped** — spec written, ready to build
- **Scoping** — being researched / specced
- **Horizon** — potential / aspirational, not committed

**Domains and rows to include (DERIVE from current code + git log + cloudbuild yaml — every row below is a fact in the repo today):**

#### Distribution

| Feature | Benefit | Status | Spec |
|---|---|---|---|
| Linux AppImage (x64+arm64) | Single-file portable install on any modern Linux distro | Done | `electron-builder.yml` |
| Linux .deb (x64+arm64) | One-click install on Debian/Ubuntu derivatives | Done | `electron-builder.yml` |
| Windows nsis installer (x64) | Familiar Windows installer with directory choice and per-user install | Done | `electron-builder.yml` |
| macOS .zip (x64+arm64) | Drag-the-.app install path, cross-compiled from Linux CI | Done | `electron-builder.yml` |
| macOS .dmg (x64+arm64), unsigned | Standard macOS distribution medium with mounted volume + Applications symlink | Done | `cloudbuild.yaml` (libdmg-hfsplus) |
| macOS .dmg, signed + notarized | No "unidentified developer" Gatekeeper warning on user install | Horizon | — (requires Apple Developer Program enrollment, $99/yr) |
| Windows nsis installer, signed | No SmartScreen warning on user install | Horizon | — (requires EV code signing certificate) |
| Auto-update (`electron-updater`) | Users get bug fixes and security patches without re-downloading | Horizon | — |

#### Application shell

| Feature | Benefit | Status | Spec |
|---|---|---|---|
| Live dashboard wrapper | One window app — no browser tab juggling, no losing the tab among 60 others | Done | `src/main.ts` |
| Cross-platform native menu | Standard OS menus (File/Edit/View/Help) with platform-correct mac App menu | Done | `src/main.ts:142-204` |
| Configurable backend URL | Devs can point the app at local/staging via `RELAYGATE_DESKTOP_URL` | Done | `src/main.ts:6-22` |
| Build SHA exposed at runtime | Users can report exact build version when filing bugs | Done | `src/preload.ts` (`window.relaygate.version`) |
| Native gateway control panel | Manage local `relaygate` CLI gateway (start/stop, view logs, edit config) without leaving the app | Horizon | — (per root README "Future releases may add...") |
| OS notifications | Get notified of relay events without keeping the window focused | Horizon | — |
| System tray icon | Quick access to start/stop relay gateway from the menu bar | Horizon | — |

#### Security

| Feature | Benefit | Status | Spec |
|---|---|---|---|
| `contextIsolation: true` + `sandbox: true` + `nodeIntegration: false` | Renderer cannot reach Node APIs even if the dashboard JS is compromised | Done | `src/main.ts:88-94` |
| Origin allowlist for window-open | Phishing links inside the dashboard cannot redirect the desktop window to attacker-controlled origins | Done | `src/main.ts:27-69` |
| `will-navigate` off-origin filter | Off-domain navigation only happens via `shell.openExternal` (system browser), never inside the Electron window | Done | `src/main.ts:111-130` |
| Webview tag blocked | No way for embedded web content to load attacker-controlled iframes with elevated privileges | Done | `src/main.ts:225-227` |
| HTTPS-only allowlist enforcement | Mixed-content downgrade attacks blocked at the navigation layer | Done | `src/main.ts:55-69` |

#### CI / Build infrastructure

| Feature | Benefit | Status | Spec |
|---|---|---|---|
| GitHub auto-trigger -> Cloud Build | Every push to main produces signed, hashed artifacts in GCS without manual builds | Done | `cloudbuild.yaml` |
| Cross-compile matrix (linux x4, mac.zip x2, mac.dmg x2, win x1) | One CI run produces all 9+ artifacts; engineers don't need a Mac to ship Mac builds | Done | `cloudbuild.yaml` |
| SHA256SUMS publication | Users can verify download integrity before installing | Done | `cloudbuild.yaml:publish` |
| GCS `latest/` mirror | Stable download URL that always points at the most recent main build | Done | `cloudbuild.yaml:publish` |
| macOS host runner pipeline (signed/notarized DMG) | Future ability to ship signed builds via SSH-tunneled mac mini / MacStadium | Scoped | `cloudbuild-mac.yaml` (skeleton in place, secrets pending) |

#### Testing

| Feature | Benefit | Status | Spec |
|---|---|---|---|
| Puppeteer-CDP smoke test | Catch regressions where the dashboard fails to render in our exact Electron+Chromium build | Done | `tests/smoke.test.ts` |
| Live-dashboard regression suite | Catches if `app.relaygate.ai` ships a change that breaks the desktop wrapper (signin, dashboard, mobile, SEO checks) | Done | `tests/live-dashboard.test.ts` |
| CI-integrated test run | Smoke tests gate every Cloud Build — broken builds never publish | Horizon | — (currently smoke runs locally only) |

**Footer:**
```
---
*Last updated: 2026-05-04*
```

**This file is the source of truth for "what is built / planned." Every other doc references it.** Write VERBOSE — each row's "Benefit" field should be a complete user-outcome sentence, never a feature restatement.

**Commit message (combined with step 3):**
```
docs(readme,feature-map): mirror root README to docs/ + verbose feature inventory

docs/README.md is now a verbatim copy of root README.md (root is canonical
per CLAUDE.md). docs/FEATURE-MAP.md replaces template scaffold with a
domain-grouped table covering distribution, application shell, security,
CI, and testing — every row sourced from current code or git log.
```

**STATUS line to write:** `STATUS: FIXED (commit: <sha>)`

---

### 5. [ ] F2c — Rewrite `docs/ARCHITECTURE.md`

**File:** `/home/eric/repos/relaygate-desktop/docs/ARCHITECTURE.md`

**Audience:** developer joining this repo. Should be enough to make code changes without spelunking. WRITE VERBOSE — short docs are lazy docs. Target ≥150 lines.

**Required sections (in order):**

1. **Overview** (1 paragraph) — RelayGate Desktop is an Electron 35 thin wrapper around the live dashboard. No renderer code lives in this repo. The wrapper provides native OS integration (menus, install paths, OS-correct window chrome) and a hardened security perimeter (origin allowlist, sandboxed renderer, no Node access from web content).

2. **Tech Stack** — table:
   - Runtime: Electron 35.7.5
   - Language: TypeScript 5.7.3
   - Node toolchain: Node 20.18.1
   - Packager: electron-builder 25.1.8
   - Test runner: tsx 4.21 + puppeteer-core 23.10 (CDP attach)
   - CI: Google Cloud Build (E2_HIGHCPU_8, 30min timeout)
   - Artifact hosting: GCS bucket `relayone-488319-public`

3. **Repository Map** — annotated tree. Use the exact tree from root README but go deeper, calling out:
   - `src/main.ts` — Electron main process: window creation, URL guard, navigation filter, menu, lifecycle handlers
   - `src/preload.ts` — contextBridge exposing `window.relaygate.{version, platform, arch}`
   - `tests/smoke.test.ts` — minimal CDP-attached render check
   - `tests/live-dashboard.test.ts` — fuller regression suite against `app.relaygate.ai` (signin, dashboard, SEO, mobile)
   - `electron-builder.yml` — shared cross-platform packager config (Linux + Win + mac.zip)
   - `electron-builder.mac.yml` — extends shared config with DMG target for macOS-host builds
   - `cloudbuild.yaml` — Linux Cloud Build pipeline (cross-compiles all platforms incl. unsigned DMG)
   - `cloudbuild-mac.yaml` — future macOS-host pipeline scaffold (signed DMG via SSH-tunneled remote runner)
   - `assets/icon.png` — 1024×1024 source; electron-builder derives platform icons (.ico, .icns)
   - `.work/` — local proof binaries, recovery state, build logs (mostly gitignored)

4. **System Components** — for each, what it does + what it talks to + where it lives:
   - **Main process** (`src/main.ts`) — owns the BrowserWindow lifecycle. Talks to: OS (menu, shell, window chrome), preload bridge, the loaded dashboard URL.
   - **Preload bridge** (`src/preload.ts`) — runs in an isolated context with limited Node access. Exposes a tiny read-only surface (`window.relaygate.{version, platform, arch}`) to the renderer via contextBridge. Talks to: renderer (one direction only — exposes data, accepts no inbound calls in current design).
   - **Renderer** — runs entirely under `https://app.relaygate.ai` (or `RELAYGATE_DESKTOP_URL` override). Source lives in `RelayOne/relaygate-app` repo, NOT here.
   - **electron-builder** — produces platform installers from compiled `dist/` + `package.json`. Reads `electron-builder.yml` for shared config + `electron-builder.mac.yml` when packaging DMG.
   - **Cloud Build** — orchestrator. Runs `npm ci`, `npm run typecheck`, `npm run build`, `electron-builder` cross-compile, libdmg-hfsplus DMG step, and GCS publish.

5. **Data Models** — explicitly: this repo has no database, no persisted state, no data models. The Electron app is stateless across launches (cookie/session storage is owned by Chromium per its standard cache directory). `package.json:version` and `process.env.npm_package_version` are the only "data" the wrapper holds.

6. **API Surface** — explicitly: this repo exposes no APIs. The renderer talks to `app.relaygate.ai` over HTTPS. The preload bridge exposes a read-only `window.relaygate` object — list its three fields and their types.

7. **Execution Flow** — narrate a launch:
   - User runs the installed app -> OS launches `Electron` binary
   - `app.whenReady()` fires -> `buildAppMenu()` + `createMainWindow()`
   - `BrowserWindow` constructed with `contextIsolation`, `sandbox`, `nodeIntegration: false`, preload path resolved to `dist/preload.js`
   - `setWindowOpenHandler` + `will-navigate` listeners attached to filter URLs against `EXTERNAL_ORIGIN_ALLOWLIST` and `ALLOWED_HOST_SUFFIXES`
   - `win.loadURL(DASHBOARD_URL)` -> Chromium fetches the dashboard
   - Preload runs, calls `contextBridge.exposeInMainWorld("relaygate", desktopBridge)`
   - Dashboard renders, `ready-to-show` -> `win.show()`
   - User interactions: dashboard JS calls dashboard API directly (no Electron involvement); off-origin links route through `shell.openExternal` to system browser

8. **Infrastructure** — the deployment side:
   - Source: GitHub `RelayOne/relaygate-desktop`
   - CI: Cloud Build trigger on push to main (configured per closeout commit `e1b12fa`)
   - Artifacts: `gs://relayone-488319-public/relaygate-desktop/{COMMIT_SHA}/` + `/latest/`
   - SHA256SUMS published alongside artifacts
   - No staging/prod split — every artifact is built unsigned; signing is gated by Apple Developer / EV cert provisioning

9. **Type System / Validation** — TypeScript strict mode (per `tsconfig.json` — assert if not yet, follow up). All env-var reads (`RELAYGATE_DESKTOP_URL`) parse via `new URL()` with try/catch + safe fallback to default origin. No Zod (overkill for one env var). Validation happens at exactly two places: env-var read in `resolveDashboardUrl` and per-URL check in `isAllowedExternalOrigin`.

10. **Testing Architecture** — two test files, both end-to-end via Puppeteer-CDP:
    - `smoke.test.ts` — builds the app, launches Electron with `--remote-debugging-port`, attaches CDP, asserts non-empty DOM, screenshots to `tests/artifacts/`
    - `live-dashboard.test.ts` — broader regression on signup, signin, dashboard render, mobile viewport, SEO meta — runs against the live `app.relaygate.ai`
    - No unit tests — the wrapper has very little pure logic; the bulk of behavior is integration with Electron + Chromium + the live dashboard
    - Tests run locally (not yet wired into Cloud Build — flagged Horizon in FEATURE-MAP)

11. **Footer:** `*Last updated: 2026-05-04*`

**Commit message (combined with step 6):**
```
docs(architecture,how-it-works): replace scaffolds with real codebase docs

ARCHITECTURE.md now describes Electron main process, preload bridge,
origin allowlist, build pipeline, and CI flow — sourced from current
src/, tests/, electron-builder*.yml, cloudbuild*.yaml. HOW-IT-WORKS.md
walks the user journey from download through dashboard render with
technical detail at each step.
```

**STATUS line to write:** `STATUS: FIXED (commit: <sha>)`

---

### 6. [ ] F2d — Rewrite `docs/HOW-IT-WORKS.md`

**File:** `/home/eric/repos/relaygate-desktop/docs/HOW-IT-WORKS.md`

**Audience:** technical reader who wants to understand the product from a user's seat. Both the user-visible and the under-the-hood view. Target ≥120 lines.

**Required sections:**

1. **User Journey** — narrative, 5-7 numbered steps, written second-person:
   - **Step 1: Download.** User visits `https://relaygate.ai/desktop` (or the GitHub release page) and picks their platform. Behind the scenes: their browser fetches from `gs://relayone-488319-public/relaygate-desktop/latest/` — the GCS mirror that always points at the most recent main build.
   - **Step 2: Verify.** User downloads `SHA256SUMS.txt` alongside the binary and verifies the checksum (`sha256sum -c SHA256SUMS.txt --ignore-missing`). Optional but recommended for unsigned builds.
   - **Step 3: Install.** Linux: `chmod +x *.AppImage && ./RelayGate-*.AppImage` or `sudo dpkg -i RelayGate-*.deb`. Mac: open `.dmg`, drag RelayGate.app to Applications. Windows: run `RelayGate-Setup-*.exe`, click through the nsis installer.
   - **Step 4: First launch.** Mac/Win unsigned: user dismisses Gatekeeper / SmartScreen warning (right-click -> Open on Mac, "More info" -> "Run anyway" on Win). This goes away when signing ships (FEATURE-MAP horizon row).
   - **Step 5: See dashboard.** App opens to a 1280×840 window titled "RelayGate." The window background is dark (`#0b0b0d`) to avoid the white flash before the dashboard loads. Within ~1s, the live RelayGate dashboard renders inside.
   - **Step 6: Use.** All interactions — login, viewing usage, managing API keys, billing — happen in the embedded dashboard. No different from `app.relaygate.ai` in a browser tab, but with a dedicated window, a Dock/taskbar entry, and OS-correct menus.
   - **Step 7: Quit.** Mac: standard `Cmd-Q` or close-window-keeps-app-running behavior. Linux/Win: closing the window quits the app (`window-all-closed -> app.quit()` except on darwin).

2. **Technical Overview** — for each user-visible step above, what the code does:
   - Step 1 download: covered in DEPLOYMENT.md (CI -> GCS publish flow)
   - Step 3 install: electron-builder produces native installers from compiled `dist/`. Linux .deb registers a `.desktop` file under `/usr/share/applications/`. Mac .dmg mounts a volume with the `.app` bundle and an `Applications` symlink (drag-target). Win nsis writes to `%LOCALAPPDATA%\Programs\RelayGate\` (per-user install per `electron-builder.yml:nsis.perMachine: false`).
   - Step 5 first render: `app.whenReady()` -> `buildAppMenu()` -> `createMainWindow()`. `BrowserWindow` constructed with strict webPreferences. `setWindowOpenHandler` and `will-navigate` listeners attached. `win.loadURL(DASHBOARD_URL)` where `DASHBOARD_URL` is parsed from `RELAYGATE_DESKTOP_URL` env or defaults to `https://app.relaygate.ai`.
   - Step 6 interactions: dashboard JS makes XHR/fetch calls to its own API (`api.relaygate.ai`). Electron is invisible to the dashboard except for the `window.relaygate` bridge (version/platform/arch read-only). Off-origin links: dashboard fires `target=_blank` -> `setWindowOpenHandler` checks origin against allowlist -> if allowed, `shell.openExternal` opens system browser; if not, deny silently with a stderr log.
   - Step 7 quit: standard Electron lifecycle. `app.on('window-all-closed')` quits non-darwin platforms, leaves mac running per platform convention.

3. **System Flow Diagram (ASCII)** — show the data flow:
```
   User clicks link in dashboard
        |
        v
   Dashboard JS fires window.open or follows <a target=_blank>
        |
        v
   Electron main process: setWindowOpenHandler({ url })
        |
        +---> isAllowedExternalOrigin(url)?
        |          |
        |          +-- yes -> shell.openExternal(url)  -> system browser
        |          |
        |          +-- no  -> stderr log, return { action: "deny" }
        |
        v
   New BrowserWindow NEVER created (always returns deny)
```

4. **Key Technical Decisions** — bullet list with one paragraph each:
   - **Why Electron, not Tauri/Wails?** — Electron's Chromium is the same engine as the dashboard's primary supported browser, so rendering parity is automatic. Tauri uses each OS's webview (WKWebView, WebView2, WebKitGTK), which means bug-for-bug compatibility is harder to guarantee. Wrapper-style apps prioritize fidelity over bundle size.
   - **Why no renderer code in this repo?** — single source of truth. Every dashboard improvement ships to web users and desktop users the moment it deploys to `app.relaygate.ai`. No release coordination between repos. No "desktop is one version behind" support tickets.
   - **Why an origin allowlist?** — defense in depth. Even if the dashboard is XSS'd, an attacker cannot make the desktop window navigate to an attacker origin. `will-navigate` blocks in-window navigation; `setWindowOpenHandler` blocks new windows. Off-allowlist clicks fail closed.
   - **Why HTTPS-only in the allowlist?** — prevents downgrade attacks. A `<a href="http://...">` to an allowlisted origin would silently fail rather than open the user up to MITM.
   - **Why cross-compile DMG from Linux instead of a Mac runner?** — cost. A Mac runner via MacStadium is ~$100/mo idle. libdmg-hfsplus (Mozilla fork) builds a UDIF image from a userspace HFS+ writer in 30 seconds inside the existing Linux Cloud Build job. Tradeoff: unsigned. Signing requires real Mac hosts (Mac Mini in office or MacStadium), tracked as Horizon in FEATURE-MAP.

5. **What's Different About This Approach** — paragraph:

   Most "wrapper" desktop apps either (a) bundle the whole web app into the binary (huge installs, must release to update) or (b) point at a hosted URL but ship insecure (nodeIntegration on, no allowlist, webview tags allowed). RelayGate Desktop does (b) the careful way: Chromium is sandboxed, the renderer has no Node access, the preload bridge is read-only, and every navigation is filtered through an explicit origin list. The result: a thin app (≤170MB installed, vs ≥250MB for bundled-renderer alternatives) that updates instantly when the dashboard ships, with security posture comparable to a hardened browser profile.

6. **Footer:** `*Last updated: 2026-05-04*`

**STATUS line to write:** `STATUS: FIXED (combined with ARCHITECTURE commit)`

---

### 7. [ ] F2e — Rewrite `docs/DEPLOYMENT.md`

**File:** `/home/eric/repos/relaygate-desktop/docs/DEPLOYMENT.md`

**Audience:** developer or release engineer who wants to ship a new build, understand where artifacts live, or set up a fresh CI environment. Target ≥130 lines.

**Required sections:**

1. **Overview** — one paragraph: this repo deploys via two Cloud Build pipelines. `cloudbuild.yaml` runs on every push to main and produces all 9+ artifacts (Linux x4, Win x1, mac.zip x2, mac.dmg x2 unsigned) in a single Linux runner using cross-compile + libdmg-hfsplus. `cloudbuild-mac.yaml` is a future-state pipeline for SSH-tunneled signed/notarized Mac builds — wired but inert until a macOS host is provisioned.

2. **Prerequisites**:
   - GCP project: `relayone-488319` (substitute appropriately if forking)
   - Cloud Build API enabled on the project
   - Cloud Build trigger configured: source = GitHub `RelayOne/relaygate-desktop`, event = push to `main`, config = `cloudbuild.yaml`
   - GCS bucket: `gs://relayone-488319-public/relaygate-desktop/` exists with public-read on the `latest/` and `{sha}/` prefixes
   - Service account on the trigger has `roles/storage.objectAdmin` on the bucket

3. **Environment Variables / Substitutions** — Cloud Build substitutions used:

   | Variable | Source | Purpose |
   |---|---|---|
   | `$COMMIT_SHA` | Cloud Build builtin | Embedded into the app via `--config.extraMetadata.commit=$COMMIT_SHA`; surfaced at runtime as `window.relaygate.commit` (when added) |
   | `$SHORT_SHA` | Cloud Build builtin | GCS path: `gs://.../{SHORT_SHA}/` |
   | `$BUILD_ID` | Cloud Build builtin | GCS path: `gs://.../build-{BUILD_ID}/` (artifact archive) |
   | `$PROJECT_ID` | Cloud Build builtin | Used by mac runner pipeline to fetch SSH key from Secret Manager |
   | `_MAC_RUNNER_HOST` (mac pipeline only) | `--substitutions` flag | Mac host hostname/IP for SSH-tunneled DMG builds |
   | `_MAC_RUNNER_USER` (mac pipeline only) | `--substitutions` flag, default `cloudbuild` | SSH user on mac host |

   No application-side env vars are baked in. `RELAYGATE_DESKTOP_URL` is read at runtime by `src/main.ts` and is NOT part of the build process.

4. **Build (CI)**:
   ```bash
   # Trigger automatically fires on push to main. Manual trigger:
   gcloud builds triggers run relaygate-desktop-main \
     --branch=main --project=relayone-488319
   ```

   Pipeline steps (`cloudbuild.yaml`):
   1. **install** (`node:20`) — `npm ci`
   2. **typecheck** (`node:20`) — `npm run typecheck`
   3. **build-main** (`node:20`) — `npm run build` (tsc -> dist/)
   4. **dist-all-platforms** (`electronuserland/builder:wine-mono`) — `electron-builder --linux --win --mac --x64 --arm64 --config.extraMetadata.commit=$COMMIT_SHA --publish never`. Cross-compiles linux+win+mac.zip in one container that ships wine for Win cross-compile. Embeds commit SHA into the app's `package.json` extra metadata.
   5. **build-mac-dmg** (`ubuntu:22.04`) — clones Mozilla libdmg-hfsplus, builds the userspace `dmg` and `hfsplus` binaries, then for each `mac-*.zip` artifact: unzip -> create raw HFS+ image (3× app size + 200MB buffer to handle Electron Framework allocations) -> `mkfs.hfsplus -v "RelayGate"` -> `hfsplus addall <app>` (userspace, no kernel mount) -> `dmg dmg <img> <out>` to UDIF format. Produces `RelayGate-0.1.0-{x64,arm64}.dmg`.
   6. **publish** (`gcr.io/google.com/cloudsdktool/cloud-sdk:slim`) — for each artifact in `release/{*.AppImage,*.deb,*.exe,*-mac.zip,*.dmg}`: `gcloud storage cp` to both `gs://relayone-488319-public/relaygate-desktop/$SHORT_SHA/<basename>` and `gs://relayone-488319-public/relaygate-desktop/latest/<basename>`. Computes `sha256sum` and appends to `release/SHA256SUMS.txt`. Final assertion: must publish ≥7 artifacts (linux x4, mac.zip x2, mac.dmg x2, win x1+ — exits 1 otherwise).

5. **Build (local)**:
   ```bash
   nvm use                         # node 20.18.1
   npm ci
   npm run typecheck
   npm run build
   npm run dist:linux              # produces release/RelayGate-*.AppImage|.deb
   npm run dist:win                # cross-compile via wine (Linux host) — slower
   npm run dist:mac                # MAC HOST ONLY — uses electron-builder.mac.yml for DMG
   ```

   Output lands in `release/`. Each command is self-contained (`pre`-runs the build).

6. **Mac signed/notarized DMG (future state)** — `cloudbuild-mac.yaml`:
   - Provision a macOS host: Mac mini in office, MacStadium dedicated, MacinCloud daily, etc.
   - SSH key: `gcloud secrets create relaygate-desktop-mac-deploy-key --data-file=mac-deploy-key`
   - On the mac host: install `git`, `node@20`, `xcode-select --install`, configure `~/.zshenv` with `PATH` for `cloudbuild` user
   - Apple Developer secrets in Secret Manager: `apple-developer-id-cert` (.p12 base64), `apple-developer-id-cert-pass`, `apple-id-email`, `apple-app-specific-password`, `apple-team-id`
   - Add a second Cloud Build trigger pointed at `cloudbuild-mac.yaml`, set `_MAC_RUNNER_HOST=<host>` substitution
   - On every push to main: trigger fires, SSHes to mac host, clones repo, runs `npm run dist:mac` (which uses `electron-builder.mac.yml` -> hardenedRuntime + signing if `CSC_LINK`/`CSC_KEY_PASSWORD` are set), scp's the signed `.dmg` back, publishes to GCS
   - Until the mac host exists, the trigger no-ops with `_MAC_RUNNER_HOST` empty (the pipeline checks for empty and exits 0 with a "skipping" message)

7. **Infrastructure**:
   - GCS bucket: public-read for `latest/*` and `{sha}/*` paths
   - Cloud Build: E2_HIGHCPU_8 worker, 1800s timeout
   - No databases, no Cloud Run services, no DNS records owned by this repo

8. **Monitoring & Health**:
   - Cloud Build console: `https://console.cloud.google.com/cloud-build/builds?project=relayone-488319`
   - Verify latest build: `gcloud storage ls gs://relayone-488319-public/relaygate-desktop/latest/`
   - Smoke test the published binary by downloading the platform installer for your dev machine and launching it. Ideally automated as a post-publish job (currently FEATURE-MAP Horizon).
   - SHA256SUMS verification: download a binary + `SHA256SUMS.txt` from the same `{sha}/` prefix, run `sha256sum -c SHA256SUMS.txt --ignore-missing`.

9. **Rollback Procedure**:
   - The `latest/` mirror is overwritten on every successful build, so rollback = republish a known-good `{sha}/` to `latest/`:
     ```bash
     KNOWN_GOOD_SHA=abc1234
     for blob in $(gsutil ls gs://relayone-488319-public/relaygate-desktop/$KNOWN_GOOD_SHA/); do
       base=$(basename "$blob")
       gsutil cp "$blob" "gs://relayone-488319-public/relaygate-desktop/latest/$base"
     done
     ```
   - Users who already installed the bad version: tell them to redownload from the same URL. (When auto-update ships — Horizon — this becomes "publish a previous-release update channel.")

10. **Footer:** `*Last updated: 2026-05-04*`

**Commit message (combined with step 8):**
```
docs(deployment,business-value): describe Cloud Build pipeline + pitch deck

DEPLOYMENT.md walks both cloudbuild.yaml (Linux cross-compile + libdmg-hfsplus
DMG) and cloudbuild-mac.yaml (future SSH-tunneled signed Mac builds), GCS
artifact paths, SHA256SUMS verification, and rollback. BUSINESS-VALUE.md
pitches RelayGate Desktop in marketing language for non-technical readers.
```

**STATUS line to write:** `STATUS: FIXED (commit: <sha>)`

---

### 8. [ ] F2f — Rewrite `docs/BUSINESS-VALUE.md`

**File:** `/home/eric/repos/relaygate-desktop/docs/BUSINESS-VALUE.md`

**CRITICAL:** This doc is for non-technical readers. Marketers, investors, prospective users. Read like a pitch deck. ZERO code, ZERO jargon, ZERO acronyms. Target ≥120 lines, verbose marketing language.

**Required sections:**

1. **The Problem** — paint the picture, 2-3 paragraphs:
   - Modern engineering teams use AI-assisted development tools constantly. Every senior engineer might call OpenAI, Anthropic, Google, or a self-hosted model dozens of times an hour through their IDE, their terminal, their CI scripts.
   - Each of those vendors charges differently, rate-limits differently, and breaks differently. When ChatGPT goes down at 2pm, every developer stops working. When the Anthropic API rate-limit hits during a deploy, the build fails. When a junior engineer accidentally uses a $0.30/request model for a chatbot prototype, the bill arrives at the end of the month and the CFO has questions.
   - Today, the workaround is "manage it manually": every team has a wiki page about which model to use when, every senior dev has their own .env file, and every quarter someone tries to consolidate all this and fails.

2. **Who This Is For** — be specific:
   - Engineering managers at 10-200 person tech companies who want one bill, one rate-limit policy, and one place to set guardrails for all AI spend
   - Solo developers who want to switch between Claude, GPT, and local models without rewriting their code each time
   - Platform teams at larger orgs that need audit trails of which team made which AI request
   - Compliance officers in regulated industries who need to enforce that "no PII goes to public LLMs" — at the network layer, not just by hoping engineers remember

3. **How RelayGate Desktop Solves It** — narrative, not feature list:
   - "Instead of juggling five different AI provider tabs, three different API keys hard-coded in different env files, and a Slack channel full of people asking 'is OpenAI down?' — your team installs RelayGate Desktop. One window on the dock. The dashboard shows live spend, rate-limit status, and routing rules across every provider. When ChatGPT goes down, traffic transparently routes to Claude. When a junior dev tries to call a $30/request model, the policy you set blocks it before the bill arrives."
   - "Existing solutions: a wiki page, three env files, and a hope. RelayGate: one app, one bill, one policy."

4. **Key Benefits** — lead with measurable outcomes, 6-8 bullets:
   - **One bill across all AI providers**: pay one invoice instead of reconciling OpenAI + Anthropic + Google + your self-hosted model spend across three accounting systems
   - **Zero-downtime model failover**: when one provider is degraded, traffic transparently routes to the next-best model — your team never notices
   - **Spend caps that actually work**: set a $50/day limit on a project and have it enforced at the gateway, not by checking the bill at month-end
   - **One unified API surface**: write code once against an OpenAI-compatible interface; switch from GPT-4 to Claude to a local Llama by changing a routing rule, not by rewriting the code
   - **Always-visible cost dashboard**: a dedicated window on your dock showing live spend by team, by project, by model — never lose track again
   - **Compliance-grade audit log**: every request logged with prompt + model + cost — defensible against "did anyone send customer data to OpenAI?" audits
   - **Native window, not a tab**: the dashboard is where you watch it, not buried in a browser tab among 60 others — when your AI infra is on fire, the alert is one click away on the dock

5. **What Makes This Different** — narrative paragraph:
   - "Other AI infrastructure tools are either thin SDK wrappers (you still manage all the keys, all the providers, all the rate limits) or they're heavyweight enterprise platforms that take a quarter to roll out. RelayGate is in the middle: one CLI binary, one dashboard, one app. Where LangChain gives you the LEGO bricks, RelayGate gives you the assembled castle. Where AWS Bedrock locks you into one vendor, RelayGate routes across all of them. Where 'just write a Python proxy' fails the moment you have more than one engineer, RelayGate has the dashboard, the audit log, and the per-team policies built in."

6. **Business Model**:
   - Open core: the `relaygate` CLI gateway is open source. The dashboard at `app.relaygate.ai` is free for individuals and small teams (X requests/month).
   - Paid tier: $X/seat/month for teams (audit log retention, advanced routing, SSO, SAML).
   - Enterprise: custom pricing for compliance/audit, on-prem deploys, dedicated support.
   - RelayGate Desktop (this app) is FREE for everyone — it's the native interface to whatever tier you're on.

7. **Market Opportunity**:
   - The AI infrastructure tooling market is forecast at $XB by YYYY (cite source if landing — for now use language like "tens of billions" without false-precision numbers).
   - Every team building with LLMs eventually hits the multi-provider, multi-model, multi-key problem. The TAM is "every engineering team using LLM APIs," currently in the millions and growing 4x year-over-year.
   - The desktop app specifically lowers the barrier from "set up an API gateway in your infra" to "download a 100MB installer" — bringing RelayGate's value to solo developers and small teams who would never run their own gateway.

8. **Traction & Proof Points** — be honest about stage:
   - RelayGate Gateway: open source on GitHub, in production at <X> companies (replace with real number when accurate)
   - Dashboard: live at `app.relaygate.ai`, used daily by <Y> teams (replace with real number)
   - Desktop app: shipping cross-platform installers for Linux, macOS, and Windows; first public release v0.1.0
   - This document will be updated as adoption metrics mature

9. **Roadmap**:
   - **Shipped:** Linux/Mac/Windows installers, dashboard wrapper, hardened security perimeter, build SHA in app, smoke + regression tests, automated CI publish to public GCS
   - **Building Now:** signed/notarized Mac DMG (no Gatekeeper warning), signed Windows installer (no SmartScreen warning), in-app auto-update
   - **Coming Next:** native control panel for managing a locally-running RelayGate gateway (start/stop, view logs, edit routing rules without leaving the app), system tray icon, OS notifications for budget alerts and provider outages

10. **The Team's Unfair Advantage**:
    - Built by engineers who built and operated multi-provider LLM infrastructure at scale before founding RelayGate — we lived this problem before we built the product
    - Open-source-first: the gateway is open, the SDK is open, the dashboard is hosted free. Trust comes before paid tiers, not after
    - Cross-platform desktop expertise: shipping 9+ artifacts across Linux/Mac/Win in a single CI pipeline is harder than it looks; doing it from a Linux-only Cloud Build via libdmg-hfsplus userspace tooling demonstrates engineering depth that translates to every other product surface

11. **Footer:** `*Last updated: 2026-05-04*`

**Tone notes for the implementer:**
- VERBOSE. Every section should be paragraphs, not bullets-only.
- Marketing language. "Reconciling spend across three accounting systems" beats "multi-tenant cost tracking."
- Replace `<X>`, `<Y>`, `$X/seat/month` etc. with `[TBD]` if you don't have real numbers — never make up adoption metrics or pricing.
- ZERO code blocks. ZERO acronyms without expansion (LLM is fine; "TLS-MTLS handshake" is not).

**STATUS line to write:** `STATUS: FIXED (combined with DEPLOYMENT commit)`

---

## Build Order Summary

1. F1 (gitignore) — own commit
2. F3 (CLAUDE.md) — own commit
3. F2a + F2b (docs/README + FEATURE-MAP) — combined commit
4. F2c + F2d (ARCHITECTURE + HOW-IT-WORKS) — combined commit
5. F2e + F2f (DEPLOYMENT + BUSINESS-VALUE) — combined commit

5 total commits. Each STATUS line goes in `audit/scope-findings/2026-05-04-remaining-work.md` under the relevant finding heading.

## Testing

Per-item validation lives inline in each checklist item above. After all items:

```bash
# All commands in CLAUDE.md exist:
grep -E '^# [a-z]' CLAUDE.md | sed -E 's/.*npm run ([a-z:]+).*/\1/' | sort -u | while read c; do
  jq -e ".scripts[\"$c\"]" package.json > /dev/null && echo "OK: $c" || echo "MISSING: $c"
done

# All docs are >100 lines (verbose):
wc -l docs/{README,ARCHITECTURE,HOW-IT-WORKS,FEATURE-MAP,DEPLOYMENT,BUSINESS-VALUE}.md

# No template scaffolding strings remain:
grep -E '\[Project Name\]|\[Feature name\]|EDIT THESE|YYYY-MM-DD' docs/*.md CLAUDE.md && echo FAIL || echo PASS

# .gitignore covers dmg:
grep -E '\.work/proof/binaries/\*\.dmg' .gitignore && echo PASS || echo FAIL

# All five commits exist on main:
git log --oneline -10
```

All five checks must pass. Any FAIL = item is not actually FIXED.
