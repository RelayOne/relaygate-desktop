<!-- STATUS: done -->
<!-- TYPE: feature -->
<!-- CREATED: 2026-05-05 -->
<!-- BUILD_STARTED: 2026-05-05 -->
<!-- BUILD_COMPLETED: 2026-05-05 -->
<!-- DEPENDS_ON: none -->
<!-- BUILD_ORDER: 1 -->

# Dashboard dev/staging routing — Implementation Spec

## Overview

The Cloud Run services `relaygate-app-dev` and `relaygate-app-staging` already exist in `relayone-488319/us-central1` and are healthy (HTTP 307 from default `*.a.run.app` URLs). However, they have no Cloud Run domain mappings and no Cloudflare DNS records, so `https://app.dev.relaygate.ai` and `https://app.staging.relaygate.ai` resolve to nothing. The Electron desktop wrapper's planned env-aware default URL (separate spec, build-order 4) requires those hostnames to be live before dev/staging desktop builds become useful — otherwise dev/staging binaries boot to a 404. This spec wires the routing.

## Stack & Versions

- GCP project: `relayone-488319`
- Cloud Run region: `us-central1`
- Cloud Run domain-mapping API (gen1) — uses `gcloud beta run domain-mappings`
- Cloudflare API: zone `relaygate.ai` (id `5e0deed2b591e792ed91b03989212ca5`)
- Cloudflare token: secret `relayone-cloudflare-api-token` in Secret Manager (same project), confirmed has zone read+edit on `relaygate.ai`
- Existing prod pattern (template for new records): `app.relaygate.ai` is `CNAME → ghs.googlehosted.com`, proxied=false

## Why this is gcloud + API only (no source changes)

The dashboard repo (`/home/eric/repos/relaygate-app`) is separate. Its source/`cloudbuild.yaml` is not modified by this spec. We only:
1. Add domain mappings (Cloud Run side)
2. Add CNAME records (Cloudflare side)
3. Verify DNS+TLS propagated and the dashboard responds 307 (same shape as prod)

Cloud Run domain mapping bound to a live service automatically provisions a managed cert once DNS validation passes; that's the entire pipeline. No need to touch the relaygate-app repo or its triggers.

## Checklist

- [ ] **TASK-1**: Add Cloud Run domain mapping for `app.dev.relaygate.ai`.
  - MUST run: `gcloud beta run domain-mappings create --region=us-central1 --project=relayone-488319 --service=relaygate-app-dev --domain=app.dev.relaygate.ai`
  - MUST capture the resourceRecords from the create response (CNAME target should be `ghs.googlehosted.com`).
  - MUST verify the mapping exists: `gcloud beta run domain-mappings describe app.dev.relaygate.ai --region=us-central1 --project=relayone-488319 --format="value(spec.routeName,status.conditions)"` — routeName must equal `relaygate-app-dev`. Initial status will show `CertificateProvisioned=Unknown` (DNS not yet pointed).
  - VERIFY: command exits 0 and routeName matches.

- [ ] **TASK-2**: Add Cloud Run domain mapping for `app.staging.relaygate.ai`.
  - MUST run: `gcloud beta run domain-mappings create --region=us-central1 --project=relayone-488319 --service=relaygate-app-staging --domain=app.staging.relaygate.ai`
  - MUST verify with same describe command pattern.
  - VERIFY: command exits 0 and routeName matches.

- [ ] **TASK-3**: Add Cloudflare CNAME `app.dev.relaygate.ai` → `ghs.googlehosted.com`.
  - MUST extract token: `TOKEN=$(gcloud secrets versions access latest --secret=relayone-cloudflare-api-token --project=relayone-488319)`
  - MUST POST to `https://api.cloudflare.com/client/v4/zones/5e0deed2b591e792ed91b03989212ca5/dns_records` with `Authorization: Bearer $TOKEN` and JSON body `{"type":"CNAME","name":"app.dev","content":"ghs.googlehosted.com","ttl":1,"proxied":false}`. (Cloudflare auto-strips the zone suffix when name is `app.dev`; ttl=1 means "automatic".) Match prod's `app` record exactly: proxied=**false** (Google's managed cert needs unproxied so the SNI hits Google).
  - MUST verify: `curl -s "https://api.cloudflare.com/client/v4/zones/5e0deed2b591e792ed91b03989212ca5/dns_records?name=app.dev.relaygate.ai" -H "Authorization: Bearer $TOKEN" | jq -e '.result[0].content == "ghs.googlehosted.com" and .result[0].proxied == false'` returns `true`.
  - MUST handle "already exists" (HTTP 400 + `code: 81057`) by treating as success and verifying existing record matches.
  - VERIFY: jq check returns `true`.

- [ ] **TASK-4**: Add Cloudflare CNAME `app.staging.relaygate.ai` → `ghs.googlehosted.com`.
  - Same shape as TASK-3 but `name: "app.staging"`.
  - VERIFY: jq check returns `true`.

- [ ] **TASK-5**: Wait for DNS propagation + cert provisioning, then verify both hostnames serve HTTP.
  - MUST poll for up to 600s (Google's managed cert provisioning can take 60-300s once DNS resolves; Cloudflare DNS is typically <60s for new records).
  - Polling shape: `for h in app.dev.relaygate.ai app.staging.relaygate.ai; do for i in $(seq 1 60); do code=$(curl -sI -o /dev/null -w "%{http_code}" --max-time 8 --resolve "$h:443:$(getent hosts ghs.googlehosted.com | awk '{print $1}' | head -1)" "https://$h" 2>&1); [ "$code" = "307" ] && { echo "$h: 307 OK after ${i}0s"; break; }; sleep 10; done; done`
  - The `--resolve` is a sanity belt-and-suspenders so we don't get cached "no DNS" from the local resolver.
  - Final pass after the loop: also do a direct `curl -sI -o /dev/null -w "%{http_code}" --max-time 8 https://$h` — must equal `307` (matches prod's response code; the dashboard redirects to NextAuth signin when unauthenticated).
  - If still not 307 after 600s, report BLOCKED with details (managed cert state from `gcloud beta run domain-mappings describe`, Cloudflare DNS query result, and the actual HTTP status).
  - VERIFY: both hostnames return 307 from default resolver.

- [ ] **TASK-6**: Document the new mappings in `docs/DEPLOYMENT.md` (this repo, since it's the canonical deployment doc the user reads). One subsection: "Dashboard environments" with the 3 hosts and which Cloud Run service each maps to. Verbose, not a one-liner — explain the `ghs.googlehosted.com` CNAME pattern and that managed certs auto-provision.
  - VERIFY: the doc has the 3-host table and at least 2 paragraphs of context.

## Rollback

Per-task reversal:
- Domain mappings: `gcloud beta run domain-mappings delete <host> --region=us-central1`
- Cloudflare records: `DELETE /dns_records/{id}` with bearer token

These are independently reversible. Doing TASK-3/4 BEFORE TASK-1/2 would also work but the user-visible experience is "404 → 307" (Cloud Run says no route bound) which is louder; doing 1/2 first means user-visible "DNS not found → 307" which is quieter. Order chosen accordingly.

## Validation

After all tasks pass:
- `app.dev.relaygate.ai` and `app.staging.relaygate.ai` return HTTP 307 (matches prod).
- TLS cert is valid (browser-trusted; Google managed cert from `pki.goog`).
- Both have managed cert status `CertificateProvisioned=True` per `gcloud beta run domain-mappings describe`.
