<!-- STATUS: done -->
<!-- TYPE: feature -->
<!-- CREATED: 2026-05-05 -->
<!-- BUILD_STARTED: 2026-05-05 -->
<!-- BUILD_COMPLETED: 2026-05-05 -->
<!-- DEPENDS_ON: none -->
<!-- BUILD_ORDER: 2 -->

# cloudbuild.yaml `_ENV` substitution + per-env artifact paths — Implementation Spec

## Overview

Today `cloudbuild.yaml` hardcodes the GCS publish path: `gs://relayone-488319-public/relaygate-desktop/${SHORT_SHA}/` and `gs://relayone-488319-public/relaygate-desktop/latest/`. With dev + staging branches now real, those branches' builds (once their triggers exist — separate spec) would either need their own yaml OR clobber the prod `latest/` mirror. We refactor to a single yaml that takes `_ENV` as a substitution. Default value `prod` so the existing `relaygate-desktop-binaries` (push-to-main) trigger keeps working unchanged. Dev/staging triggers (next spec) override `_ENV` accordingly.

## Stack & Versions

- Cloud Build's `substitutions:` schema (top-level) for declaring user-defined subs with defaults
- Cloud Build's `options.substitutionOption: ALLOW_LOOSE` (already set) — tolerates undefined subs without erroring
- The bash-side variable expansion convention in this repo's yaml: `$$VAR` for shell-evaluated, `$VAR` or `${SUB}` for Cloud Build-substituted

## Stack-relevant prior art (read before editing)

`cloudbuild.yaml:120-157` — the `publish` step is the only step that touches the publish path. Three other GCS write paths exist in the file: the `artifacts.objects.location` block at the bottom (line 159-167) writes to `build-${BUILD_ID}/`, which is environment-agnostic by design (per-build debug bundle), and we leave that alone.

## Path scheme

| Env | Push trigger sets `_ENV` | Per-build path | "latest" mirror |
|---|---|---|---|
| prod | `prod` (default) | `relaygate-desktop/prod/${SHORT_SHA}/` | `relaygate-desktop/prod/latest/` |
| staging | `staging` | `relaygate-desktop/staging/${SHORT_SHA}/` | `relaygate-desktop/staging/latest/` |
| dev | `dev` | `relaygate-desktop/dev/${SHORT_SHA}/` | `relaygate-desktop/dev/latest/` |
| PR (any branch) | inherits trigger's `_ENV` | `relaygate-desktop/${_ENV}/${SHORT_SHA}/` | **skipped** (existing PR-mode skip stays) |

This means **prod artifacts move from `relaygate-desktop/${SHORT_SHA}/` → `relaygate-desktop/prod/${SHORT_SHA}/`**. That's a public-URL change for downloaders. The landing page (`relaygate.ai` website, separate codebase) currently links the `latest/` path: `gs://...relaygate-desktop/latest/RelayGate-Setup-0.1.0.exe` etc. Those links will break unless we either:

(a) Mirror prod artifacts to BOTH `relaygate-desktop/prod/latest/` AND `relaygate-desktop/latest/` for backward compatibility — chosen approach. Two mirrors only on prod, no extra cost (Cloud Build bills compute, not GCS writes), and downstream link migrations can happen later without rush.

(b) Update the landing-page links immediately. Out of scope for this spec; would couple two repos.

## Checklist

- [ ] **TASK-1**: Add a top-level `substitutions:` block to `cloudbuild.yaml`. Above `options:`. Content:
  ```yaml
  substitutions:
    _ENV: 'prod'
  ```
  This declares `_ENV` with default value `prod`. Triggers can override; standalone `gcloud builds submit` runs work unchanged.
  - VERIFY: `gcloud builds submit --config=cloudbuild.yaml --no-source --dry-run` (if available) or visual review — the field validates as YAML.

- [ ] **TASK-2**: Update the `publish` step (`cloudbuild.yaml:120-157`). Replace the two `gcloud storage cp` lines.
  - `gcloud storage cp "$$f" "gs://relayone-488319-public/relaygate-desktop/$SHORT_SHA/$$base"` → `gcloud storage cp "$$f" "gs://relayone-488319-public/relaygate-desktop/${_ENV}/$SHORT_SHA/$$base"`
  - The `latest/` line under `if [ "$$IS_PR_BUILD" != "true" ]; then` → must mirror to BOTH `${_ENV}/latest/` AND, **only when `_ENV=prod`**, also to the legacy `latest/` path for backward-compat with landing-page links. Code:
    ```bash
    gcloud storage cp "$$f" "gs://relayone-488319-public/relaygate-desktop/${_ENV}/latest/$$base"
    if [ "${_ENV}" = "prod" ]; then
      gcloud storage cp "$$f" "gs://relayone-488319-public/relaygate-desktop/latest/$$base"
    fi
    ```
  - The SHA256SUMS publish lines at the bottom of the step (lines ~152-156) need the same treatment — `${_ENV}/$SHORT_SHA/SHA256SUMS.txt` and `${_ENV}/latest/SHA256SUMS.txt` plus the legacy `latest/SHA256SUMS.txt` mirror when `_ENV=prod`.
  - The final `gcloud storage ls "gs://relayone-488319-public/relaygate-desktop/$SHORT_SHA/"` should also become `${_ENV}/$SHORT_SHA/`.
  - VERIFY: `grep -n 'relaygate-desktop/' cloudbuild.yaml` shows ALL paths under `publish:` use `${_ENV}/...` pattern; only the legacy-prod-mirror lines and the `artifacts.objects.location` block remain on the bare path.

- [ ] **TASK-3**: Add a comment block above the `publish` step explaining the env-aware paths and the prod-only legacy mirror, so the reasoning is in the file.
  - 4-6 lines max. Cite this spec (`specs/cloudbuild-env-paths.md`) by name so the next person can find it.
  - VERIFY: comment present, references the spec.

- [ ] **TASK-4**: Update `docs/DEPLOYMENT.md` to document the new artifact path scheme. Add a "Per-environment artifact paths" subsection with the 4-row table from this spec's Overview. Verbose: 2+ paragraphs explaining why the prod legacy mirror exists and when it can be retired.
  - VERIFY: doc has the table + reasoning paragraphs.

- [ ] **TASK-5**: Smoke-test the change end-to-end on `dev` branch BEFORE merging to staging/main. Push the change to `dev`. The dev push-trigger doesn't exist yet (next spec) — so this validation requires the next spec's TASK-1 to also be done. Cross-spec: this VERIFY step is performed at the end of the build of the NEXT spec (cloudbuild-triggers-dev-staging), not here. Mark this TASK as VERIFIED-DOWNSTREAM in that spec's TASK-N.
  - VERIFY: deferred to cloudbuild-triggers-dev-staging spec.

## Backward-compat safety

The default `_ENV=prod` means the existing `relaygate-desktop-binaries` trigger (push to `main`, no `_ENV` substitution set) gets `prod` automatically. Combined with the prod-only legacy `latest/` mirror, prod artifacts continue to land at `gs://...relaygate-desktop/latest/` AND newly at `gs://...relaygate-desktop/prod/latest/`. Zero breakage for existing landing-page links.

## Validation

After build completes (cross-spec, see TASK-5):
- For prod main build: artifacts land at BOTH `prod/${SHORT_SHA}/`, `prod/latest/`, AND legacy `latest/`.
- For staging build: artifacts land ONLY at `staging/${SHORT_SHA}/` and `staging/latest/`.
- For dev build: artifacts land ONLY at `dev/${SHORT_SHA}/` and `dev/latest/`.
- For PR builds (any branch): artifacts land at `${_ENV}/${SHORT_SHA}/` only — no `latest/` mirror.
