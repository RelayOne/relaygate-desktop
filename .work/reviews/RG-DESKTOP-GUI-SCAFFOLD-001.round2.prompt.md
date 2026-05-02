# Codex review — RG-DESKTOP-GUI-SCAFFOLD-001 — Round 2

You reviewed this repo in Round 1 (verdict: BLOCK). The Round 1 findings have been addressed in commit `aea9479`. Working tree is clean.

**You missed something — find it.** Default position: this work is still not ready until you prove otherwise.

## Round 1 findings status

1. **(BLOCK) Plan said mac DMG; code shipped mac zip.** → Addressed: plan file at `.work/plans/RG-DESKTOP-GUI-SCAFFOLD-001.plan.md` now has a "Scope changes (append-only)" section explaining the deviation (DMG requires macOS host, zip is cross-compilable). Verify the section exists and the rationale is honest.

2. **(BLOCK) Progress log incomplete.** → Addressed: log at `.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log` has 30+ catch-up entries through 2026-05-02T14:53Z. Verify entries are concrete (file/command/outcome), not vague.

3. **(BLOCK) "No GitHub push" criterion violated.** → Addressed: scope_change documents user authorization in-flight ("build/do/test/confirm FULL only" directive at ~14:15Z). Verify the scope_change references the actual user message.

4. **(CONCERN) Smoke assertion is weak.** → Addressed in `tests/smoke.test.ts`:
   - Title must contain "relaygate" (case-insensitive)
   - Body must contain "sign in"
   - Body min 60 chars (was: > 0)
   - Final URL origin must equal expected origin via `new URL().origin === ...` (was: `startsWith` string match)
   Verify the new assertions actually run and could fail on a broken page.

5. **(CONCERN) `new URL(env)` can throw.** → Addressed in `src/main.ts`: `resolveDashboardUrl()` wraps `new URL` in try/catch + protocol allowlist + fallback. Verify the function is actually called at startup and the fallback is correct.

6. **(CONCERN) Popup handler doesn't allowlist hosts.** → Addressed in `src/main.ts`: `EXTERNAL_LINK_ALLOWLIST` Set + `isAllowedExternalOrigin()`. Verify the allowlist is applied to BOTH `setWindowOpenHandler` and `will-navigate`.

7. **(CONCERN) Edge cases (5xx, network down, CSP).** → Partially addressed: `did-fail-load` listener added for diagnostics. Smoke does not yet assert on 5xx. Verify whether this is sufficient.

## Repo state

- Branch: `main`
- HEAD: `aea9479`
- Pushed to: `https://github.com/RelayOne/relaygate-desktop` (public)
- Cross-platform binaries published at `gs://relayone-488319-public/relaygate-desktop/{46a6347,latest}/` (9 artifacts; 5+ requirement met)
- Live URL puppeteer suite: 7/8 PASS (1 intentional noindex)
- Linux AppImage personally verified by orchestrator (CDP target enumerated, page loaded)

## Output format (required)

For each Round 1 finding above, list:
- **Status:** RESOLVED / PARTIAL / NOT-RESOLVED / NEW-REGRESSION
- **Evidence:** specific file:line citations from the current HEAD

Then identify:
- **New issues introduced by the Round 1 fixes.** Be adversarial. The hardening added 40+ lines to main.ts; what's wrong with the new code?
- **Anti-cheat scan on aea9479 diff specifically.** Did the fix introduce stubs, weak assertions, or any Section B forbidden patterns?
- **Plan/log honesty audit.** Are the appended sections concrete or generic? Do timestamps make sense? Is anything backdated?

**Verdict:** `BLOCK` (must fix), `CONCERN` (should discuss), `OK` (genuinely solid).

A round-2 `OK` with no findings is suspicious. If you find nothing substantive, run a third adversarial pass before declaring `OK`.

Save your verbatim output to `.work/reviews/RG-DESKTOP-GUI-SCAFFOLD-001.review.md` (overwrite the Round 1 file).
