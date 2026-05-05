# Feature Map

Every feature RelayGate Desktop has, will have, or might have, grouped by domain. Status taxonomy:

- **Done** — shipping in `main`, available to users today
- **In Progress** — actively being built on a feature branch right now
- **Scoped** — spec is written and approved, ready for `/build`
- **Scoping** — being researched / specced
- **Horizon** — potential future work, not yet committed

## Distribution

Where users get the binary, what format it lands in, and what it takes to install. The CI pipeline (`cloudbuild.yaml`) produces all of these in a single Linux Cloud Build run.

| Feature | Benefit | Status | Spec |
|---|---|---|---|
| Linux AppImage (x64+arm64) | Single-file portable install on any modern Linux distro — no package manager required | Done | `electron-builder.yml` |
| Linux .deb (x64+arm64) | One-click install on Debian/Ubuntu derivatives, integrates with apt for upgrades | Done | `electron-builder.yml` |
| Windows nsis installer (x64) | Familiar Windows installer with directory choice and per-user install (no admin required) | Done | `electron-builder.yml` |
| macOS .zip (x64+arm64) | Drag-the-`.app` install path, cross-compiled from Linux CI without needing a Mac runner | Done | `electron-builder.yml` |
| macOS .dmg (x64+arm64), unsigned | Standard macOS distribution medium with mounted volume + Applications symlink, built via libdmg-hfsplus userspace tooling on Linux CI | Done | `cloudbuild.yaml` (build-mac-dmg step) |
| macOS .dmg, signed + notarized | No "unidentified developer" Gatekeeper warning on user install — looks professional, builds trust | Horizon | — (requires Apple Developer Program enrollment, $99/yr, plus a Mac runner host wired through `cloudbuild-mac.yaml`) |
| Windows nsis installer, signed | No SmartScreen warning on user install — eliminates "Windows protected your PC" prompt | Horizon | — (requires EV code signing certificate, $300+/yr) |
| Auto-update (`electron-updater`) | Users get bug fixes and security patches without manually re-downloading the installer | Horizon | — |

## Application shell

What the user actually sees and interacts with after launching the app. The shell is intentionally thin — the dashboard itself is loaded from `https://app.relaygate.ai` and lives in a separate repo.

| Feature | Benefit | Status | Spec |
|---|---|---|---|
| Live dashboard wrapper | One window app — no browser tab juggling, no losing the tab among 60 others, dedicated dock/taskbar entry for the RelayGate UI | Done | `src/main.ts` |
| Cross-platform native menu | Standard OS menus (File / Edit / View / Help) with platform-correct mac App menu (about / services / hide / quit) | Done | `src/main.ts:142-204` |
| Configurable backend URL | Devs can point the app at local dev or staging via `RELAYGATE_DESKTOP_URL` env var without rebuilding | Done | `src/main.ts:6-22` |
| Env-aware default dashboard URL (per build env) | A binary built from the `dev` branch defaults to `app.dev.relaygate.ai`, `staging` to `app.staging.relaygate.ai`, `main` to `app.relaygate.ai` — testers running pre-prod builds connect to the matching pre-prod backend automatically, no env-var setup needed | Scoped | `specs/desktop-env-aware-default-url.md` |
| Build SHA exposed at runtime | Users can report exact build version when filing bugs — visible via `window.relaygate.version` from the preload bridge | Done | `src/preload.ts` |
| Native gateway control panel | Manage a locally-running `relaygate` CLI gateway (start/stop, view logs, edit routing rules) without leaving the app | Horizon | — (per root README "Future releases may add...") |
| OS notifications | Get notified of relay events, budget alerts, or provider outages without keeping the window focused | Horizon | — |
| System tray icon | Quick access to start/stop the local gateway from the menu bar / system tray | Horizon | — |

## Security

The desktop wrapper is hardened the careful way: sandboxed renderer, no Node access from web content, explicit origin allowlist for navigation. Defense in depth so that even if `app.relaygate.ai` gets XSS'd, the desktop window cannot be navigated to attacker-controlled origins.

| Feature | Benefit | Status | Spec |
|---|---|---|---|
| `contextIsolation: true` + `sandbox: true` + `nodeIntegration: false` | Renderer cannot reach Node APIs even if the dashboard JS is compromised — the worst-case XSS stays inside Chromium's sandbox | Done | `src/main.ts:88-94` |
| Origin allowlist for window-open | Phishing links inside the dashboard cannot redirect the desktop window to attacker-controlled origins; only known-good hosts (relaygate.ai, stripe.com, github.com, accounts.google.com, etc.) are honored | Done | `src/main.ts:27-69` |
| `will-navigate` off-origin filter | Off-domain navigation only happens via `shell.openExternal` (system browser), never inside the Electron window — keeps the trust boundary visible to the user | Done | `src/main.ts:111-130` |
| Webview tag blocked | No way for embedded web content to load attacker-controlled iframes with elevated Electron privileges; `will-attach-webview` event is preventDefault'd | Done | `src/main.ts:225-227` |
| HTTPS-only allowlist enforcement | Mixed-content downgrade attacks blocked at the navigation layer — `http://` URLs to allowlisted hosts are rejected | Done | `src/main.ts:55-69` |

## CI / Build infrastructure

Everything that turns a `git push` into installable binaries on GCS. Today, every push to `main` produces all 9+ artifacts in one Linux Cloud Build run.

| Feature | Benefit | Status | Spec |
|---|---|---|---|
| GitHub auto-trigger → Cloud Build | Every push to `main` produces hashed artifacts in GCS without manual builds — no "did you remember to release?" Slack threads | Done | `cloudbuild.yaml` |
| Cross-compile matrix (linux x4, mac.zip x2, mac.dmg x2, win x1) | One CI run produces all 9+ artifacts; engineers don't need a Mac to ship Mac builds, don't need a Windows VM to ship Windows builds | Done | `cloudbuild.yaml` |
| SHA256SUMS publication | Users can verify download integrity before installing — defensible against MITM during the GCS fetch | Done | `cloudbuild.yaml:publish` |
| GCS `latest/` mirror | Stable download URL that always points at the most recent `main` build — landing page links don't go stale | Done | `cloudbuild.yaml:publish` |
| macOS host runner pipeline (signed/notarized DMG) | Future ability to ship signed builds via SSH-tunneled Mac mini / MacStadium / MacinCloud — eliminates Gatekeeper warnings | Scoped | `cloudbuild-mac.yaml` (skeleton in place, waits on Apple Developer secrets + a host) |
| Embedded build SHA | Bug reports include the exact commit users are running; reproducing an issue is `git checkout <sha>` away | Done | `cloudbuild.yaml` (`--config.extraMetadata.commit`) |
| Embedded build env (prod/staging/dev) | Each binary knows which environment it was built for; runtime defaults the dashboard URL to the matching environment so testers don't need env-var setup | Scoped | `specs/desktop-env-aware-default-url.md` |
| Per-environment artifact paths in GCS | Dev/staging/prod binaries published to separate path prefixes (`dev/latest/`, `staging/latest/`, `prod/latest/`) so pre-prod builds don't clobber prod download links | Scoped | `specs/cloudbuild-env-paths.md` |
| CI triggers for `dev` and `staging` branches | Pushes and PRs targeting `dev` or `staging` produce env-tagged artifacts and run the same smoke gate as `main` — feature → dev → staging → main promotion is gated end-to-end | Scoped | `specs/cloudbuild-triggers-dev-staging.md` |
| Dashboard env routing (`app.dev` / `app.staging` hostnames) | The pre-prod hostnames the env-aware desktop binaries connect to are wired in Cloud Run + Cloudflare so dev/staging builds reach matching dev/staging dashboards instead of 404 | Scoped | `specs/dashboard-dev-staging-routing.md` |

## Testing

Two test suites, both end-to-end via Puppeteer attaching to Electron over the Chrome DevTools Protocol. The wrapper has very little pure logic; nearly all the value is integration with Electron + Chromium + the live dashboard, so unit tests would mostly mock everything that matters.

| Feature | Benefit | Status | Spec |
|---|---|---|---|
| Puppeteer-CDP smoke test | Catch regressions where the dashboard fails to render in our exact Electron + Chromium build (catches Electron upgrade breakage) | Done | `tests/smoke.test.ts` |
| Live-dashboard regression suite | Catches if `app.relaygate.ai` ships a change that breaks the desktop wrapper (signin, dashboard render, mobile viewport, SEO meta) | Done | `tests/live-dashboard.test.ts` |
| CI-integrated test run | Smoke tests gate every Cloud Build — broken builds never publish to GCS | Done | `cloudbuild.yaml:smoke-test` (xvfb-run + 3-attempt retry; runs between `build-main` and `dist-all-platforms`) |
| Cross-platform smoke (one per OS) | Catch regressions specific to one platform's Electron+Chromium combination (currently only Linux is auto-tested) | Horizon | — |

## Documentation

Project docs are intentionally maintained as code — every phase transition rewrites the affected sections rather than appending changelog entries. The root `README.md` is the canonical entry point; everything in `docs/` builds on it.

| Feature | Benefit | Status | Spec |
|---|---|---|---|
| Root README | Investors / GitHub visitors / new developers get an accurate one-page picture of what the project is and how to build it | Done | `README.md` |
| docs/README mirror | Programmatic doc consumers find the same canonical content under `docs/` | Done | `docs/README.md` (= `README.md`) |
| Architecture doc | New developers get the full repo map, component graph, and execution flow without reading every source file | Done | `docs/ARCHITECTURE.md` |
| How-it-works doc | Technical readers see both the user journey and the under-the-hood flow tied together step by step | Done | `docs/HOW-IT-WORKS.md` |
| Feature map | Source of truth for "what's shipping vs roadmap"; every other doc references it | Done | `docs/FEATURE-MAP.md` (this file) |
| Deployment doc | Release engineers can ship a new build, set up a fresh CI environment, or roll back without spelunking yaml | Done | `docs/DEPLOYMENT.md` |
| Business value doc | Marketers, investors, and prospective users get a non-technical pitch they can quote from | Done | `docs/BUSINESS-VALUE.md` |
| Mac build deep-dive | Engineers wiring up a Mac host runner have a single reference for signing, notarization, and the SSH-tunneled pipeline | Done | `docs/MAC_BUILD.md` |

---
*Last updated: 2026-05-05*
