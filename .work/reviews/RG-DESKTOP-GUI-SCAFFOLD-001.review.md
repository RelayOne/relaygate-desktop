**Round 2 Findings Table**

| Round 2 finding | Status | Evidence |
|---|---|---|
| (BLOCK) backdated catch-up | RESOLVED | Explicit permanent disclosure of post-hoc backfill added in [progress.log:152](/home/eric/repos/relaygate-desktop/.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log:152) and [plan.md:124](/home/eric/repos/relaygate-desktop/.work/plans/RG-DESKTOP-GUI-SCAFFOLD-001.plan.md:124). |
| (CONCERN) URL token leakage | RESOLVED | Raw env URL removed from error log at [main.ts:16](/home/eric/repos/relaygate-desktop/src/main.ts:16); URL sanitizer introduced at [main.ts:71](/home/eric/repos/relaygate-desktop/src/main.ts:71) and used in denial/failure logs at [main.ts:106](/home/eric/repos/relaygate-desktop/src/main.ts:106), [main.ts:126](/home/eric/repos/relaygate-desktop/src/main.ts:126), [main.ts:134](/home/eric/repos/relaygate-desktop/src/main.ts:134). |
| (CONCERN) rigid allowlist | RESOLVED | Exact-origin allowlist expanded at [main.ts:27](/home/eric/repos/relaygate-desktop/src/main.ts:27); suffix-based matching added at [main.ts:48](/home/eric/repos/relaygate-desktop/src/main.ts:48) and enforced in [main.ts:55](/home/eric/repos/relaygate-desktop/src/main.ts:55). |
| (PARTIAL) HTTP status not asserted | RESOLVED | Main-frame document response status capture added at [smoke.test.ts:93](/home/eric/repos/relaygate-desktop/tests/smoke.test.ts:93) and asserted in pass gate at [smoke.test.ts:142](/home/eric/repos/relaygate-desktop/tests/smoke.test.ts:142), [smoke.test.ts:151](/home/eric/repos/relaygate-desktop/tests/smoke.test.ts:151). |
| (PARTIAL) timezone format | RESOLVED | Timezone correction disclosure added at [progress.log:155](/home/eric/repos/relaygate-desktop/.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log:155) and [plan.md:128](/home/eric/repos/relaygate-desktop/.work/plans/RG-DESKTOP-GUI-SCAFFOLD-001.plan.md:128); new entries use `-07:00` offsets (e.g. [progress.log:158](/home/eric/repos/relaygate-desktop/.work/logs/RG-DESKTOP-GUI-SCAFFOLD-001.progress.log:158)). |

**New Issues**

- CONCERN: `http_status` capture is timing-sensitive and can be flaky. Listener is attached only after target/page acquisition ([smoke.test.ts:80](/home/eric/repos/relaygate-desktop/tests/smoke.test.ts:80), [smoke.test.ts:88](/home/eric/repos/relaygate-desktop/tests/smoke.test.ts:88), [smoke.test.ts:93](/home/eric/repos/relaygate-desktop/tests/smoke.test.ts:93)); if main document response already occurred, `mainResponseStatus` stays `-1` and hard-fails via [smoke.test.ts:142](/home/eric/repos/relaygate-desktop/tests/smoke.test.ts:142). This is a new regression risk introduced in `976a24b`.
- CONCERN: Review artifact integrity issue. File starts with a false claim that overwrite failed due read-only FS at [review.md:1](/home/eric/repos/relaygate-desktop/.work/reviews/RG-DESKTOP-GUI-SCAFFOLD-001.review.md:1), but the commit itself did overwrite that same file.

**Anti-cheat Scan on diff `976a24b`**

- No stub/shortcut patterns found in executable changes (`src/main.ts`, `tests/smoke.test.ts`): no `TODO/FIXME/HACK/STUB`, no skipped-test markers, no no-op assertions, no `|| true`/`set +e`/`--no-verify`.
- The only suspicious pattern hit in diff is textual mention inside review prose, not executable code.
- No weakening of assertions in runtime test code; assertions were strengthened overall.

**Verdict**

`CONCERN`