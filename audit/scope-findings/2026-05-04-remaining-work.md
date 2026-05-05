# Scope Findings — 2026-05-04

## Repo state at start of /scope

- Branch: `main`
- Last 5 commits: Mac DMG CI work closed cleanly (`2e5a4de close: mac DMG now actually shipping in CI`)
- No `plans/*.md` (resume found nothing in-flight)
- No `audit/fix-tasks/*.md`
- Working tree:
  - `M .gitignore` (added Claude harness paths)
  - Untracked: `CLAUDE.md`, `docs/{README,ARCHITECTURE,HOW-IT-WORKS,FEATURE-MAP,DEPLOYMENT,BUSINESS-VALUE}.md`, `specs/`, `.work/proof/binaries/RelayGate-0.1.0-{x64,arm64}.dmg`

## What's working (no fix needed)

- **Code (`src/main.ts`, `src/preload.ts`):** solid Electron wrapper. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, URL parsing with allowlist (exact origins + suffix matching), `will-navigate` + `setWindowOpenHandler` filtering, `will-attach-webview` blocked. `RELAYGATE_DESKTOP_URL` env override with safe fallback. No security gaps observed.
- **Tests:** `tests/smoke.test.ts` (246 lines) and `tests/live-dashboard.test.ts` (489 lines) exist. Puppeteer-CDP wired via `npm run test:smoke`.
- **CI:** `cloudbuild.yaml` (Linux/Win cross-compile) + `cloudbuild-mac.yaml` (DMG via libdmg-hfsplus userspace). Both passing per recent commits. Auto-trigger on push wired (`e1b12fa close(followups): CB trigger DONE`). Artifacts ship to `gs://relayone-488319-public/relaygate-desktop/{sha}/`.
- **Build configs:** `electron-builder.yml` covers Linux (AppImage+deb x64/arm64), Mac (zip x64/arm64), Win (nsis x64). `electron-builder.mac.yml` adds DMG when run on macOS host. Hardened runtime gated on signing env vars.
- **Root README.md:** real content, accurate, not a scaffold.
- **docs/MAC_BUILD.md:** real content (4KB).

## Findings (impact-effort filtered)

### F1 — `.gitignore` missing `*.dmg` pattern  ·  AUTOMATIC FIX

Pattern list excludes `*.AppImage`, `*.deb`, `*.zip`, `*.exe` under `.work/proof/binaries/` but not `*.dmg`. Two unsigned DMGs (~200MB total) currently sit untracked and would be added by a careless `git add .work/`. The DMG support landed in commit `de082d2` and the gitignore was never updated to match. Trivial one-line fix.

**Impact:** prevents accidental ~200MB blob commit. **Effort:** 1 line.

### F2 — Project docs are unfilled scaffolds  ·  FIX IF REASONABLE

`docs/README.md`, `docs/ARCHITECTURE.md`, `docs/HOW-IT-WORKS.md`, `docs/FEATURE-MAP.md`, `docs/DEPLOYMENT.md`, `docs/BUSINESS-VALUE.md` are all template placeholders with `[Project Name]`, `<!-- WHAT: -->`, `[Feature name]` etc. The actual codebase has shipped CI, security model, and 3-platform distribution that is nowhere documented in these files. Project CLAUDE.md is emphatic: "docs must be updated at every phase transition." Mac DMG just shipped — that's a phase transition.

**Impact:** new contributor / investor / user reading `docs/` learns nothing about RelayGate Desktop. Also: `docs/FEATURE-MAP.md` should track what's done vs roadmap, and currently does neither. **Effort:** moderate — 6 docs to write, but content is derivable from existing code + commits.

### F3 — Repo `CLAUDE.md` has placeholder commands  ·  AUTOMATIC FIX (trivial)

`CLAUDE.md` ships with `# build: npm run build` etc. as comments under `# EDIT THESE:`. Lists `npm test` and `npm run lint` which don't exist in `package.json`. Should reflect actual commands: `npm run build`, `npm run typecheck`, `npm run test:smoke`, `npm run start`, `npm run dist:linux|mac|win`.

**Impact:** Claude harness in this repo will try to run nonexistent commands. **Effort:** 1 minute.

### F4 — `.work/proof/binaries/*.dmg` artifacts present, owned by root  ·  USER-DECIDE

Two DMG files in `.work/proof/binaries/` are owned by root (the rest of the binaries are eric:eric). They were dropped there by the local CI/Docker run that produced them. They will be ignored once F1 lands; the question is whether to leave them on disk as proof binaries (they're already in the SHA256SUMS pattern) or remove them. Not a fix — a housekeeping question.

## Items deliberately NOT scoped (auto-dropped per impact filter)

- **Code signing (mac + win):** real value, but a spend decision (Apple Developer $99/yr, EV cert $300+/yr). User must approve.
- **Auto-update (electron-updater):** feature work. Useful for a shipped product, not "remaining" right now. Defer.
- **Native local-gateway control panel:** roadmap item per README ("Future releases may add..."). Not in flight.
- **Migrating tests to a real framework (vitest/jest):** current `tsx`-direct tests work. No business reason to swap.
- **Renovate/dependabot, lint setup, CONTRIBUTING.md, etc.:** style preferences, not user-facing.

## Recommended next action

Build F1 + F2 + F3 as one infra-doc commit cluster. F4 is a 30-second user-decide.
