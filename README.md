# RelayGate Desktop

Native cross-platform GUI for RelayGate. Wraps the live dashboard at https://app.relaygate.ai in an Electron shell that runs on Linux, macOS, and Windows.

## What this is

RelayGate ships in three forms:
- **`app.relaygate.ai`** — the SaaS web dashboard (Next.js, hosted on Cloud Run). Source: `relaygate-app` repo.
- **`relaygate` CLI binary** — the Go OpenAI-compatible LLM routing gateway. Source: `RelayOne/relaygate` on GitHub. Cross-platform binaries published to `gs://relayone-488319-public/relaygate/{sha}/`.
- **RelayGate Desktop (this repo)** — Electron app for users who prefer a native window over a browser tab.

The desktop app is intentionally thin: it points the embedded Chromium at the live dashboard. Future releases may add a native control panel for managing a locally-running `relaygate` gateway binary.

## Quick start

```bash
nvm use            # node 20.18.1 per .nvmrc
npm install
npm run build      # compiles src/*.ts → dist/
npm run start      # launches Electron pointed at https://app.relaygate.ai
```

## Development

```bash
npm run dev        # tsc -w (rebuilds main process on change)
npm run typecheck  # tsc --noEmit
```

Run against a different backend (e.g., local dev or staging):

```bash
RELAYGATE_DESKTOP_URL=http://localhost:3000 npm run start
```

## Smoke test (Puppeteer)

```bash
npm run test:smoke
```

This launches the Electron app with `--remote-debugging-port`, attaches `puppeteer-core` via CDP, screenshots the rendered dashboard to `tests/artifacts/`, and asserts non-empty DOM.

## Distribution

Cross-platform builds use `electron-builder` driven by Cloud Build (`cloudbuild.yaml`). Artifacts publish to `gs://relayone-488319-public/relaygate-desktop/{COMMIT_SHA}/`:

| Platform | Format | Path |
|---|---|---|
| linux-x64 | AppImage, deb | `RelayGate-0.1.0-x64.AppImage`, `RelayGate-0.1.0-x64.deb` |
| linux-arm64 | AppImage, deb | `RelayGate-0.1.0-arm64.AppImage`, `RelayGate-0.1.0-arm64.deb` |
| darwin-x64 | dmg | `RelayGate-0.1.0-x64.dmg` |
| darwin-arm64 | dmg | `RelayGate-0.1.0-arm64.dmg` |
| windows-x64 | nsis exe | `RelayGate-Setup-0.1.0-x64.exe` |

Local one-platform build: `npm run dist:linux` (or `dist:mac`, `dist:win`). Output lands in `release/`.

## Repo layout

```
relaygate-desktop/
├── src/
│   ├── main.ts        # Electron main process entry
│   └── preload.ts     # contextBridge → renderer
├── tests/
│   └── smoke.test.ts  # Puppeteer smoke test
├── assets/
│   └── icon.png       # 1024×1024 app icon (electron-builder derives ICO/ICNS)
├── electron-builder.yml
├── cloudbuild.yaml
├── package.json
├── tsconfig.json
└── .work/             # plan files, progress logs, review transcripts
```

## Security

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` are enforced in `src/main.ts`.
- External links (any URL whose origin differs from the dashboard origin) open in the system browser, not inside the Electron window.
- `webview` tags are disallowed.
- No remote module access.

## Build SHA in app

Each build embeds its commit SHA via `electron-builder` `--config.extraMetadata.commit=$COMMIT_SHA` (set in `cloudbuild.yaml`). Visible at runtime via `window.relaygate.version` from the preload bridge.

## Environments

Single-branch model: `main` is the only env branch; protected against force-push and deletion (per portfolio spec 07).

