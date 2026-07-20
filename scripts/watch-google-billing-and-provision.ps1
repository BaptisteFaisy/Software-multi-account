[CmdletBinding()]
param(
  [ValidatePattern('^[A-Za-z0-9 ._-]{1,80}$')]
  [string]$TaskName = "CST Google Trial Autoprovision"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$AccountScript = Join-Path $ScriptDir "google-cloud-account.ps1"
$ProvisionScript = Join-Path $ScriptDir "provision-google-trial.ps1"
$StateDir = Join-Path $env:APPDATA "codex-switch-terminal\google-cloud"
$StateFile = Join-Path $StateDir "autoprovision-status.json"
$LogFile = Join-Path $StateDir "autoprovision.log"
$ProfileFile = Join-Path $env:APPDATA "codex-switch-terminal\vps\google-trial.json"
$PowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $StateDir -Force | Out-Null

$attempt = 0
if (Test-Path -LiteralPath $StateFile) {
  try {
    $previous = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
    $attempt = [int]$previous.attempt
  }
  catch {
    $attempt = 0
  }
}

function Write-AutoprovisionState {
  param(
    [Parameter(Mandatory = $true)][string]$Status,
    [Parameter(Mandatory = $true)][string]$Message
  )
  $payload = [ordered]@{
    status = $Status
    message = $Message
    attempt = $script:attempt
    taskName = $TaskName
    profile = $ProfileFile
    updatedAt = [DateTime]::UtcNow.ToString("o")
  }
  $temporary = "$StateFile.$PID.tmp"
  [IO.File]::WriteAllText(
    $temporary,
    (($payload | ConvertTo-Json -Depth 4) + "`n"),
    (New-Object Text.UTF8Encoding($false))
  )
  Move-Item -LiteralPath $temporary -Destination $StateFile -Force
}

function Write-AutoprovisionLog {
  param([Parameter(Mandatory = $true)][string]$Message)
  Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value (
    "[{0}] {1}" -f [DateTime]::UtcNow.ToString("o"), $Message
  )
}

function Read-GoogleStatus {
  $output = @(
    & $PowerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass `
      -File $AccountScript -Status 2>&1
  )
  if ($LASTEXITCODE -ne 0) {
    throw (($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
  }
  $json = $output |
    ForEach-Object { [string]$_ } |
    Where-Object { $_.TrimStart().StartsWith("{") } |
    Select-Object -Last 1
  if (-not $json) { throw "Etat Google Cloud illisible." }
  return $json | ConvertFrom-Json
}

function Disable-ThisTask {
  try {
    Disable-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null
  }
  catch {
    Write-AutoprovisionLog "Provisionnement termine; desactivation automatique differee: $($_.Exception.Message)"
  }
}

$mutex = New-Object Threading.Mutex($false, "Local\CST-Google-Trial-Autoprovision")
$lockHeld = $false
try {
  try {
    $lockHeld = $mutex.WaitOne(0)
  }
  catch [Threading.AbandonedMutexException] {
    $lockHeld = $true
  }
  if (-not $lockHeld) { return }

  if (Test-Path -LiteralPath $ProfileFile) {
    Write-AutoprovisionState -Status "completed" -Message "Le VPS Google Cloud est deploye et enregistre."
    Disable-ThisTask
    return
  }

  $google = Read-GoogleStatus
  if (-not $google.authenticated) {
    Write-AutoprovisionState -Status "awaiting_auth" -Message "La connexion Google Cloud doit etre validee."
    return
  }
  if (-not $google.billingReady) {
    Write-AutoprovisionState -Status "awaiting_billing" -Message "En attente de la validation de la carte sur Google Cloud."
    return
  }

  $attempt++
  Write-AutoprovisionState -Status "provisioning" -Message "Creation de la VM puis deploiement Ansible et Docker Compose."
  Write-AutoprovisionLog "Tentative ${attempt}: facturation active, lancement du provisionnement."

  Push-Location $Root
  try {
    & $PowerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass `
      -File $ProvisionScript -Apply -Deploy *>> $LogFile
    $exitCode = $LASTEXITCODE
  }
  finally {
    Pop-Location
  }

  if ($exitCode -ne 0) {
    throw "Le provisionneur Google Cloud a termine avec le code $exitCode."
  }
  if (-not (Test-Path -LiteralPath $ProfileFile)) {
    throw "Le provisionnement s'est termine sans creer le profil google-trial."
  }

  Write-AutoprovisionState -Status "completed" -Message "Le VPS Google Cloud est deploye et enregistre."
  Write-AutoprovisionLog "Provisionnement Google Cloud termine avec succes."
  Disable-ThisTask
}
catch {
  $message = $_.Exception.Message
  Write-AutoprovisionState -Status "retrying" -Message $message
  Write-AutoprovisionLog "Echec temporaire: $message"
  throw
}
finally {
  if ($lockHeld) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
