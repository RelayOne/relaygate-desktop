<!-- STATUS: ready -->
<!-- TYPE: feature -->
<!-- CREATED: 2026-05-05 -->
<!-- DEPENDS_ON: dashboard-dev-staging-routing, cloudbuild-env-paths, cloudbuild-triggers-dev-staging -->
<!-- BUILD_ORDER: 4 -->

# Desktop wrapper env-aware default URL — Implementation Spec

## Overview

Currently `src/main.ts:4` hardcodes `DEFAULT_DASHBOARD_URL = "https://app.relaygate.ai"`. With dev/staging branches now real and dev/staging dashboard hostnames live (per the dashboard-dev-staging-routing spec), dev and staging desktop builds should default to their matching dashboard host. We embed the build env at build time via `electron-builder`'s `--config.extraMetadata.env` (same path the existing `commit` field uses) and read it at runtime from the bundled `package.json`. The `RELAYGATE_DESKTOP_URL` env var keeps overriding everything (existing dev-loop UX).

## Stack & Versions

- electron-builder is already invoked with `--config.extraMetadata.commit=$COMMIT_SHA` (`cloudbuild.yaml:50`); we add `--config.extraMetadata.env=${_ENV}` alongside it
- `extraMetadata` injects fields into the `package.json` shipped inside the `.asar` bundle, retrievable at runtime via `app.getAppPath()` + `require('./package.json')` or `JSON.parse(fs.readFileSync(...))`
- TypeScript 5.x (existing dep)
- The origin allowlist (`src/main.ts:27-50`) currently includes only prod `app.relaygate.ai`. Dev/staging hostnames must be added so the navigation guards don't reject the dashboard's own self-navigations.

## URL mapping

| Embedded env | Default URL |
|---|---|
| `prod` (or missing) | `https://app.relaygate.ai` |
| `staging` | `https://app.staging.relaygate.ai` |
| `dev` | `https://app.dev.relaygate.ai` |

`process.env.RELAYGATE_DESKTOP_URL` still overrides regardless of embedded env. This preserves the dev-loop UX of pointing a prod-built binary at localhost or staging.

## Stack-relevant prior art

`src/main.ts:6-22` — `resolveDashboardUrl()` is the single chokepoint we extend. It already handles fallback on invalid env-var input; we just change what "default" means based on embedded build env.

`docs/FEATURE-MAP.md` lists "Configurable backend URL" as Done — this spec adds an env-aware default while preserving the env-var override semantic, which is a refinement, not a contradiction.

## Checklist

- [ ] **TASK-1**: Update `cloudbuild.yaml` `dist-all-platforms` step to pass `_ENV` to electron-builder.
  - Find the line `npx electron-builder --linux --win --mac --x64 --arm64 --config.extraMetadata.commit=$COMMIT_SHA --publish never` (currently `cloudbuild.yaml:49-51`).
  - Replace with: `npx electron-builder --linux --win --mac --x64 --arm64 --config.extraMetadata.commit=$COMMIT_SHA --config.extraMetadata.env=${_ENV} --publish never`.
  - VERIFY: `grep -n 'extraMetadata.env' cloudbuild.yaml` shows the new flag in the dist step.

- [ ] **TASK-2**: Add a `BUILD_ENV` constant and updated `resolveDashboardUrl()` in `src/main.ts`.
  - At top of file, add a function that reads the embedded `package.json`. Pattern:
    ```ts
    type BuildEnv = "prod" | "staging" | "dev";
    function readBuildEnv(): BuildEnv {
      try {
        const pkg: { env?: string } = require(path.join(app.getAppPath(), "package.json"));
        if (pkg.env === "dev" || pkg.env === "staging") return pkg.env;
        return "prod";
      } catch {
        return "prod";
      }
    }
    const BUILD_ENV: BuildEnv = readBuildEnv();
    ```
  - Add a `DEFAULT_DASHBOARD_URL_BY_ENV` map:
    ```ts
    const DEFAULT_DASHBOARD_URL_BY_ENV: Record<BuildEnv, string> = {
      prod: "https://app.relaygate.ai",
      staging: "https://app.staging.relaygate.ai",
      dev: "https://app.dev.relaygate.ai",
    };
    ```
  - Replace the existing `DEFAULT_DASHBOARD_URL` constant: instead of a const string, compute `const DEFAULT_DASHBOARD_URL = DEFAULT_DASHBOARD_URL_BY_ENV[BUILD_ENV];`
  - The existing `resolveDashboardUrl()` function does NOT need to change beyond that — `process.env.RELAYGATE_DESKTOP_URL` still overrides, fallback message in the catch block still references `DEFAULT_DASHBOARD_URL` (now env-aware, so the message is correct).
  - Note: `app.getAppPath()` is only safe AFTER `app` is ready. Currently `resolveDashboardUrl()` is called at module-load time (line 24). For `app.getAppPath()`, see Electron docs: it's actually callable before `app.ready` — it returns the path of the bundled app. Verify by reading the linked Electron docs: `https://www.electronjs.org/docs/latest/api/app#appgetapppath`. If it requires `app.ready`, defer the resolution to inside `app.whenReady()` and pass the URL into the existing `createWindow` flow.
  - VERIFY: `npm run typecheck` passes; the resolved URL switches with the embedded env.

- [ ] **TASK-3**: Add `app.dev.relaygate.ai` and `app.staging.relaygate.ai` to the `EXTERNAL_ORIGIN_ALLOWLIST` in `src/main.ts:27-50`.
  - Add two entries: `"https://app.dev.relaygate.ai"` and `"https://app.staging.relaygate.ai"`.
  - Why: when the dashboard is loaded into the Electron BrowserWindow, internal navigations (NextAuth signin redirect, etc.) bounce within the dashboard origin. The `will-navigate` and window-open guards check this allowlist. Without these entries, dev/staging desktop builds reject the dashboard's own oauth roundtrip.
  - VERIFY: `grep -E '"https://app\.(dev|staging)\.relaygate\.ai"' src/main.ts` shows both entries.

- [ ] **TASK-4**: Expose `BUILD_ENV` to the renderer via the existing preload bridge, alongside the existing `commit` field, so the dashboard can show "Connected to dev/staging/prod" in its UI if desired.
  - Read `src/preload.ts`, find the existing `relaygate.commit` exposure pattern, mirror it for `env`. Pattern (read first to confirm shape):
    ```ts
    contextBridge.exposeInMainWorld("relaygate", {
      version: process.env.npm_package_version,
      commit: process.env.npm_package_commit,
      env: process.env.npm_package_env,
    });
    ```
    `npm_package_*` env vars are auto-populated by Node from the bundled `package.json` when running under `npm` / Electron's launcher; if Electron's preload context doesn't get those, fall back to reading `package.json` directly.
  - VERIFY: existing `version`/`commit` exposure pattern is preserved; `env` is added in the same shape.

- [ ] **TASK-5**: Add a unit-or-integration test that asserts the env-default mapping. Smoke test in `tests/smoke.test.ts` or a new `tests/env-url.test.ts`. Cases:
  - `BUILD_ENV=prod` (or unset) → URL contains `app.relaygate.ai` (no dev/staging subdomain).
  - `BUILD_ENV=staging` → URL is `https://app.staging.relaygate.ai`.
  - `BUILD_ENV=dev` → URL is `https://app.dev.relaygate.ai`.
  - `RELAYGATE_DESKTOP_URL=...` env var still wins regardless of `BUILD_ENV`.
  - VERIFY: `npm run test:smoke` (or whatever test runner the repo uses for unit tests — check `package.json` scripts) passes.

- [ ] **TASK-6**: Update `docs/HOW-IT-WORKS.md` and `docs/ARCHITECTURE.md` (whichever covers the URL resolution today) to describe the env-aware default + override precedence. Verbose paragraph form, not just a bullet.
  - VERIFY: docs contain the precedence rule (env var > embedded env > fallback prod) and the URL table.

- [ ] **TASK-7**: Update `docs/FEATURE-MAP.md` "Configurable backend URL" row to mention env-aware defaults explicitly.
  - VERIFY: row text updated.

- [ ] **TASK-8**: Validation build. Push the change to `dev`. The dev push-trigger (existing after the cloudbuild-triggers-dev-staging spec is built) fires a build with `_ENV=dev`. Download a dev arm64 deb from `gs://relayone-488319-public/relaygate-desktop/dev/latest/RelayGate-0.1.0-arm64.deb`, install, launch, confirm it loads `app.dev.relaygate.ai` (not `app.relaygate.ai`). 
  - This validation requires a Linux x64 or arm64 host or VM. If unavailable, alternate validation: extract the AppImage's resources, find the bundled `package.json`, confirm `env: "dev"` is present and `DEFAULT_DASHBOARD_URL_BY_ENV[BUILD_ENV]` maps to the dev URL.
  - VERIFY: bundled package.json has `env: "dev"` for dev build; `env: "staging"` for staging build (after promote); `env: "prod"` for prod main build (after promote).

## Rollback

Source-side: revert the commits. The bundled `extraMetadata.env` field is purely additive — older client builds without the field default to `prod`, so partial rollback (some users on old binaries, some on new) is safe.

## Validation

After all tasks pass:
- A `dev`-built binary loads `app.dev.relaygate.ai` by default.
- A `staging`-built binary loads `app.staging.relaygate.ai` by default.
- A `main`-built binary loads `app.relaygate.ai` (unchanged).
- `RELAYGATE_DESKTOP_URL` env var override still wins regardless.
- Origin allowlist accepts dev/staging dashboard origins.
