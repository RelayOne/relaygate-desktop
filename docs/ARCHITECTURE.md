# Architecture

## 1. Overview

RelayGate Desktop is an Electron 35 thin wrapper around the live RelayGate dashboard hosted at `https://app.relaygate.ai`. There is intentionally no renderer code in this repository — the dashboard's HTML, CSS, and JavaScript ship from a separate `relaygate-app` repository and are loaded over HTTPS into a sandboxed Chromium `BrowserWindow`. The wrapper exists to give users a native window with platform-correct OS integration (App menu on macOS, taskbar entry on Windows, dock icon on Linux desktops, OS-correct close/minimize chrome) instead of yet another browser tab buried among sixty others, and to provide a hardened security perimeter around the dashboard: contextually isolated renderer with no Node access, an explicit HTTPS-only origin allowlist for navigation, and a `will-navigate` filter that routes off-domain links through `shell.openExternal` rather than allowing the Electron window itself to be navigated. The result is a small, opinionated, security-forward shell whose only job is to render the canonical dashboard inside a real OS window.

## 2. Tech Stack

The runtime, build toolchain, and infrastructure are pinned to specific versions across `package.json`, `.nvmrc`, and the Cloud Build YAML files. Treat these as load-bearing — the cross-compile DMG step in particular only works because of the exact electron-builder + libdmg-hfsplus combination described below.

| Layer | Component | Version |
|---|---|---|
| Runtime | Electron | 35.7.5 |
| Language | TypeScript | 5.7.3 |
| Node toolchain | Node.js | 20.18.1 (per `.nvmrc`) |
| Packager | electron-builder | 25.1.8 |
| Test runner / loader | tsx | 4.21 |
| Browser automation | puppeteer-core | 23.10 (CDP attach) |
| CI orchestrator | Google Cloud Build | E2_HIGHCPU_8 worker, 1800s timeout |
| Artifact host | Google Cloud Storage | `gs://relayone-488319-public/relaygate-desktop/` |
| DMG userspace tooling | libdmg-hfsplus (Mozilla fork) | built from source per build |

There is no bundler (no webpack, no esbuild, no Vite). TypeScript's own `tsc` emits CommonJS to `dist/`, electron-builder packs `dist/` plus `package.json` into native installers, and that is the entire build graph for the wrapper itself.

Why no bundler: the main process and preload script are tiny (a few hundred lines combined), they consume only Electron's built-in modules and `node:path`, and bundling would buy nothing while complicating debugging (stack traces stay readable when source maps map 1:1 to TypeScript files in `src/`). If renderer code ever lands in-repo, that calculus changes — but until then, plain `tsc` is the right tool.

## 3. Repository Map

The annotated tree below shows the files that matter and why. Anything not listed (node_modules, build outputs, transient `.work/` proof artifacts) is gitignored or otherwise out of scope for code review.

```
relaygate-desktop/
├── src/
│   ├── main.ts                  # Electron main process: window lifecycle, URL guard,
│   │                            # navigation filter, native menu, app event handlers
│   └── preload.ts               # contextBridge exposing window.relaygate.{version,
│                                # platform, arch} read-only to the renderer
├── tests/
│   ├── smoke.test.ts            # Minimal CDP-attached render check; builds, launches
│   │                            # Electron with --remote-debugging-port, asserts non-
│   │                            # empty DOM, screenshots to tests/artifacts/
│   └── live-dashboard.test.ts   # Broader regression suite against app.relaygate.ai
│                                # (signin, dashboard, mobile viewport, SEO meta)
├── assets/
│   └── icon.png                 # 1024x1024 source; electron-builder derives platform
│                                # icons (.ico for Windows, .icns for macOS)
├── electron-builder.yml         # Shared cross-platform packager config — Linux
│                                # AppImage+deb, Windows nsis, mac.zip (cross-
│                                # compilable from Linux Cloud Build)
├── electron-builder.mac.yml     # Extends shared config with DMG target — invoked
│                                # by `npm run dist:mac` on a real macOS host
├── cloudbuild.yaml              # Linux Cloud Build pipeline; cross-compiles all
│                                # platforms including unsigned DMG via libdmg-hfsplus
├── cloudbuild-mac.yaml          # Future macOS-host pipeline scaffold for SSH-
│                                # tunneled signed/notarized DMG builds
├── package.json                 # Scripts: build, typecheck, start, dev, pack, dist,
│                                # dist:linux|mac|win, test:smoke
├── tsconfig.json                # ES2022 / CommonJS / strict / rootDir=src outDir=dist
├── README.md                    # Canonical project README — root is source of truth
├── docs/                        # Project docs (this file lives here)
└── .work/                       # Local proof binaries, recovery state, build logs
                                 # (mostly gitignored)
```

## 4. System Components

The desktop app is small enough that "system components" means a handful of cooperating pieces. Each component below lists what it does, what it talks to, and where in the repository it lives.

**Main process** (`src/main.ts`) owns the entire `BrowserWindow` lifecycle. It resolves the dashboard URL from `RELAYGATE_DESKTOP_URL` (with a safe fallback to `https://app.relaygate.ai`), constructs the window with strict `webPreferences` (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`), wires up `setWindowOpenHandler` and `will-navigate` listeners that filter URLs against the origin allowlist, builds the platform-correct application menu (with a real macOS App menu on darwin), and handles `window-all-closed` / `activate` lifecycle events. It talks to the operating system (menu, shell, window chrome), to the preload bridge by virtue of pointing at the compiled `dist/preload.js`, and to the loaded dashboard URL.

**Preload bridge** (`src/preload.ts`) runs in an isolated context with limited Node access. Its only job is to expose a tiny read-only surface to the renderer via `contextBridge.exposeInMainWorld("relaygate", desktopBridge)`. The exposed object contains the package version string, the Node `process.platform` value, and `process.arch`. It exposes data; it does not accept inbound calls. The dashboard can read those three fields to display the current build version in a footer or send it with bug reports, and that is the entire contract between the wrapper and the dashboard JavaScript.

**Renderer** runs entirely under `https://app.relaygate.ai` (or whatever `RELAYGATE_DESKTOP_URL` resolves to). The HTML, CSS, and JavaScript that the user sees are served from the live dashboard — they live in a separate `RelayOne/relaygate-app` repository, not here. From this repo's perspective the renderer is a black box: it receives the `window.relaygate` bridge, it makes XHR/fetch calls to its own backend at `api.relaygate.ai`, and it occasionally fires `window.open` or follows `<a target="_blank">` clicks that the main process intercepts.

**electron-builder** consumes the compiled `dist/` directory plus `package.json` and produces platform-native installers. It reads `electron-builder.yml` for the shared cross-platform configuration (Linux AppImage+deb, Windows nsis, macOS zip — all cross-compilable from Linux) and reads the extending `electron-builder.mac.yml` only when packaging DMG on a real macOS host. Output lands in `release/`.

**Cloud Build** is the orchestrator. The Linux pipeline (`cloudbuild.yaml`) runs `npm ci`, `npm run typecheck`, `npm run build`, electron-builder cross-compile across all platforms, a libdmg-hfsplus DMG userspace step, and a final GCS publish step. The future macOS pipeline (`cloudbuild-mac.yaml`) is wired but inert until a macOS host is provisioned for SSH-tunneled signed builds.

## 5. Data Models

This repository has no database, no persisted application state, no schemas, and no data models. The Electron app is stateless across launches as far as this codebase is concerned: cookies, localStorage, IndexedDB, and HTTP cache are owned by Chromium under its standard per-platform user-data directory and are scoped to the loaded origin (`app.relaygate.ai`), which means session continuity is identical to opening the dashboard in a regular Chrome profile. The only "data" the wrapper itself holds is the package version string in `package.json` (surfaced at runtime via `process.env.npm_package_version` and the preload bridge), the resolved dashboard URL captured at startup, and the static origin allowlist baked into `src/main.ts`. There is no Zod schema, no Prisma model, no migration directory, and no place where typed entities are defined for this repository because there is nothing to model.

The Chromium user-data directory location varies by platform: `~/.config/RelayGate/` on Linux, `~/Library/Application Support/RelayGate/` on macOS, and `%APPDATA%\RelayGate\` on Windows. Uninstalling the desktop app does not by default delete these directories — that is intentional, so a re-install does not log the user out. If the dashboard team adds new client-side state (more localStorage keys, a Service Worker, etc.) it works automatically inside the wrapper because it is the same Chromium running the same origin.

## 6. API Surface

This repository exposes no HTTP APIs, no IPC channels beyond the preload bridge, and no public TypeScript surface for external consumers. The renderer talks directly to `api.relaygate.ai` over HTTPS using whatever client code the dashboard ships — that traffic does not pass through Electron except as ordinary Chromium network requests. The main process does not expose `ipcMain.handle` channels in the current design; if and when it grows native control-panel features (managing a locally-running `relaygate` gateway binary, reading log files, etc.) those will land here.

The one and only API surface this repo defines is the `window.relaygate` object exposed by `src/preload.ts` via `contextBridge.exposeInMainWorld`:

| Field | Type | Source |
|---|---|---|
| `version` | `string` | `process.env.npm_package_version` (falls back to `"0.1.0"`) |
| `platform` | `NodeJS.Platform` (`"darwin" \| "linux" \| "win32" \| ...`) | `process.platform` |
| `arch` | `string` (`"x64"`, `"arm64"`, etc.) | `process.arch` |

The TypeScript type is exported as `DesktopBridge` from `src/preload.ts`. The renderer reads these fields to show the current build version and platform identifier; it cannot call back into the main process via this bridge.

This narrow contract is deliberate. Adding mutator methods to `window.relaygate` would require the preload to import `ipcRenderer`, register channels in the main process, and reason about which renderer-initiated calls are safe to expose. Until there is a feature that genuinely needs that — a native control panel for the local `relaygate` gateway is the leading candidate, see `docs/FEATURE-MAP.md` Horizon section — the bridge stays read-only and the threat model stays simple.

## 7. Execution Flow

A single application launch flows through the codebase as follows. Each step lists the exact code path so a developer can grep their way through.

1. The user runs the installed app — double-click on Linux/macOS, Start menu on Windows. The OS launches the Electron binary that electron-builder packed into the installer. Electron initializes V8 and the Chromium browser process and then loads `package.json`'s `main` field, which points at `dist/main.js` (the compiled `src/main.ts`).
2. `app.whenReady()` fires once Electron has initialized enough OS surface (display, menu, accelerators) to start creating windows. The `then` callback runs `buildAppMenu()` followed by `createMainWindow()`.
3. `buildAppMenu()` builds a platform-aware `MenuItemConstructorOptions[]` template — on macOS it prepends a real App menu with About / Services / Hide / Quit roles; on every platform it adds File, Edit, View, and a Help menu whose only entry opens `https://relaygate.ai` via `shell.openExternal`. The constructed menu is installed via `Menu.setApplicationMenu`.
4. `createMainWindow()` constructs a `BrowserWindow` with width 1280, height 840, minWidth 960, minHeight 600, title `"RelayGate"`, dark background `#0b0b0d` to suppress the white flash before first paint, `show: false`, and strict `webPreferences`: `preload` resolved to `path.join(__dirname, "preload.js")`, `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
5. Three `webContents` listeners attach. `setWindowOpenHandler` checks each requested popup URL against `isAllowedExternalOrigin` — allowed origins open in the system browser via `shell.openExternal`, denied origins are logged to stderr; in either case the handler returns `{ action: "deny" }` so no Electron child window is ever created. `will-navigate` checks the navigation target's origin against `DASHBOARD_ORIGIN`; off-origin navigations are prevented and routed to the system browser if allowlisted, denied silently otherwise. `did-fail-load` logs network/render failures.
6. The preload script runs (in its isolated world, with limited Node access). It calls `contextBridge.exposeInMainWorld("relaygate", desktopBridge)` to make the version/platform/arch object readable from the renderer's `window.relaygate`.
7. `win.loadURL(DASHBOARD_URL)` kicks off the actual page load. Chromium fetches the dashboard, runs its scripts, and fires `ready-to-show`, at which point the main process calls `win.show()` and the user sees the live dashboard render.
8. Steady state. The dashboard JS calls its backend directly. Off-origin clicks fire either through `<a target="_blank">` (caught by `setWindowOpenHandler`) or in-window navigation (caught by `will-navigate`). Both paths route through the allowlist and either open the system browser or fail closed.
9. Shutdown. On Linux/Windows, closing the last window fires `window-all-closed` and the main process calls `app.quit()`. On macOS, the convention is for the app to stay running with no windows; clicking the dock icon fires `activate` and re-creates the main window.

## 8. Infrastructure

The deployment side of this codebase is described in detail in `docs/DEPLOYMENT.md`. At a glance: source lives at GitHub `RelayOne/relaygate-desktop`. A Cloud Build trigger fires on every push to `main` and runs `cloudbuild.yaml` on a single Linux worker (`E2_HIGHCPU_8`, 1800s timeout, `CLOUD_LOGGING_ONLY` logging). That pipeline produces nine or more artifacts in a single run: Linux AppImage and deb for both x64 and arm64, Windows nsis x64, macOS zip for both x64 and arm64, and macOS DMG for both x64 and arm64 (built unsigned via the libdmg-hfsplus userspace tooling clone-built per pipeline run). All artifacts publish to `gs://relayone-488319-public/relaygate-desktop/{SHORT_SHA}/` and to a stable `gs://relayone-488319-public/relaygate-desktop/latest/` mirror. A `SHA256SUMS.txt` is computed and published alongside the binaries for users to verify download integrity. There is no staging/production split — every artifact is built unsigned, and signing is gated by Apple Developer Program enrollment and EV code signing certificate provisioning, both tracked as Horizon items in `docs/FEATURE-MAP.md`. The companion `cloudbuild-mac.yaml` is a future-state pipeline that will SSH into a macOS host (Mac mini, MacStadium, MacinCloud) to produce signed and notarized DMGs once those secrets land in Secret Manager.

The infrastructure has deliberately few moving parts. There is no databases, no Cloud Run services, no DNS records owned by this repository, no Pub/Sub topics, no Cloud Functions, no IAM policies beyond the build trigger's service account having `roles/storage.objectAdmin` on the public bucket. Every pipeline run is hermetic in the sense that it pulls fresh `node_modules` via `npm ci` and clones `libdmg-hfsplus` from upstream — nothing is cached between runs except what Cloud Build itself caches at the docker-layer level. This means recovery from a corrupted state is "merge a commit and let CI run," which is the desired property for an artifact-publishing pipeline.

## 9. Type System / Validation

TypeScript is configured for strict mode in `tsconfig.json`: `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`, plus `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, and `noImplicitReturns`. The compile target is ES2022 with CommonJS modules and Node-style module resolution, `rootDir` is `src`, `outDir` is `dist`, and the include/exclude lists scope compilation to `src/**/*` only — `tests/` is excluded from the main build because tests are loaded via `tsx` at runtime.

The wrapper does very little input validation because it has very little input. Validation happens in exactly two places. First, `resolveDashboardUrl` in `src/main.ts` parses `process.env.RELAYGATE_DESKTOP_URL` through `new URL()` inside a try/catch, rejects any protocol that is not `http:` or `https:`, and falls back to the hardcoded `DEFAULT_DASHBOARD_URL` constant on any failure (logging the reason to stderr). Second, `isAllowedExternalOrigin` parses each candidate URL through `new URL()` inside a try/catch, requires `https:`, and checks the origin against an exact-match `Set<string>` of trusted origins followed by a suffix match against `ALLOWED_HOST_SUFFIXES` for first-party subdomains. Both functions fail closed: any parse error returns the safe fallback or `false`. There is no Zod, no io-ts, no schema library — adding one would be overkill for a single env var and a static allowlist.

## 10. Testing Architecture

There are two test files, both end-to-end via Puppeteer-CDP, and they live under `tests/` (excluded from the TypeScript compile, loaded directly by `tsx` at runtime via `npm run test:smoke`).

`tests/smoke.test.ts` is the minimal regression check. It builds the app via `npm run build` (the `pre`-script of `test:smoke`), launches Electron with `--remote-debugging-port` set, attaches `puppeteer-core` over the Chrome DevTools Protocol, asserts that the rendered page produces a non-empty DOM, screenshots the result to `tests/artifacts/`, and shuts the Electron process down cleanly. This catches the class of regression where some change to the wrapper, the preload, the build config, or the Electron version itself causes the dashboard to fail to render at all.

`tests/live-dashboard.test.ts` is the fuller regression suite and runs against the live `app.relaygate.ai`. It exercises sign-in flows, dashboard render, mobile viewport behavior, and SEO meta tags. The intent is to catch dashboard-side regressions that would silently break the desktop wrapper — for example, if the dashboard team ships a CSP change that blocks the embedded Chromium, the desktop smoke test would surface it.

There are no unit tests in this repository. The wrapper has very little pure logic to unit-test: a URL parser, an allowlist check, a menu builder. The bulk of behavior is integration with Electron, Chromium, and the live dashboard, and that is precisely what the Puppeteer-CDP tests exercise. Tests currently run locally only — wiring the smoke test into Cloud Build so that broken builds never publish is tracked as a Horizon item in `docs/FEATURE-MAP.md`.

The Puppeteer attachment uses `puppeteer-core` (not full `puppeteer`) to avoid bundling a second Chromium download — Electron already ships its own Chromium, and the smoke test attaches to that exact Chromium via the DevTools Protocol on the remote debugging port. This is important: any rendering bug that depends on the specific Chromium build inside Electron 35.7.5 will reproduce in the smoke test, because the smoke test is driving that exact browser. A test runner that downloaded its own Chromium would test a different browser than the one users see.

Test artifacts (screenshots, logs) land in `tests/artifacts/` which is gitignored. CI does not currently re-publish those artifacts; if a smoke test failure ever needs deeper investigation, the engineer reproduces it locally and inspects the artifacts directory.

## 11. Footer

This document is the architectural reference for `relaygate-desktop`. When the codebase changes in a way that invalidates any section above — a new IPC channel, a renderer landing in-repo, a build pipeline change, a new validation point — update this document in the same commit (or the immediately following commit) per the project's documentation rules. The other docs in `docs/` cross-reference sections of this file and assume the structure here remains stable.

For the user-journey narrative ("download, install, launch, see dashboard") see `docs/HOW-IT-WORKS.md`. For the Cloud Build pipeline mechanics and GCS layout see `docs/DEPLOYMENT.md`. For the inventory of shipping versus planned features see `docs/FEATURE-MAP.md`. For the non-technical pitch see `docs/BUSINESS-VALUE.md`. For the canonical project overview see the root `README.md`, which `docs/README.md` mirrors verbatim.

When in doubt about which document to update for a given change: code-level architectural facts (component boundaries, data shapes, validation rules, test strategy) belong here; user-visible behavior changes belong in `docs/HOW-IT-WORKS.md`; build-or-deploy infrastructure changes belong in `docs/DEPLOYMENT.md`; status changes (something moved from Scoped to Done, or a new Horizon item appeared) belong in `docs/FEATURE-MAP.md`. Multiple docs may need updates for the same change, and that is fine — make them in the same commit so the project's documentation never desynchronizes from the code that produced it.

---
*Last updated: 2026-05-04*
