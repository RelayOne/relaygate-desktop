<!-- STATUS: ready -->
<!-- TYPE: feature -->
<!-- CREATED: 2026-05-05 -->
<!-- DEPENDS_ON: native-gateway-control-panel -->
<!-- BUILD_ORDER: 3 -->

# System tray icon — Implementation Spec

## Overview

A persistent system-tray (menu-bar / system-tray / Linux notification area) icon gives users a single click to start, stop, and inspect the local `relaygate` gateway, plus a fast path to show/hide the dashboard window — without keeping the dashboard window focused or even visible. Especially valuable for users running the gateway as a background service while doing other work.

## Stack & Versions

- Electron 35.x `Tray` API (`https://www.electronjs.org/docs/latest/api/tray`)
- Electron `Menu` API for the tray's right-click context menu
- `nativeImage` for loading platform-appropriate icon variants (template image on macOS for dark/light mode, transparent PNG on Windows/Linux)
- Depends on `GatewayController` from spec `native-gateway-control-panel.md` for state-aware menu items

## Why this depends on the gateway-controller spec

The whole point of the tray menu is to expose gateway lifecycle (Start / Stop / Open Logs / Show Dashboard / Quit). Without `GatewayController` there's nothing actionable to put in the menu beyond "Show Dashboard / Quit", which doesn't justify a tray icon. We build it on top.

## Stack-relevant prior art

`src/main.ts:142-204` (`buildAppMenu`) — same `Menu.buildFromTemplate` pattern; the tray menu reuses the structure. Items list builders accept `Electron.MenuItemConstructorOptions[]`.

`assets/icon.png` — existing app icon used by electron-builder for installers. We need separate tray-sized variants (16x16, 32x32 for high-DPI Windows; macOS uses a 22x22 template image).

## Tray icon assets

Three new icons under `assets/tray/`:
- `tray-iconTemplate.png` (22x22, monochrome black-on-transparent, with `@2x` variant `tray-iconTemplate@2x.png` at 44x44) — macOS treats `*Template.png` as a template image and recolors automatically for dark/light mode
- `tray-icon.png` (16x16) and `tray-icon@2x.png` (32x32) for Windows
- `tray-icon-linux.png` (24x24) for Linux notification areas

Icon design: simplified RelayGate "G" mark, single color. The user is expected to provide the source SVG; if absent, we generate placeholder PNGs in TASK-1 with a placeholder note.

## Checklist

- [ ] **TASK-1**: Create the 3 icon asset files under `assets/tray/`. Source SVG goes at `assets/tray/tray-icon.svg` (single-color G mark, 24x24 viewport). Use ImageMagick or `sharp` (CI has neither — pre-render locally). For now, copy the existing `assets/icon.png` into the 3 sizes via `cp` and `npx sharp-cli` (add devDep `sharp@^0.33`):
  ```
  npx sharp -i assets/icon.png -o assets/tray/tray-iconTemplate.png resize 22 22
  npx sharp -i assets/icon.png -o assets/tray/tray-iconTemplate@2x.png resize 44 44
  npx sharp -i assets/icon.png -o assets/tray/tray-icon.png resize 16 16
  npx sharp -i assets/icon.png -o assets/tray/tray-icon@2x.png resize 32 32
  npx sharp -i assets/icon.png -o assets/tray/tray-icon-linux.png resize 24 24
  ```
  Acceptable for initial ship: a slightly-fuzzy resize of the full icon. The user can replace with a proper monochrome variant later without code changes.
  - Add `assets/tray/` to `electron-builder.yml` `files:` so the icons get bundled.
  - VERIFY: all 5 PNG files exist and are <50KB each.

- [ ] **TASK-2**: Create `src/tray.ts` exporting `function createTray(opts: { gateway: GatewayController; mainWindow: () => BrowserWindow | null; quit: () => void }): Tray`. The function:
  1. Picks the right icon path: `process.platform === "darwin" ? "tray-iconTemplate.png" : process.platform === "win32" ? "tray-icon.png" : "tray-icon-linux.png"`. Resolve via `path.join(app.getAppPath(), "assets/tray", filename)`.
  2. Constructs `new Tray(nativeImage.createFromPath(iconPath))`.
  3. Sets `tray.setToolTip("RelayGate")`.
  4. Builds an initial menu via `buildTrayMenu(gateway.getStatus(), opts)`.
  5. Subscribes to `gateway.onStateChange` to rebuild the menu on every state transition (state-aware enabling/disabling of Start/Stop).
  6. On Windows + Linux: `tray.on("click", () => opts.mainWindow()?.show())` — single-click toggles dashboard visibility (matches platform conventions).
  7. On macOS: no click handler — macOS expects the tray icon to ONLY show the menu on click, not toggle visibility. Trying to toggle visibility on Mac creates a jarring UX.
  - VERIFY: `npm run typecheck` passes.

- [ ] **TASK-3**: `buildTrayMenu(status: GatewayStatus, opts)` returns `Menu.buildFromTemplate(template)` where template is:
  ```
  - "Show Dashboard" → opts.mainWindow()?.show()
  - "Hide Dashboard" → opts.mainWindow()?.hide()  (visible only on macOS, where Show/Hide are conventional)
  - separator
  - "Gateway: <state>" (label only, disabled, e.g. "Gateway: running on :8090")
  - "Start Gateway"  (enabled when state === "stopped" || "errored")
  - "Stop Gateway"   (enabled when state === "running")
  - "Open Logs..."   → emits IPC event "tray:open-logs" so the dashboard can render its log viewer (no-op if dashboard handler not wired yet)
  - "Configure Binary..." → calls gateway.pickBinary() via dialog
  - separator
  - "Quit RelayGate" → opts.quit()
  ```
  - The "Gateway: <state>" label includes `listenAddr` when running (e.g. "Gateway: running on :8090"), `binaryVersion` when stopped+configured (e.g. "Gateway: stopped (v1.1.0)"), or "Gateway: not configured" when no binary is set.
  - VERIFY: unit test in `tests/tray-menu.test.ts` that constructs a `GatewayStatus` for each of the 5 states and asserts the resulting label + which start/stop item is enabled.

- [ ] **TASK-4**: Wire `createTray` into `src/main.ts` after `app.whenReady()`, after `GatewayController` instantiation:
  ```ts
  const tray = createTray({
    gateway,
    mainWindow: () => BrowserWindow.getAllWindows()[0] ?? null,
    quit: () => { app.quit(); },
  });
  // Keep `tray` referenced so V8 doesn't GC it.
  ```
  - On `app.before-quit`: `tray.destroy()` to release the platform handle.
  - VERIFY: `grep -n "createTray" src/main.ts` shows the call.

- [ ] **TASK-5**: Window-close behavior change for non-macOS: by default `app.on("window-all-closed", ...)` quits. With a tray icon that's wrong — closing the window should hide it, leaving the tray + gateway running. New behavior:
  - macOS: unchanged (close button hides; `Cmd-Q` quits).
  - Windows + Linux: intercept `BrowserWindow#close` event with `event.preventDefault(); win.hide();` so the X button hides; "Quit RelayGate" tray item OR `app.quit()` actually quits. Add an `app.isQuitting` flag set in the quit handler so `before-quit` lets the close go through cleanly.
  - VERIFY: integration test launches Electron, sends close-window IPC, asserts process is still alive 2s later, sends quit, asserts process exits.

- [ ] **TASK-6**: Linux notification-area compatibility check. Per Electron docs (`https://www.electronjs.org/docs/latest/api/tray#platform-considerations`), modern GNOME removed the system tray ("StatusNotifierItem") in 2017 and only re-added partial support via the `gnome-shell-extension-appindicator` extension. Add a documented fallback in `src/tray.ts`: if `Tray` construction throws or returns null on Linux (some headless environments), log to stderr and continue without a tray. Window-close-hides behavior is then conditional on tray being live: if tray is null, window-close should still quit (otherwise the app becomes unkillable).
  - VERIFY: `grep -A3 "tray construction" src/tray.ts` shows a try/catch with the fallback.

- [ ] **TASK-7**: Document the tray menu structure + Linux limitations in `docs/HOW-IT-WORKS.md` (Section 2, new subsection "Tray icon and lifecycle"). Verbose, 4+ sentences. Then update `docs/ARCHITECTURE.md` to list `src/tray.ts` in the file map.

- [ ] **TASK-8**: FEATURE-MAP "System tray icon" Horizon → Done.

## Validation

After all tasks pass:
- A tray icon appears on macOS menu bar / Windows system tray / Linux notification area (when supported).
- Right-click (or left-click on macOS) shows the menu with state-aware Start/Stop items.
- Closing the dashboard window on Windows/Linux hides it but keeps the tray running.
- Quitting via tray menu OR Cmd-Q on macOS cleanly stops the gateway and exits.
- Linux without StatusNotifierItem support: app launches, no tray, close-window quits as before.

## Rollback

Revert the commits. `src/tray.ts` and the icon assets disappear. Default `window-all-closed` behavior comes back. No persistent state to clean.
