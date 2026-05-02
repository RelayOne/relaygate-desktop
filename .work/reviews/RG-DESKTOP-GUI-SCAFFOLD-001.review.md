Could not overwrite `/home/eric/repos/relaygate-desktop/.work/reviews/RG-DESKTOP-GUI-SCAFFOLD-001.review.md` because the filesystem is mounted read-only in this session.

1. (BLOCK) Plan said mac DMG; code shipped mac zip.
- **Status:** RESOLVED
- **Evidence:** Scope-change section exists with DMG→zip rationale in [plan.md:102](/home/eric/repos/relaygate-desktop/.work/plans/RG-DESKTOP-GUI-SCAFFOLD-001.plan.md:102), [plan.md:104](/home/eric/repos/relaygate-desktop/.work/plans/RG-DESKTOP-GUI-SCAFFOLD-001.plan.md:104), [plan.md:106](/home/eric/repos/relaygate-desktop/.work/plans/RG-DESKTOP-GUI-SCAFFOLD-001.plan.md:106); mac target is zip in [electron-builder.yml:34](/home/eric/repos/relaygate-desktop/electron-builder.yml:34).

2. (BLOCK) Progress log incomplete.
- **Status:** PARTIAL
- **Evidence:** Catch-up entries now extend through [progress.log:150](/home/eric/repos/relaygate-desktop/.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log:150) and include concrete command/outcome lines like [progress.log:79](/home/eric/repos/relaygate-desktop/.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log:79), [progress.log:81](/home/eric/repos/relaygate-desktop/.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log:81), [progress.log:116](/home/eric/repos/relaygate-desktop/.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log:116); however it explicitly states catch-up backfill at [progress.log:150](/home/eric/repos/relaygate-desktop/.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log:150).

3. (BLOCK) “No GitHub push” criterion violated.
- **Status:** PARTIAL
- **Evidence:** Scope-change references the directive text in [plan.md:110](/home/eric/repos/relaygate-desktop/.work/plans/RG-DESKTOP-GUI-SCAFFOLD-001.plan.md:110) and [progress.log:68](/home/eric/repos/relaygate-desktop/.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log:68), but there is no immutable in-repo citation to the original user message (no transcript pointer).

4. (CONCERN) Smoke assertion is weak.
- **Status:** RESOLVED
- **Evidence:** Assertions now require title/body/origin/min-length checks at [smoke.test.ts:124](/home/eric/repos/relaygate-desktop/tests/smoke.test.ts:124), [smoke.test.ts:126](/home/eric/repos/relaygate-desktop/tests/smoke.test.ts:126), [smoke.test.ts:129](/home/eric/repos/relaygate-desktop/tests/smoke.test.ts:129), [smoke.test.ts:119](/home/eric/repos/relaygate-desktop/tests/smoke.test.ts:119), and are enforced by fail-fast logic at [smoke.test.ts:159](/home/eric/repos/relaygate-desktop/tests/smoke.test.ts:159).

5. (CONCERN) `new URL(env)` can throw.
- **Status:** RESOLVED
- **Evidence:** URL parse guarded by try/catch in [main.ts:6](/home/eric/repos/relaygate-desktop/src/main.ts:6), [main.ts:14](/home/eric/repos/relaygate-desktop/src/main.ts:14), fallback in [main.ts:19](/home/eric/repos/relaygate-desktop/src/main.ts:19); resolver is called at startup in [main.ts:24](/home/eric/repos/relaygate-desktop/src/main.ts:24) and consumed by [main.ts:103](/home/eric/repos/relaygate-desktop/src/main.ts:103).

6. (CONCERN) Popup handler doesn't allowlist hosts.
- **Status:** RESOLVED
- **Evidence:** Allowlist set exists at [main.ts:26](/home/eric/repos/relaygate-desktop/src/main.ts:26) with validator at [main.ts:37](/home/eric/repos/relaygate-desktop/src/main.ts:37); applied in [main.ts:69](/home/eric/repos/relaygate-desktop/src/main.ts:69) and [main.ts:89](/home/eric/repos/relaygate-desktop/src/main.ts:89).

7. (CONCERN) Edge cases (5xx, network down, CSP).
- **Status:** PARTIAL
- **Evidence:** Diagnostics added via [main.ts:97](/home/eric/repos/relaygate-desktop/src/main.ts:97), but smoke still has no explicit HTTP-status/CSP assertion in the pass gate at [smoke.test.ts:132](/home/eric/repos/relaygate-desktop/tests/smoke.test.ts:132).

New issues introduced by the Round 1 fixes
- **BLOCK:** Log/plan integrity regression. Historical entries were backfilled in one commit while stamped as earlier event times. Evidence: explicit catch-up note at [progress.log:150](/home/eric/repos/relaygate-desktop/.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log:150). `git blame` shows lines 66-151 in the log and 102-132 in the plan were authored together in `aea9479` at 14:54:32-07:00.
- **CONCERN:** New stderr logging leaks full denied URLs (including query strings/tokens) in [main.ts:73](/home/eric/repos/relaygate-desktop/src/main.ts:73), [main.ts:84](/home/eric/repos/relaygate-desktop/src/main.ts:84), [main.ts:92](/home/eric/repos/relaygate-desktop/src/main.ts:92), and [main.ts:99](/home/eric/repos/relaygate-desktop/src/main.ts:99).
- **CONCERN:** Allowlist is rigid exact-origin and likely breaks legitimate external flows not listed. Evidence: fixed allowlist only at [main.ts:26](/home/eric/repos/relaygate-desktop/src/main.ts:26), enforced deny in [main.ts:75](/home/eric/repos/relaygate-desktop/src/main.ts:75) and [main.ts:92](/home/eric/repos/relaygate-desktop/src/main.ts:92).

Anti-cheat scan on `aea9479` diff specifically
- No Section B forbidden patterns were introduced in added lines (`TODO`, `FIXME`, `XXX`, `HACK`, `STUB`, `@ts-ignore`, `# noqa`, `it.skip`, `it.only`, `xdescribe`, `xtest`, `expect(true).toBe(true)`, `assert True`, `continue-on-error`, `|| true`, `set +e`, `--no-verify`).
- No obvious stubs/no-op tests were added.
- Remaining rigor gap is quality-related (missing explicit response-status assertion), not a stub pattern.

Plan/log honesty audit
- Concrete vs generic: appended entries are mostly concrete (build IDs, commit IDs, command outcomes), e.g. [progress.log:83](/home/eric/repos/relaygate-desktop/.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log:83), [progress.log:87](/home/eric/repos/relaygate-desktop/.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log:87), [progress.log:118](/home/eric/repos/relaygate-desktop/.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log:118).
- Timestamp sanity: inconsistent timezone semantics. Log lines are stamped with `Z` but align numerically with local `-07:00` commit times (example reference: [progress.log:87](/home/eric/repos/relaygate-desktop/.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log:87) vs commit `46a6347` timestamp `2026-05-02T14:23:31-07:00`).
- Backdating: yes. The scope-change section was appended later but labeled with earlier times, see [plan.md:104](/home/eric/repos/relaygate-desktop/.work/plans/RG-DESKTOP-GUI-SCAFFOLD-001.plan.md:104) and [plan.md:108](/home/eric/repos/relaygate-desktop/.work/plans/RG-DESKTOP-GUI-SCAFFOLD-001.plan.md:108).

**Verdict:** `BLOCK`