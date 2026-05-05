<!-- STATUS: in-progress -->
<!-- TYPE: feature -->
<!-- CREATED: 2026-05-05 -->
<!-- BUILD_STARTED: 2026-05-05 -->
<!-- DEPENDS_ON: none -->
<!-- BUILD_ORDER: 1 -->

# OS notifications — Implementation Spec

## Overview

The dashboard at `app.relaygate.ai` should be able to surface OS-level notifications through the desktop wrapper for budget alerts, provider outages, relay errors, and similar event-driven signals — without requiring the dashboard window to be focused. The browser-tab version of the dashboard already uses the W3C Notifications API for the same purpose, but the Notifications API in Electron's renderer requires the desktop wrapper to (a) set the right `appUserModelID` on Windows, (b) wire `NotificationService` permission grants on Linux, and (c) be cooperative when the dashboard calls `new Notification(...)`. This spec adds that plumbing without introducing any new IPC surface — we let Chromium's built-in Notification API work end-to-end and just configure the wrapping correctly.

## Stack & Versions

- Electron 35.x (existing dependency, `^35.7.5`)
- Chromium's W3C Notifications API in the renderer (browser-native; no IPC needed)
- Per Electron docs (`https://www.electronjs.org/docs/latest/tutorial/notifications`): the renderer's `Notification` constructor works out-of-the-box; the main process only needs to set `appUserModelID` for Windows and grant the renderer's permission requests via the Session API
- Existing `src/main.ts` security posture: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. We do NOT loosen any of these.

## Why this is a small spec

The dashboard already calls `Notification.requestPermission()` and `new Notification(...)`. In a browser tab those work via the OS's notification daemon (Notification Center on macOS, Action Center on Windows, libnotify on Linux). In Electron, the renderer is sandboxed and Chromium's notification path requires:

1. **Windows**: `app.setAppUserModelId(...)` so the notification toast attributes correctly to "RelayGate" instead of "Electron".
2. **Permission requests**: by default, Electron's permission handler **denies all** renderer-initiated permissions. We must add a `session.defaultSession.setPermissionRequestHandler` that allow-lists `notifications` for the dashboard's origin (and only the dashboard's origin — same allowlist semantics as the existing `EXTERNAL_ORIGIN_ALLOWLIST`).
3. **Linux**: no extra config; libnotify-aware desktop environments (GNOME, KDE) handle it via Chromium's built-in dbus call. Headless Linux (no notification daemon) silently degrades — `Notification` constructs and immediately fires `onerror`. Acceptable.

No IPC bridge changes needed. The dashboard JS calls `new Notification('Budget alert', { body: '...' })` and the toast appears.

## Stack-relevant prior art

`src/main.ts:27-69` (`EXTERNAL_ORIGIN_ALLOWLIST` + `isAllowedExternalOrigin`) — we reuse this exact predicate to decide which renderer origins can request notification permission.

`src/main.ts:80-96` (`createMainWindow` `webPreferences`) — security posture stays identical; this spec adds NO new `webPreferences` flags.

## Checklist

- [ ] **TASK-1**: Add `app.setAppUserModelId('ai.relaygate.desktop')` early in main.ts boot, ideally inside `app.whenReady().then(...)` before `buildAppMenu()`. The string must match the `appId` in `electron-builder.yml` (`ai.relaygate.desktop`) so Windows associates the notification with the installed app entry rather than showing "Electron" in the toast.
  - VERIFY: `grep -n "setAppUserModelId" src/main.ts` shows the call. The exact string MUST be `'ai.relaygate.desktop'` (matches electron-builder.yml).
  - Behavior on macOS/Linux: `setAppUserModelId` is a no-op on non-Windows platforms per Electron docs; the call is safe to make unconditionally.

- [ ] **TASK-2**: Install a `setPermissionRequestHandler` on `session.defaultSession` that approves `notifications` requests when the requesting URL's origin is in the existing `EXTERNAL_ORIGIN_ALLOWLIST` (or matches one of the `ALLOWED_HOST_SUFFIXES` for `.relaygate.ai`/`.relayone.ai`). Deny ALL other permission types unconditionally. This must run inside `app.whenReady()` BEFORE the first `BrowserWindow` is created so the handler is in place when the dashboard JS first calls `Notification.requestPermission()`.
  - Imports needed: `import { session } from "electron";` (extend existing `electron` import line at `src/main.ts:1`).
  - Code shape:
    ```ts
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      if (permission !== "notifications") {
        callback(false);
        return;
      }
      const requestingOrigin = details.requestingUrl
        ? safeOriginOf(details.requestingUrl)
        : null;
      if (requestingOrigin && isAllowedExternalOrigin(requestingOrigin)) {
        callback(true);
        return;
      }
      process.stderr.write(
        `[main] notification permission denied for ${requestingOrigin ?? "<unknown>"}\n`,
      );
      callback(false);
    });
    ```
  - `safeOriginOf` helper: a 5-line wrapper around `new URL(rawUrl).origin` that returns `null` on parse failure. Add it next to existing `safeUrlForLog` helper (`src/main.ts:71-78`).
  - VERIFY: `grep -n setPermissionRequestHandler src/main.ts` shows the handler. Permission types other than `notifications` are always rejected.
  - Note: do NOT use the deprecated `setPermissionCheckHandler` for the synchronous permission check — that defaults to allow-list-after-first-grant on most platforms, which is fine. Only the request handler needs explicit allowlisting.

- [ ] **TASK-3**: Add an integration smoke test in `tests/notifications.test.ts` that:
  1. Launches Electron pointing at a `data:` URL whose body is `<script>Notification.requestPermission().then(p => document.title = p)</script>`.
  2. Waits for the document title to read either `"granted"` or `"denied"`.
  3. Asserts: when origin is `data:` (not in allowlist) → `denied`; when env var `RELAYGATE_DESKTOP_URL` is set to an allowlist origin → `granted`.
  4. The test does NOT need to verify the OS-level toast actually rendered — that requires a notification daemon and varies across Linux DEs. The permission grant is the contract.
  - Run via the existing `tsx` runner. Add an `npm run test:notifications` script to `package.json`.
  - VERIFY: `npm run test:notifications` exits 0 in CI's xvfb environment.

- [ ] **TASK-4**: Document the permission posture in `docs/HOW-IT-WORKS.md` Section 2 (Technical Overview). Add a paragraph under the existing "Step 5, first render" walkthrough explaining that notifications work via the dashboard's `Notification` API and the desktop wrapper allowlists the origin via `setPermissionRequestHandler`. Verbose, 4-6 sentences.
  - VERIFY: `grep -A2 setPermissionRequestHandler docs/HOW-IT-WORKS.md` finds the explanation.

- [ ] **TASK-5**: Update `docs/FEATURE-MAP.md` "OS notifications" row from Horizon → Done with the file references.
  - VERIFY: row says `Done | src/main.ts:N` for whichever line range the new handler lands at.

## Validation

After all tasks pass:
- Dashboard JS `new Notification('test', { body: 'foo' })` works on a packaged build.
- Windows toast attributes to "RelayGate" (verified by visual inspection on a dev Windows VM, or by inspecting the notification XML if available).
- Non-allowlisted origins (e.g. opening a malicious link in a captive `data:` URL) get `denied`.
- No new IPC surface, no `webPreferences` weakening, no new dependencies.

## Rollback

Revert the commits. The dashboard's `Notification` calls fall back to silent denial (Chromium's default permission handler), which is what they did before this spec. No state to clean up.
