# How It Works

This document walks through what RelayGate Desktop looks like from a user's
seat and what is happening under the hood at each step. The goal is to give
a technical reader the full picture in one read: download, install, launch,
dashboard render, day-to-day use, and quit, plus the specific code paths and
architectural decisions that make each of those steps work the way it does.

The structure mirrors the way most readers will actually approach the
product. Section 1 is the narrative user journey written in second person —
no code, no jargon, no implementation noise. Section 2 is the matching
technical walk-through, tying each user-visible step to the file and
function that handles it. Section 3 visualizes the most security-sensitive
flow as an ASCII diagram. Section 4 records the decisions that shaped the
codebase. Section 5 contrasts the approach with the more common ways of
shipping a desktop app around a hosted dashboard.

## 1. User Journey

### Step 1: Download

You visit `https://relaygate.ai/desktop` (or the GitHub release page) and
pick the build that matches your operating system. The download links
resolve into the public Google Cloud Storage bucket at
`gs://relayone-488319-public/relaygate-desktop/latest/`, which is a stable
mirror that always points at the most recent successful build of the `main`
branch.

Whether you grab the Linux AppImage, the Linux `.deb`, the macOS `.dmg`, the
macOS `.zip`, or the Windows `nsis` `.exe`, the URL pattern is the same and
the artifact you receive was produced by the same Cloud Build run. The
bucket is public-read, so the download itself does not require any account,
key, or sign-in step.

### Step 2: Verify

Alongside every artifact in `latest/` there is a `SHA256SUMS.txt` file
produced by the same Cloud Build pipeline that built the binaries. You can
download both files to the same directory and run
`sha256sum -c SHA256SUMS.txt --ignore-missing` (or the equivalent
`shasum -a 256 -c` on macOS, `Get-FileHash` on Windows) to confirm the
artifact you have on disk matches the one Cloud Build published.

This step is optional, but for the current unsigned builds it is the only
authenticated path between Cloud Build and your machine, so we recommend
doing it once. Once code signing ships, the OS itself will perform a
stronger version of the same check on first launch, and this manual
verification will become a belt-and-suspenders nicety rather than a
necessity.

### Step 3: Install

On Linux, you mark the AppImage executable with
`chmod +x RelayGate-*.AppImage` and double-click it, or you install the
`.deb` with `sudo dpkg -i RelayGate-*.deb` (or your distro's GUI installer)
which registers a desktop entry under `/usr/share/applications/`.

On macOS, you open the `.dmg`, drag `RelayGate.app` onto the `Applications`
symlink that appears next to it in the mounted volume, and eject the
volume.

On Windows, you run `RelayGate-Setup-*.exe` and click through the nsis
installer, which writes the app under `%LOCALAPPDATA%\Programs\RelayGate\`
because the installer is configured for per-user (no admin) install.

### Step 4: First launch

The first time you launch the app, macOS Gatekeeper and Windows SmartScreen
will warn you about an "unidentified developer" because the current public
builds are unsigned. On macOS you bypass this with right-click then Open
(or System Settings then Privacy and Security then Open Anyway). On Windows
you click "More info" then "Run anyway." Linux has no such gate.

This warning will go away once code signing and notarization land — both
are tracked as `Horizon` items in the feature map and require paid
certificates plus, in the macOS case, a real Mac host runner for the
notarization step.

### Step 5: See dashboard

The app opens a single window titled `RelayGate`, sized at 1280 by 840
pixels, with a minimum size of 960 by 600. Before any web content loads,
the window background is painted dark (`#0b0b0d`) so you do not see the
white flash that bare Electron windows produce while Chromium is starting.

Within roughly a second, the live RelayGate dashboard from
`https://app.relaygate.ai` finishes loading inside the window. The window
only becomes visible once Chromium fires `ready-to-show`, so you do not see
a half-rendered page during startup.

### Step 6: Use

Everything you do inside the window — sign in, view usage, manage API keys,
check billing, configure routing rules — is handled by the dashboard
JavaScript talking to its own backend at `api.relaygate.ai`. From the
inside, the experience is identical to opening `app.relaygate.ai` in a
browser tab.

The differences are all on the outside: the app has its own dock or
taskbar entry, its own native menu bar (File, Edit, View, Help, plus the
standard macOS App menu when you are on macOS), and it is not buried among
60 other tabs in your browser. Off-domain links open in your default system
browser instead of navigating the desktop window away from the dashboard,
so an accidental click on a billing-portal link or a documentation link
never costs you the dashboard view you were looking at.

### Step 7: Quit

On macOS, closing the window leaves the app running in the dock — the
conventional macOS pattern — and `Cmd-Q` quits it for real. On Linux and
Windows, closing the last window quits the process, because the
`window-all-closed` handler calls `app.quit()` for every platform other
than `darwin`.

Reopening the dock icon on macOS while the app is still running re-creates
the window via `app.on('activate')`, which is the standard Electron
lifecycle hook for the macOS reactivation event.

## 2. Technical Overview

This section walks the same seven steps from the implementation side. It
is meant to be read alongside `src/main.ts` and `electron-builder.yml` —
file paths and approximate line numbers are called out where they matter.

**Step 1, download.** The download URLs point at a public GCS bucket,
populated by the `publish` step of `cloudbuild.yaml`. That step iterates
over every artifact in `release/` (`*.AppImage`, `*.deb`, `*.exe`,
`*-mac.zip`, `*.dmg`), copies each one to both
`gs://.../{$SHORT_SHA}/<basename>` and `gs://.../latest/<basename>`, and
appends a `sha256sum` line to `SHA256SUMS.txt` which is then itself
published to both prefixes. The `latest/` mirror is intentionally
overwritten on every successful build so that download landing pages do
not need to change. See `docs/DEPLOYMENT.md` for the full pipeline
walk-through, including the Mozilla `libdmg-hfsplus` userspace tooling
used to build the macOS `.dmg` from a Linux runner.

**Step 3, install.** `electron-builder` produces native installers from
the compiled `dist/` directory plus the runtime entries in `package.json`.
The shared cross-platform configuration lives in `electron-builder.yml`
and declares Linux targets (`AppImage` and `deb`, both x64 and arm64),
macOS `.zip` targets (x64 and arm64, cross-compilable from Linux because
they are just zipped `.app` bundles with no `hdiutil` step), and a Windows
`nsis` target (x64). The Linux `.deb` registers a `.desktop` file under
`/usr/share/applications/` so the app appears in the system launcher. The
Windows nsis installer is configured with `oneClick: false`,
`allowToChangeInstallationDirectory: true`, and `perMachine: false`, which
together produce a familiar wizard-style installer that lets the user pick
a destination directory and does not require administrator privileges.

**Step 5, first render.** The Electron main process boots through
`app.whenReady()` in `src/main.ts:207`, which calls `buildAppMenu()` and
then `createMainWindow()`. `createMainWindow()` constructs a
`BrowserWindow` with strict `webPreferences`: `contextIsolation: true`,
`sandbox: true`, `nodeIntegration: false`, and `webSecurity: true`. It
wires a preload script (`dist/preload.js`) and attaches three navigation
handlers — `setWindowOpenHandler`, `will-navigate`, and `did-fail-load` —
before calling `win.loadURL(DASHBOARD_URL)`.

`DASHBOARD_URL` itself is computed by `resolveDashboardUrl()`, which reads
`RELAYGATE_DESKTOP_URL` from the environment, parses it through the WHATWG
`URL` constructor, rejects anything that is not `http:` or `https:`, and
falls back to an env-aware default URL on any error. The default is
selected at module-load time by `readBuildEnv()`, which loads the bundled
`package.json` (placed at `<bundle>/package.json` by electron-builder, with
the `env` field set via `--config.extraMetadata.env=${_ENV}` in
`cloudbuild.yaml`'s `dist-all-platforms` step) and reads its `env` field.
A `dev`-built binary defaults to `https://app.dev.relaygate.ai`, a
`staging` build defaults to `https://app.staging.relaygate.ai`, and any
other value (including missing field, parse failure, or `prod`) defaults
to `https://app.relaygate.ai`. The precedence chain is therefore
`RELAYGATE_DESKTOP_URL` env var > embedded `package.json:env` > prod
fallback — testers running pre-prod builds connect to the matching
pre-prod dashboard automatically with zero env-var setup, while
developers can still point a prod-built binary at localhost or a
custom origin via the env var override without rebuilding.

The preload script (`src/preload.ts`) runs in its own isolated world and
uses `contextBridge.exposeInMainWorld("relaygate", desktopBridge)` to
expose a tiny read-only object containing `version`, `commit`, `env`,
`platform`, and `arch` to the renderer. The `version` and `commit`
fields anchor bug reports to a specific source revision; the `env` field
lets the dashboard render an "Connected to dev/staging/prod" badge or
adjust client behavior based on which environment the desktop wrapper
was built for.

Before the first window opens, the main process also installs a
permission-request handler on the default Electron `session`. By default
Chromium denies every renderer-initiated permission request silently
(camera, microphone, geolocation, clipboard read, MIDI, etc.). This is
correct posture for a wrapped third-party dashboard. The one permission
the dashboard genuinely needs is `notifications` — for budget alerts,
provider-outage warnings, and other event-driven signals that are useful
even when the dashboard window is unfocused. Our handler allows
`notifications` if and only if the requesting URL's origin matches the
existing `EXTERNAL_ORIGIN_ALLOWLIST` (or one of the suffix-matched
first-party domains under `.relaygate.ai` / `.relayone.ai`). Every other
permission type is denied unconditionally; every non-allowlisted origin
is denied for notifications too. On Windows the wrapper additionally
calls `app.setAppUserModelId('ai.relaygate.desktop')` early in
`whenReady` so that notification toasts attribute to "RelayGate"
instead of the generic "Electron" label, and so that the desktop entry
binds correctly when users pin it to the taskbar. From the dashboard
JS side this is invisible: a call like
`new Notification('Budget alert', { body: '...' })` Just Works on every
platform with a notification daemon (Notification Center on macOS,
Action Center on Windows, libnotify-aware Linux DEs); on headless Linux
without a notification daemon the call silently constructs and fires
its `onerror` handler, which is correct degradation.

**Step 6, interactions.** The dashboard JavaScript inside the renderer
makes XHR and `fetch` calls directly to `api.relaygate.ai` over HTTPS.
Electron is invisible to that traffic; it does not proxy or inspect it.
The only Electron-side surface visible to the dashboard is the
`window.relaygate` bridge from the preload, which the dashboard can read
but cannot write to (the contextBridge marshals values across the
isolated worlds, so even mutations would not affect the main process).

When the dashboard tries to open a new window — via `window.open()`,
`target="_blank"` clicks, or middle-click — Chromium routes the request
through `setWindowOpenHandler` (`src/main.ts:102-109`). That handler runs
`isAllowedExternalOrigin(url)` against the explicit origin set and the
suffix list. If the URL passes, the handler calls `shell.openExternal(url)`
to hand the URL to the OS default browser. Either way, it returns
`{ action: "deny" }`, so a new Electron window is never created — the
desktop app is, by design, a single-window application.

Off-origin in-window navigation hits `will-navigate`
(`src/main.ts:111-130`), which calls `event.preventDefault()` whenever
`target.origin !== DASHBOARD_ORIGIN`, then optionally hands the URL to
`shell.openExternal` if it is on the allowlist, or logs it to stderr and
drops it otherwise.

**Step 7, quit.** The `window-all-closed` handler at the bottom of
`src/main.ts` calls `app.quit()` on every platform other than `darwin`,
matching standard Electron quit semantics. On macOS, the dock icon stays
live and `app.on('activate')` re-creates the window if there are no open
windows — that is the path you take when you click the dock icon to bring
the app back. There is no persistent state to flush on quit; the
dashboard's own session storage is owned by Chromium's standard cache
directory, the same way it would be in any browser profile.

## 3. System Flow Diagram (ASCII)

The single most security-relevant flow in the app is what happens when a
link inside the dashboard tries to open a new URL. The diagram below
traces that flow end to end:

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

The matching diagram for in-window navigation (clicking a same-page link)
is simpler: if the destination origin equals `DASHBOARD_ORIGIN`, Chromium
navigates normally; otherwise the `will-navigate` listener calls
`event.preventDefault()` and hands the URL off to `shell.openExternal`
only if the allowlist permits it, dropping it silently otherwise.

## 4. Key Technical Decisions

- **Why Electron, not Tauri or Wails?** Electron embeds Chromium directly,
  which is the same engine RelayGate's web dashboard primarily targets.
  Rendering parity between the desktop app and `app.relaygate.ai` in
  Chrome is automatic — there is no "this works in the browser but breaks
  in the app" failure mode. Tauri uses each operating system's native
  webview (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux),
  which means we would have to test the dashboard against three distinct
  rendering engines and hand-fix any bug-for-bug incompatibilities. Wails
  has the same problem. For a wrapper-style app whose entire job is to
  render a known web property faithfully, fidelity beats bundle size, so
  Electron wins. The 170-megabyte installed footprint is the cost of
  doing business.

- **Why no renderer code in this repo?** Single source of truth. Every
  dashboard improvement deploys to web users and desktop users at the
  same instant — the moment it lands at `app.relaygate.ai`. There is no
  release coordination between the dashboard repo and the desktop repo,
  no shipping a desktop hotfix to ship a dashboard hotfix, no "the
  desktop app is one version behind" support tickets, and no second copy
  of the dashboard's React tree to maintain. The desktop repo's job is
  the wrapper itself: window creation, menu, security perimeter,
  packaging, publishing. That separation also keeps the desktop repo
  small enough to audit in an afternoon.

- **Why an origin allowlist?** Defense in depth. Even if
  `app.relaygate.ai` were compromised by stored XSS, an attacker still
  cannot make the desktop window navigate to an attacker-controlled
  origin. The `will-navigate` handler blocks in-window navigation away
  from `DASHBOARD_ORIGIN`, and `setWindowOpenHandler` blocks new-window
  creation outright (always returning `{ action: "deny" }`).
  Off-allowlist clicks fail closed: they go nowhere, and the dropped URL
  is logged to stderr for forensic visibility. The allowlist itself is
  two layers — a flat `Set` of exact origins plus a short suffix list
  for first-party subdomains — so adding a new subdomain like
  `support.relaygate.ai` requires no allowlist change, but adding a
  brand-new domain is an explicit code review.

- **Why HTTPS-only in the allowlist?** Prevents downgrade attacks. The
  first thing `isAllowedExternalOrigin` does is reject any URL whose
  protocol is not `https:` (`src/main.ts:58`). That means a misconfigured
  `<a href="http://app.relaygate.ai">` link, an attacker-controlled
  redirect that downgrades to plaintext, or a stray `javascript:` or
  `file:` URI all fail closed before any allowlist matching even runs.
  The same `https:` check is enforced in `resolveDashboardUrl` for the
  configurable backend URL, so even `RELAYGATE_DESKTOP_URL` cannot point
  the desktop window at a non-HTTP(S) target.

- **Why cross-compile DMG from Linux instead of using a Mac runner?**
  Cost. A persistent Mac host (Mac mini in office, MacStadium dedicated,
  MacinCloud daily) runs in the hundreds of dollars per month idle. The
  Mozilla fork of `libdmg-hfsplus` ships both a `dmg` UDIF writer and a
  `hfsplus` userspace HFS+ allocator that does not require the kernel
  HFS+ module — Cloud Build containers do not load kernel modules, so
  the userspace path is the only one that works. The combination builds
  an unsigned `.dmg` from a `.zip` of the `.app` bundle in roughly 30
  seconds inside the existing Linux Cloud Build job, with no Mac host
  required. The tradeoff is that the build is unsigned, so first-launch
  on macOS still pops a Gatekeeper warning. Signing requires real Mac
  hosts (the `cloudbuild-mac.yaml` skeleton is in place but inert until
  a host is provisioned) and an Apple Developer Program membership,
  both of which are tracked as `Horizon` in the feature map.

## 5. What's Different About This Approach

Most "wrapper" desktop apps fall into one of two failure modes. The
first is to bundle the entire web application into the binary — every
page, every asset, every JavaScript chunk shipped in the installer.
That gives you offline support and a pinned UI version, but it makes
installs huge (250 megabytes is typical), means you have to ship a new
desktop release for every dashboard fix, and means desktop users
perpetually run an older UI than web users.

The second failure mode is the careless thin wrapper: point Electron at
a hosted URL with `nodeIntegration: true`, no allowlist, no preload
bridge restrictions, and `webview` tags allowed. That is small and
fast, but it is also a remote-code-execution disaster waiting to
happen — a single XSS in the dashboard means the attacker has Node.js
inside the user's session, with full access to the file system, the
network, and any credentials the user has typed into the app.

RelayGate Desktop chose the careful version of the thin-wrapper
approach. Chromium runs sandboxed. The renderer has zero Node access.
The preload bridge exposes exactly three read-only fields (`version`,
`platform`, `arch`) and accepts no inbound calls. Every navigation —
in-window via `will-navigate`, new-window via `setWindowOpenHandler` —
passes through an explicit origin allowlist that is HTTPS-only and
that fails closed. `webview` tag attachment is preventDefault'd on
every web-contents creation.

The result is a wrapper that updates instantly when the dashboard
ships, weighs roughly 170 megabytes installed (versus 250-plus for
bundled-renderer alternatives), and has a security posture comparable
to a hardened browser profile rather than a trust-everything Electron
shell. That combination — instant updates plus hardened perimeter
plus small footprint plus zero release coordination overhead — is
what makes the wrapper-style architecture worth doing here, instead
of either of the easier-but-worse alternatives.

---
*Last updated: 2026-05-04*
