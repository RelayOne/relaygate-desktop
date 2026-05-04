# Build Plan — infra-docs-cleanup

Spec: `specs/infra-docs-cleanup.md`
Branch: `repair/infra-docs-cleanup`
Type: REPAIR (no TDD, fix() commits — but since these are pure infra/doc changes,
       commit prefixes will follow conventional types: `chore` for config,
       `docs` for documentation. Both count as task commits.)
Started: 2026-05-04

## Note on commits

Tasks 3+4 (README + FEATURE-MAP) bundle into ONE commit per spec instructions.
Tasks 5+6 (ARCHITECTURE + HOW-IT-WORKS) bundle into ONE commit per spec instructions.
Tasks 7+8 (DEPLOYMENT + BUSINESS-VALUE) bundle into ONE commit per spec instructions.
This is explicit in the spec's "Build Order Summary" section.

So: 8 plan items, 5 task commits, plus the existing checkpoint commit and a final docs commit if any drift remains.

## Tasks

- [x] **TASK-1** — F1: Add `*.dmg` to `.work/proof/binaries/` ignore list in `.gitignore` — STATUS: FIXED (commit: 7c53dda)
  - MUST: insert `.work/proof/binaries/*.dmg` between the `*.exe` line and the `!SHA256SUMS.txt` negation
  - MUST: validation script in spec passes (probe.dmg ignored)
  - MUST: commit message exactly: `chore(gitignore): exclude .work/proof/binaries/*.dmg`

- [ ] **TASK-2** — F3: Replace placeholder commands in repo `CLAUDE.md` — STATUS: BLOCKED (harness `.claude/settings.json` denies Edit/Write/MultiEdit on CLAUDE.md and `guard-bash-writes.sh` blocks bash writes; user must perform this edit manually OR remove the deny rule. Presenting to user at end.)
  - MUST: replace `## Commands` block with real npm scripts from package.json
  - MUST: replace `## Structure` block with single-package wording
  - MUST: leave `## Docs`, `## Compaction`, `## Rules` sections unchanged
  - MUST: validation script in spec passes (every listed npm-run command exists)
  - MUST: commit message exactly the multi-line message in spec

- [x] **TASK-3** — F2a: Mirror root `README.md` to `docs/README.md` — STATUS: FIXED (commit: 1203fb7)
  - MUST: `cp README.md docs/README.md`
  - MUST: `diff -u README.md docs/README.md` produces no output
  - DO NOT commit alone — bundle with TASK-4

- [x] **TASK-4** — F2b: Rewrite `docs/FEATURE-MAP.md` with verbose feature inventory — STATUS: FIXED (commit: 1203fb7)
  - MUST: include all 5 domain sections from spec (Distribution, Application shell, Security, CI / Build infrastructure, Testing)
  - MUST: every status string drawn from {Done, In Progress, Scoped, Scoping, Horizon}
  - MUST: footer line `*Last updated: 2026-05-04*`
  - MUST: ≥ 50 lines
  - MUST: bundle with TASK-3 in single commit, exact message from spec

- [x] **TASK-5** — F2c: Rewrite `docs/ARCHITECTURE.md` with real architecture — STATUS: FIXED (commit: 2a6894c)
  - MUST: 11 numbered sections from spec (Overview through Testing Architecture)
  - MUST: tech stack table with exact versions (Electron 35.7.5, TS 5.7.3, Node 20.18.1, electron-builder 25.1.8)
  - MUST: ≥ 150 lines
  - MUST: footer `*Last updated: 2026-05-04*`
  - DO NOT commit alone — bundle with TASK-6

- [x] **TASK-6** — F2d: Rewrite `docs/HOW-IT-WORKS.md` with user journey + technical — STATUS: FIXED (commit: 2a6894c)
  - MUST: 6 sections from spec (User Journey, Technical Overview, System Flow Diagram, Key Technical Decisions, What's Different, footer)
  - MUST: ASCII diagram present
  - MUST: 5 Key Technical Decisions bullets covering Electron-vs-Tauri, no-renderer, allowlist, https-only, cross-compile-DMG
  - MUST: ≥ 120 lines
  - MUST: bundle with TASK-5 in single commit, exact message from spec

- [x] **TASK-7** — F2e: Rewrite `docs/DEPLOYMENT.md` with full pipeline docs — STATUS: FIXED (commit: e99892c)
  - MUST: 10 sections from spec (Overview through Rollback)
  - MUST: substitution table covering $COMMIT_SHA, $SHORT_SHA, $BUILD_ID, $PROJECT_ID, $_MAC_RUNNER_HOST, $_MAC_RUNNER_USER
  - MUST: cloudbuild.yaml step list 1-6 (install, typecheck, build-main, dist-all-platforms, build-mac-dmg, publish)
  - MUST: rollback bash snippet present
  - MUST: ≥ 130 lines
  - DO NOT commit alone — bundle with TASK-8

- [x] **TASK-8** — F2f: Rewrite `docs/BUSINESS-VALUE.md` as pitch deck — STATUS: FIXED (commit: e99892c)
  - MUST: 11 sections from spec (Problem through Team Advantage, footer)
  - MUST: ZERO code blocks
  - MUST: marketing language, no jargon
  - MUST: ≥ 120 lines
  - MUST: use `[TBD]` for unknown numbers — never invent metrics
  - MUST: bundle with TASK-7 in single commit, exact message from spec

## Final verification (after TASK-8)

```bash
# All commands in CLAUDE.md exist:
grep -E '^# [a-z]' CLAUDE.md | sed -E 's/.*npm run ([a-z:]+).*/\1/' | sort -u | while read c; do
  jq -e ".scripts[\"$c\"]" package.json > /dev/null && echo "OK: $c" || echo "MISSING: $c"
done

# All docs are >100 lines:
wc -l docs/{README,ARCHITECTURE,HOW-IT-WORKS,FEATURE-MAP,DEPLOYMENT,BUSINESS-VALUE}.md

# No template scaffolding strings remain:
grep -E '\[Project Name\]|\[Feature name\]|EDIT THESE|YYYY-MM-DD' docs/*.md CLAUDE.md && echo FAIL || echo PASS

# .gitignore covers dmg:
grep -E '\.work/proof/binaries/\*\.dmg' .gitignore && echo PASS || echo FAIL

# Commits on branch:
git log main..HEAD --oneline
```
