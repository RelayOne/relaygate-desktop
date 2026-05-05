# Project

## Commands
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

## Structure
- Single-package Electron app. Entry point `src/main.ts` (main process), `src/preload.ts` (contextBridge).
- Build output: TypeScript -> `dist/` -> electron-builder packs into `release/`.
- CI cross-compiles linux+win+mac.zip from Linux; DMG via libdmg-hfsplus userspace in same Linux pipeline.
- No renderer code in this repo — Electron loads the live dashboard at `https://app.relaygate.ai`.

## Docs
Project docs live in `docs/` and must be updated at every phase transition.
Files: README.md, ARCHITECTURE.md, HOW-IT-WORKS.md, FEATURE-MAP.md, DEPLOYMENT.md, BUSINESS-VALUE.md
Each has status sections: Done / In Progress / Scoped / Scoping / Potential-On Horizon.
Doc updates get their own git commit. Always.

## Compaction
When compacting, preserve: current plan file path, all modified file paths, build/test results.

## Rules
- Never classify failures as "pre-existing" to skip them. ALL failures are findings. Present to user. User decides.
- FIXED requires a commit hash: "STATUS: FIXED (commit: abc1234)". Hooks verify the hash exists in git.
- BLOCKED is honest. Use it when you genuinely can't fix something. Present BLOCKED items to user for triage.
- USER-SKIPPED requires explicit user approval via AskUserQuestion before writing.
- Always write findings to a report file (audit/ or plans/) BEFORE presenting them verbally.
