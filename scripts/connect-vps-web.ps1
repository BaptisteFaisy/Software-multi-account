[CmdletBinding()]
param(
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')]
  [string]$Profile = "",
  [ValidateRange(0, 65535)]
  [int]$LocalPort = 0,
  [switch]$Stop,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$ProfileDir = Join-Path $env:APPDATA "codex-switch-terminal\vps"

function Unprotect-Secret {
  param([string]$Value)
  $secure = ConvertTo-SecureString -String $Value
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Quote-NativeArgument {
  param([string]$Value)
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + $Value.Replace('"', '\"') + '"'
}

if (-not (Test-Path -LiteralPath $ProfileDir)) {
  throw "Aucun profil VPS dans $ProfileDir."
}

if (-not $Profile.Trim()) {
  $profiles = @(Get-ChildItem -LiteralPath $ProfileDir -Filter "*.json" -File)
  if ($profiles.Count -eq 0) { throw "Aucun profil VPS disponible." }
  if ($profiles.Count -gt 1) {
    throw "Plusieurs profils VPS existent; indique -Profile."
  }
  $Profile = $profiles[0].BaseName
}

$profilePath = Join-Path $ProfileDir "$Profile.json"
if (-not (Test-Path -LiteralPath $profilePath)) {
  throw "Profil VPS introuvable: $Profile"
}
$config = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
$sshTarget = [string]$config.sshTarget
$sshPort = [int]$config.sshPort
$remotePort = [int]$config.remotePort
$identityFile = [string]$config.identityFile
if ($LocalPort -eq 0) { $LocalPort = [int]$config.defaultLocalPort }
if (-not $sshTarget -or $sshPort -lt 1 -or $remotePort -lt 1 -or $LocalPort -lt 1) {
  throw "Le profil VPS '$Profile' est incomplet."
}

$statePath = Join-Path $ProfileDir "$Profile.web-tunnel.json"

if ($Stop) {
  if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $process = Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq "ssh") {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      Wait-Process -Id $process.Id -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  }
  Write-Host "Tunnel web '$Profile' arrete." -ForegroundColor Green
  return
}

if (-not [string]$config.tokenProtected) {
  throw "Le profil VPS '$Profile' ne contient pas de token protege."
}
$adminToken = Unprotect-Secret ([string]$config.tokenProtected)
$localUrl = "http://127.0.0.1:$LocalPort"

function Get-AuthenticatedHealth {
  try {
    $health = Invoke-RestMethod -Uri "$localUrl/healthz" -TimeoutSec 2
    if (-not $health.ok) { return $null }
    $authenticated = Invoke-RestMethod `
      -Uri "$localUrl/api/health" `
      -Headers @{ Authorization = "Bearer $adminToken" } `
      -TimeoutSec 3
    if ($authenticated.ok) { return $authenticated }
  }
  catch {
    return $null
  }
  return $null
}

$tunnel = $null
if (Test-Path -LiteralPath $statePath) {
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  $existing = Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue
  if ($existing -and $existing.ProcessName -eq "ssh") {
    $authenticatedHealth = Get-AuthenticatedHealth
    if ($authenticatedHealth) {
      $tunnel = $existing
    }
    else {
      Stop-Process -Id $existing.Id -Force -ErrorAction SilentlyContinue
      Wait-Process -Id $existing.Id -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    }
  }
  else {
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  }
}

if (-not $tunnel) {
  if (Get-NetTCPConnection -State Listen -LocalPort $LocalPort -ErrorAction SilentlyContinue) {
    throw "Le port local $LocalPort est deja utilise par un autre processus."
  }
  if (-not (Test-Path -LiteralPath $identityFile)) {
    throw "Cle SSH du profil introuvable: $identityFile"
  }
  $ssh = Get-Command ssh -ErrorAction SilentlyContinue
  if (-not $ssh) { throw "Commande requise introuvable: ssh" }

  $sshArgs = @(
    "-N", "-T",
    "-p", [string]$sshPort,
    "-L", "127.0.0.1:${LocalPort}:127.0.0.1:${remotePort}",
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "StrictHostKeyChecking=yes",
    "-i", $identityFile,
    $sshTarget
  )
  $argumentLine = ($sshArgs | ForEach-Object {
    Quote-NativeArgument ([string]$_)
  }) -join " "
  $tunnel = Start-Process `
    -FilePath $ssh.Source `
    -ArgumentList $argumentLine `
    -WindowStyle Hidden `
    -PassThru

  $authenticatedHealth = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($tunnel.HasExited) {
      throw "Le tunnel SSH s'est ferme avant validation (code $($tunnel.ExitCode))."
    }
    $authenticatedHealth = Get-AuthenticatedHealth
    if ($authenticatedHealth) { break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $authenticatedHealth) {
    Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
    throw "Le tunnel est ouvert mais le runtime distant ne repond pas."
  }

  [ordered]@{
    version = 1
    profile = $Profile
    pid = $tunnel.Id
    localPort = $LocalPort
    sshTarget = $sshTarget
    startedAt = [DateTimeOffset]::UtcNow.ToString("o")
  } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}

try {
  Set-Clipboard -Value $adminToken
}
catch {
  Write-Warning "Impossible de copier le token dans le presse-papiers."
}

if (-not $NoBrowser) {
  Start-Process $localUrl
}

Write-Host "Tunnel web '$Profile' operationnel." -ForegroundColor Green
Write-Host "URL locale : $localUrl"
Write-Host "Token admin copie dans le presse-papiers."
Write-Host "Arret      : npm run connect:vps:web:stop -- -Profile $Profile"
