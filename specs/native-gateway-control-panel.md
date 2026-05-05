<!-- STATUS: ready -->
<!-- TYPE: feature -->
<!-- CREATED: 2026-05-05 -->
<!-- DEPENDS_ON: none -->
<!-- BUILD_ORDER: 2 -->

# Native gateway control panel — Implementation Spec

## Overview

The desktop wrapper today is a pure thin client around `app.relaygate.ai`. The gateway it administers (the `relaygate` Go binary, the OSS LLM-routing daemon at `github.com/RelayOne/relaygate`) typically runs on a server, but a meaningful fraction of users want to run it locally for development, air-gapped audits, or single-machine self-hosting. This spec adds first-class management of a *locally-running* `relaygate` instance from inside the desktop wrapper: the user picks where the binary lives, hits a "Start" button in the desktop's tray menu (or via an `IPC` call from the dashboard), the desktop wrapper spawns the process, streams its logs into a viewable panel, and stops/restarts on request.

## Stack & Versions

- Electron 35.x (existing)
- Node.js `child_process.spawn` for subprocess control (built-in)
- Electron `safeStorage` API for persisting the binary path setting (encrypts on Windows/macOS via OS keychain; passes through unencrypted on Linux unless `kwallet`/`gnome-libsecret` is installed — Electron docs note this explicitly)
- Native Electron `Tray` + `Menu` APIs (no new deps; built-in)
- relaygate CLI surface (read directly from `/home/eric/repos/relaygate/cmd/relaygate/main.go`):
  - Binary name: `relaygate`
  - Flags: `--config <path>`, `--version`, `--mcp` (MCP stdio mode — irrelevant here)
  - Default config: looks for `relaygate.yaml` then `router.yaml` in cwd
  - Listen address: from `listen:` field in YAML config (e.g. `:8090`, `127.0.0.1:0`)
  - Logs: structured JSON via Go's `slog` package, written to stderr
  - Health: `GET /health` returns `{"status":"ok","version":"<V>"}`
  - Single binary, single process, no daemon mode (foreground only)

## Why a separate spec from "OS notifications" + "System tray icon"

These three Horizon items share an integration touchpoint (the tray menu houses the start/stop control), but the gateway-control work has substantially more risk surface (subprocess management, log buffering, settings storage, IPC contract design, Linux path-finding for `relaygate` binary). Keeping it in its own spec prevents the tray icon spec from inheriting a 2-week schedule.

## Stack-relevant prior art

`src/main.ts` is a pure UI shell with no subprocess management today; this spec introduces the first child-process owner. We add a single `GatewayController` class that owns lifecycle and exposes a small API to both the tray menu (in-process) and the dashboard renderer (via IPC).

`src/preload.ts:3-26` already uses `contextBridge.exposeInMainWorld` to expose a small frozen object. We extend it with `gateway.{start, stop, status, onLog, onStateChange}` methods that proxy to `ipcMain` handlers. This keeps the renderer sandboxed; only the explicit methods cross the boundary.

## Security model

- **Binary path is user-chosen, validated, and persisted in safeStorage.** We do NOT auto-discover `relaygate` from `$PATH` — that's a supply-chain hole (any binary named `relaygate` in `$PATH` would run). Instead the user picks the file via a native file-open dialog the first time, the path is encrypted via Electron `safeStorage`, and on subsequent launches we validate (a) the file still exists, (b) `<binary> --version` exits 0 and prints `relaygate v<semver>`. If validation fails, we fall back to "no binary configured" state and prompt the user.
- **No shell invocation.** `child_process.spawn(binPath, args, { shell: false })`. Args list is constructed in code, never from string concatenation. Mitigates argv injection.
- **Subprocess inherits a minimal environment.** We do NOT pass through the Electron process's full env. We pass only `PATH` (from a curated list of `/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, `~/bin`) and `HOME`/`USERPROFILE`. The user can override via a settings field that's a per-key allow-list, not a free-form env block.
- **Log buffer cap.** Subprocess stderr is line-buffered into a ring of 5000 lines max. Prevents OOM if the gateway logs verbosely. Older lines are dropped silently, with a one-line `[truncated]` marker emitted on overflow.
- **Renderer cannot start arbitrary binaries.** The IPC `gateway.start` handler ignores any `path` argument from the renderer and uses ONLY the safeStorage-persisted path. The renderer can trigger start/stop but cannot redirect to a different binary. Path changes go through a separate `gateway.setBinaryPath(absPath)` IPC handler that validates and re-persists.

## Checklist

- [ ] **TASK-1**: Create `src/gateway/types.ts` with the public type contract:
  ```ts
  export type GatewayState = "stopped" | "starting" | "running" | "stopping" | "errored";
  export interface GatewayStatus {
    state: GatewayState;
    pid: number | null;
    binaryPath: string | null;
    binaryVersion: string | null;
    startedAt: string | null;       // ISO timestamp
    listenAddr: string | null;      // parsed from log line "relaygate listening addr=..."
    lastError: string | null;
  }
  export interface LogLine {
    timestamp: string;              // ISO
    level: "info" | "warn" | "error" | "debug";
    msg: string;
    fields: Record<string, unknown>; // parsed JSON keys minus level/msg/time
    raw: string;                    // original line
  }
  ```
  - VERIFY: `npm run typecheck` passes; types compile.

- [ ] **TASK-2**: Create `src/gateway/controller.ts` exporting class `GatewayController` with the following methods:
  - `constructor(opts: { onLog: (line: LogLine) => void; onStateChange: (s: GatewayStatus) => void })`
  - `async start(configPath?: string): Promise<void>` — spawns `relaygate` from the persisted binary path. If `configPath` provided, passes `--config <configPath>`. State transitions: stopped→starting→running once first stderr line is seen, OR stopped→errored if exit before first line / spawn error.
  - `async stop(): Promise<void>` — sends SIGTERM, waits 5s for graceful exit, falls back to SIGKILL.
  - `getStatus(): GatewayStatus`
  - `async setBinaryPath(absPath: string): Promise<{ valid: boolean; version: string | null; error: string | null }>` — validates by spawning `<absPath> --version` with 5s timeout, parses output for `relaygate v\d+\.\d+\.\d+`, persists via safeStorage on success, returns validation result.
  - `getBinaryPath(): string | null` — reads from safeStorage on demand.
  - Private: line-buffer stderr → JSON-parse → call `onLog`. Handle non-JSON lines as `level: "info", msg: <raw>, fields: {}`. Detect "relaygate listening" lines and pull `addr` field into `GatewayStatus.listenAddr`.
  - Process restart on crash: NO. If the gateway dies, transition to `errored`, surface `lastError`, do not auto-restart. User explicitly clicks Start.
  - VERIFY: `npm run typecheck` passes. Class is self-contained — no Electron imports inside controller.ts (pure Node), so it can be unit-tested with `tsx`.

- [ ] **TASK-3**: Create `src/gateway/storage.ts` with `getStoredBinaryPath()` and `setStoredBinaryPath(path: string)`. Uses `safeStorage` from Electron to encrypt+persist a single file `<userData>/gateway-binary-path.enc`. `userData` resolved via `app.getPath("userData")`. On platforms where `safeStorage.isEncryptionAvailable()` returns false (some Linux configs), still write the file but log a warning to stderr — the binary path is not a secret, it's just a setting; encryption is defense-in-depth.
  - VERIFY: `npm run typecheck` passes. `safeStorage` import comes from Electron (compile-time check that we're not breaking node-only imports).

- [ ] **TASK-4**: Wire `GatewayController` instance + IPC handlers in `src/main.ts`. After `app.whenReady()` and BEFORE `createMainWindow()`:
  ```ts
  const gateway = new GatewayController({
    onLog: (line) => mainWindow?.webContents.send("gateway:log", line),
    onStateChange: (s) => mainWindow?.webContents.send("gateway:state", s),
  });
  ipcMain.handle("gateway:start", (_e, configPath?: string) => gateway.start(configPath));
  ipcMain.handle("gateway:stop", () => gateway.stop());
  ipcMain.handle("gateway:status", () => gateway.getStatus());
  ipcMain.handle("gateway:setBinaryPath", (_e, absPath: string) => gateway.setBinaryPath(absPath));
  ipcMain.handle("gateway:getBinaryPath", () => gateway.getBinaryPath());
  ipcMain.handle("gateway:pickBinary", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], title: "Select relaygate binary" });
    if (result.canceled || !result.filePaths[0]) return null;
    return gateway.setBinaryPath(result.filePaths[0]);
  });
  ```
  - On `app.before-quit` event: call `gateway.stop()` and await (with 6s timeout) so the subprocess doesn't outlive the window.
  - VERIFY: `grep -n "ipcMain.handle.*gateway:" src/main.ts` lists 6 handlers.

- [ ] **TASK-5**: Extend `src/preload.ts` to expose a `gateway` namespace inside `window.relaygate`:
  ```ts
  contextBridge.exposeInMainWorld("relaygate", {
    // ...existing fields...
    gateway: {
      start: (configPath?: string) => ipcRenderer.invoke("gateway:start", configPath),
      stop: () => ipcRenderer.invoke("gateway:stop"),
      status: () => ipcRenderer.invoke("gateway:status"),
      setBinaryPath: (absPath: string) => ipcRenderer.invoke("gateway:setBinaryPath", absPath),
      getBinaryPath: () => ipcRenderer.invoke("gateway:getBinaryPath"),
      pickBinary: () => ipcRenderer.invoke("gateway:pickBinary"),
      onLog: (handler: (line: LogLine) => void) => {
        const wrapped = (_: unknown, line: LogLine) => handler(line);
        ipcRenderer.on("gateway:log", wrapped);
        return () => ipcRenderer.removeListener("gateway:log", wrapped);
      },
      onStateChange: (handler: (s: GatewayStatus) => void) => {
        const wrapped = (_: unknown, s: GatewayStatus) => handler(s);
        ipcRenderer.on("gateway:state", wrapped);
        return () => ipcRenderer.removeListener("gateway:state", wrapped);
      },
    },
  });
  ```
  - Note: `ipcRenderer` is allowed in preload despite `contextIsolation: true`. The render process never sees `ipcRenderer` directly; it only gets the wrapped functions via the contextBridge.
  - VERIFY: `grep -n "gateway:" src/preload.ts` shows 6 channel names; types compile.

- [ ] **TASK-6**: Add `tests/gateway.test.ts` integration test:
  1. Build a minimal mock `relaygate` binary via a 10-line shell script that emits 3 JSON-formatted log lines to stderr then sleeps. Place at `/tmp/mock-relaygate-<random>.sh`. `chmod +x`.
  2. Spawn Electron with `RELAYGATE_DESKTOP_URL=data:text/html,<script>...</script>` where the renderer script calls `window.relaygate.gateway.setBinaryPath('/tmp/mock-relaygate-<random>.sh')`, then `start()`, then `status()`. Assert state transitions: stopped → starting → running.
  3. Call `stop()`, assert state returns to `stopped` within 6s.
  4. Cleanup: remove mock script.
  - VERIFY: `npm run test:gateway` exits 0. Add the script to `package.json` scripts.

- [ ] **TASK-7**: Document the controller surface in `docs/ARCHITECTURE.md` — new subsection "Gateway controller" describing `src/gateway/{types,controller,storage}.ts` and the 6 IPC channels. Verbose, 3+ paragraphs covering the security model (binary-path-only-from-storage, no shell, log ring, renderer-cannot-redirect).
  - Then add a subsection in `docs/HOW-IT-WORKS.md` Section 2 explaining that the dashboard can call `window.relaygate.gateway.start()` and the desktop wrapper handles the rest.
  - VERIFY: both docs grep-positive for "gateway controller" and "GatewayController".

- [ ] **TASK-8**: FEATURE-MAP "Native gateway control panel" Horizon → Done. Reference path: `src/gateway/`.

## Out of scope for this spec (explicitly listed so future-you doesn't add it)

- A custom-built renderer UI inside the desktop wrapper. The dashboard at `app.relaygate.ai` is the renderer; it can render whatever it wants on top of the `window.relaygate.gateway` API. We provide the bridge, not the UI.
- Multiple gateway instances. Single instance per desktop process.
- Auto-launch on desktop startup. The user explicitly clicks Start.
- Config file editing. The dashboard can offer this via its own UI; the desktop wrapper just supplies the path to the gateway.
- Cross-process detection (e.g. detecting an externally-launched `relaygate` running on the same machine). Out of scope; only manages instances we spawned.
- Updating the `relaygate` binary itself (auto-update of the gateway). That belongs in the gateway's own update path, not the desktop wrapper.

## Validation

After all tasks pass:
- User picks `relaygate` binary via native dialog, path persists across desktop restarts.
- `window.relaygate.gateway.start()` from the dashboard JS spawns the process; logs stream into the dashboard via `onLog`.
- Stop is graceful (SIGTERM with 5s grace, SIGKILL fallback).
- Quitting the desktop kills the gateway subprocess (no orphaned process).
- Log ring caps at 5000 lines; `[truncated]` marker visible on overflow.
- Non-existent binary path or wrong-version binary surface `errored` state with helpful `lastError`.

## Rollback

Revert the commits. The new `src/gateway/` directory and the IPC handlers + preload extensions go away. No persistent state to clean except the `<userData>/gateway-binary-path.enc` file, which is harmless if left behind (a stale path, ignored on next install since the file won't exist).
