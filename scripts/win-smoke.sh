#!/usr/bin/env bash
# scripts/win-smoke.sh — provision an ephemeral Windows Server 2022 VM,
# run Puppeteer-CDP smoke against the just-built Windows nsis installer,
# tear down the VM. Trap-EXIT guarantees teardown even on smoke failure.
#
# Required env from the calling Cloud Build step:
#   PROJECT_ID    — GCP project (Cloud Build builtin via $PROJECT_ID)
#   SHORT_SHA     — the build's short commit sha (Cloud Build builtin)
#   COMMIT_SHA    — full commit sha (Cloud Build builtin)
#   _ENV          — env (prod/staging/dev) — picks GCS source path
#
# Optional:
#   WIN_VM_ZONE   — default us-central1-a
#   WIN_VM_TYPE   — default e2-standard-4
#   WIN_VM_IMAGE  — default windows-server-2022-dc-v
#                   (resolved against family for latest available image)
#
# Exit codes:
#   0 — smoke passed
#   1 — smoke failed (or any setup step failed)
#   The VM is deleted in EITHER case.

set -euo pipefail

ZONE="${WIN_VM_ZONE:-us-central1-a}"
MACHINE_TYPE="${WIN_VM_TYPE:-e2-standard-4}"
IMAGE_FAMILY="${WIN_VM_IMAGE_FAMILY:-windows-2022}"
IMAGE_PROJECT="windows-cloud"
INSTANCE_NAME="relaygate-smoke-${SHORT_SHA}-$(date +%s)"
ARTIFACT_BUCKET="relayone-488319-public"
ARTIFACT_PREFIX="relaygate-desktop/${_ENV:-prod}/${SHORT_SHA}"
EXE_NAME="RelayGate-Setup-0.1.0.exe"

cleanup() {
  local rc=$?
  echo "[win-smoke] cleanup: deleting instance ${INSTANCE_NAME} (rc=${rc})"
  gcloud compute instances delete "${INSTANCE_NAME}" \
    --zone="${ZONE}" \
    --project="${PROJECT_ID}" \
    --quiet 2>&1 || echo "[win-smoke] cleanup: delete failed (instance may not exist; ignoring)"
  exit "${rc}"
}
trap cleanup EXIT

echo "[win-smoke] === Phase 1: create VM ${INSTANCE_NAME} ==="
# Startup script (PowerShell) installs Node 20 LTS + Git via Chocolatey,
# enables OpenSSH Server, and writes a sentinel file when ready.
# Using "register-script" via metadata is the standard pattern.
STARTUP_PS1=$(cat <<'POWERSHELL'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Install Chocolatey
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
$env:Path = "$env:Path;$env:ALLUSERSPROFILE\chocolatey\bin"
# Install Node + Git (silent)
choco install -y nodejs-lts --version=20.18.1 --no-progress
choco install -y git --no-progress
# Enable OpenSSH Server (built-in on Server 2022)
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'
# Set PowerShell as default shell over SSH
New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value 'C:\Program Files\PowerShell\7\pwsh.exe' -PropertyType String -Force -ErrorAction SilentlyContinue
# Sentinel: smoke driver waits on this file via gcloud compute ssh
New-Item -ItemType File -Path 'C:\smoke-ready.txt' -Force | Out-Null
POWERSHELL
)

gcloud compute instances create "${INSTANCE_NAME}" \
  --project="${PROJECT_ID}" \
  --zone="${ZONE}" \
  --machine-type="${MACHINE_TYPE}" \
  --image-family="${IMAGE_FAMILY}" \
  --image-project="${IMAGE_PROJECT}" \
  --boot-disk-size=50GB \
  --boot-disk-type=pd-balanced \
  --service-account="relaygate-desktop-ci@${PROJECT_ID}.iam.gserviceaccount.com" \
  --scopes="https://www.googleapis.com/auth/cloud-platform" \
  --metadata="enable-windows-ssh=TRUE" \
  --metadata-from-file=windows-startup-script-ps1=<(echo "${STARTUP_PS1}") \
  --no-shielded-secure-boot \
  --quiet

echo "[win-smoke] === Phase 2: wait for SSH + startup script (up to 8 min) ==="
deadline=$(( $(date +%s) + 480 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if gcloud compute ssh "${INSTANCE_NAME}" \
      --zone="${ZONE}" \
      --project="${PROJECT_ID}" \
      --tunnel-through-iap \
      --quiet \
      --command='powershell -Command "Test-Path C:\smoke-ready.txt"' 2>/dev/null | grep -q True; then
    echo "[win-smoke] startup script complete; SSH ready"
    break
  fi
  echo "[win-smoke] waiting for VM... ($(( deadline - $(date +%s) ))s remaining)"
  sleep 20
done

echo "[win-smoke] === Phase 3: copy installer + run smoke ==="
# Source the .exe from the local Cloud Build workspace if present (the typical
# case — smoke-test-win runs after dist-all-platforms before publish), else
# fall back to GCS (manual smoke re-run case).
LOCAL_EXE="/workspace/release/${EXE_NAME}"
if [ ! -f "${LOCAL_EXE}" ]; then
  echo "[win-smoke] local .exe not found; pulling from GCS"
  gcloud storage cp \
    "gs://${ARTIFACT_BUCKET}/${ARTIFACT_PREFIX}/${EXE_NAME}" \
    "${LOCAL_EXE}"
fi

gcloud compute scp \
  --zone="${ZONE}" \
  --project="${PROJECT_ID}" \
  --tunnel-through-iap \
  --quiet \
  "${LOCAL_EXE}" \
  "${INSTANCE_NAME}:C:/Users/Public/${EXE_NAME}"

# Run nsis silent install + clone test fixture + run Puppeteer-CDP smoke.
# Output capture to C:\smoke-out.txt for post-mortem.
gcloud compute ssh "${INSTANCE_NAME}" \
  --zone="${ZONE}" \
  --project="${PROJECT_ID}" \
  --tunnel-through-iap \
  --quiet \
  --command="powershell -Command \"
    \$ErrorActionPreference = 'Stop'
    Start-Process -FilePath 'C:\\Users\\Public\\${EXE_NAME}' -ArgumentList '/S' -Wait
    \$bin = \\\"\$env:LOCALAPPDATA\\Programs\\RelayGate\\RelayGate.exe\\\"
    if (-not (Test-Path \\\"\$bin\\\")) {
      \$bin = 'C:\\Program Files\\RelayGate\\RelayGate.exe'
    }
    if (-not (Test-Path \\\"\$bin\\\")) { throw 'RelayGate.exe not found after install' }
    Write-Output \\\"smoke target: \$bin\\\"
    git clone --depth=1 --branch=main https://github.com/RelayOne/relaygate-desktop.git C:\\rg-smoke
    cd C:\\rg-smoke
    git checkout ${COMMIT_SHA}
    npm ci --no-audit --no-fund 2>&1 | Out-File -FilePath C:\\npm-ci.log
    \$env:ELECTRON_OVERRIDE_BIN = \\\"\$bin\\\"
    npx tsx tests/smoke.test.ts
  \""

echo "[win-smoke] smoke PASSED"
# trap-EXIT will delete the VM
